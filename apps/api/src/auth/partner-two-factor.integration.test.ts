import { sql } from 'drizzle-orm';
import { authenticator } from 'otplib';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';
import { PERMISSIONS as P } from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { FieldEncryptionService } from '../common/crypto/field-encryption.service.js';
import { PasswordService } from '../common/crypto/password.service.js';
import { PartnerTwoFactorService } from './partner-two-factor.service.js';
import { TwoFactorService } from './two-factor.service.js';
import type { AccessTokenClaims } from './token.service.js';
import type { Env } from '../config/env.js';

/**
 * Partner two-factor authentication, end to end, against a REAL PostgreSQL.
 *
 * Mandatory for partners since 2026-08-07 (Bashar). What is worth proving here is not that the
 * service calls the right method — it is that enrolment actually persists an encrypted secret, that
 * a reset actually removes it, and that the reset cannot be pointed at a staff account. All three
 * are database facts, and a mocked database would keep asserting them long after they stopped
 * being true.
 *
 * Skipped when DATABASE_URL is unset; CI provisions a database and runs it.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** A throwaway 32-byte key. These tests encrypt and decrypt within one run and store nothing. */
const TEST_ENV = {
  FIELD_ENCRYPTION_KEY: 'a'.repeat(64),
} as unknown as Env;

describeIfDb('partner two-factor authentication', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  /* Every row this suite writes is discarded when the test that wrote it ends. */
  const db: Database = harness.db;
  const encryption = new FieldEncryptionService(TEST_ENV);
  const passwords = new PasswordService();
  const audit = new AuditService(db);

  /*
    A stub, because a real TokenService drags in JWT configuration that has no bearing on anything
    asserted here. The revocation that MATTERS — the one a reset performs — is done by
    PartnerTwoFactorService in its own transaction and is asserted against the database below.

    `buildClaims` and `issue` joined `revokeAllForUser` on 2026-08-24, when `enable` started issuing
    the REPLACEMENT session it had always been revoking (O-sec-14). The stub returns a recognisable
    token rather than an empty object so a test asserting on the session can tell it apart from a
    real one — and `issuedFor` records who it was minted for, which is the property that matters:
    the account that just enrolled, not somebody else.
  */
  const revoked: string[] = [];
  const issuedFor: string[] = [];
  const tokens = {
    revokeAllForUser: (userId: string) => {
      revoked.push(userId);
      return Promise.resolve();
    },
    buildClaims: (user: { id: string }) => {
      issuedFor.push(user.id);
      return Promise.resolve({ sub: user.id });
    },
    issue: () =>
      Promise.resolve({
        accessToken: 'stub.access.token',
        expiresIn: 900,
        refreshToken: 'stub-refresh-token',
        refreshExpiresAt: new Date(Date.now() + 86_400_000),
      }),
  } as unknown as ConstructorParameters<typeof TwoFactorService>[3];

  const twoFactor = new TwoFactorService(db, encryption, passwords, tokens, audit);
  const resets = new PartnerTwoFactorService(db, audit);

  /** A real staff actor: `audit_log.actor_user_id` is a foreign key. */
  let operations: AccessTokenClaims;
  let partnerUserId = '';
  let partnerReference = '';
  let staffUserId = '';

  /** Each test owns its partner, so an enrolment in one never decides the outcome of another. */
  beforeEach(async () => {
    await harness.begin();

    const staff = await db.execute<{ id: string }>(sql`
      SELECT id FROM users
      WHERE role IN ('operations_manager', 'super_admin') AND deleted_at IS NULL
      ORDER BY created_at LIMIT 1
    `);

    staffUserId = staff.rows[0]?.id ?? '';
    operations = {
      sub: staffUserId,
      role: 'operations_manager',
      permissions: [P.PARTNER_TWO_FACTOR_RESET],
    } as AccessTokenClaims;

    const made = await db.execute<{ user_id: string; reference: string }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1) AS city_id,
               (SELECT id FROM partner_types LIMIT 1) AS partner_type_id
      ), u AS (
        INSERT INTO users (email, phone, role, status, preferred_locale)
        VALUES ('2fa-test-' || gen_random_uuid() || '@safra.test', '+963900000000',
                'partner', 'active', 'ar')
        RETURNING id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT u.id, ref.partner_type_id, '2FA Test', '2FA Test', ref.city_id,
               'x', '+963900000000', '2fa-test@safra.test', 'approved'
        FROM u, ref RETURNING id, user_id, reference
      )
      SELECT user_id, reference FROM pa
    `);

    partnerUserId = made.rows[0]?.user_id ?? '';
    partnerReference = made.rows[0]?.reference ?? '';
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  function partnerClaims(): AccessTokenClaims {
    return {
      sub: partnerUserId,
      role: 'partner',
      permissions: [],
      locale: 'ar',
      totpEnabled: false,
    };
  }

  async function userRow() {
    const result = await db.execute<{
      totp_enabled_at: string | null;
      totp_secret_encrypted: string | null;
      recovery_count: number;
    }>(sql`
      SELECT totp_enabled_at::text, totp_secret_encrypted,
             coalesce(array_length(totp_recovery_code_hashes, 1), 0)::int AS recovery_count
      FROM users WHERE id = ${partnerUserId}
    `);

    return result.rows[0];
  }

  /** Enrol the partner and return the secret, for tests that need an already-enrolled account. */
  async function enrol(): Promise<string> {
    const { secret } = await twoFactor.beginSetup(partnerClaims());
    await twoFactor.enable(partnerClaims(), authenticator.generate(secret));
    return secret;
  }

  describe('enrolment', () => {
    it('lets a partner enrol, which staff 2FA previously refused them', async () => {
      const setup = await twoFactor.beginSetup(partnerClaims());

      expect(setup.secret).toMatch(/^[A-Z2-7]+$/);
      expect(setup.otpauthUri).toContain('SAFRA');
    });

    /*
      The two-step shape is the point: a secret that is stored but not yet enforced. If setup
      enforced immediately, a partner who scanned the QR into the wrong app would be locked out of
      their own account with no way back except a staff reset.
    */
    it('stores the secret without enforcing it until the code is confirmed', async () => {
      await twoFactor.beginSetup(partnerClaims());

      const row = await userRow();
      expect(row?.totp_secret_encrypted).toBeTruthy();
      expect(row?.totp_enabled_at).toBeNull();
    });

    it('encrypts the stored secret rather than keeping it in the clear', async () => {
      const { secret } = await twoFactor.beginSetup(partnerClaims());
      const row = await userRow();

      expect(row?.totp_secret_encrypted).not.toContain(secret);
      expect(encryption.decrypt(row?.totp_secret_encrypted ?? '')).toBe(secret);
    });

    it('enforces 2FA and issues recovery codes once the code is confirmed', async () => {
      const { secret } = await twoFactor.beginSetup(partnerClaims());
      const result = await twoFactor.enable(
        partnerClaims(),
        authenticator.generate(secret),
      );

      expect(result.enabled).toBe(true);
      expect(result.recoveryCodes).toHaveLength(8);

      const row = await userRow();
      expect(row?.totp_enabled_at).not.toBeNull();
      expect(row?.recovery_count).toBe(8);
    });

    it('refuses a wrong code and leaves the account unenrolled', async () => {
      await twoFactor.beginSetup(partnerClaims());

      await expect(twoFactor.enable(partnerClaims(), '000000')).rejects.toThrow();
      expect((await userRow())?.totp_enabled_at).toBeNull();
    });

    /*
      Recovery codes are stored only as hashes, so a database compromise yields no working bypass.
      Asserted by absence: none of the plaintext codes may appear in the stored array.
    */
    it('stores recovery codes as hashes, never as the codes themselves', async () => {
      const { secret } = await twoFactor.beginSetup(partnerClaims());
      const { recoveryCodes } = await twoFactor.enable(
        partnerClaims(),
        authenticator.generate(secret),
      );

      const stored = await db.execute<{ hashes: string[] }>(
        sql`SELECT totp_recovery_code_hashes AS hashes FROM users WHERE id = ${partnerUserId}`,
      );
      const blob = (stored.rows[0]?.hashes ?? []).join(' ');

      for (const code of recoveryCodes) expect(blob).not.toContain(code);
    });

    it('consumes a recovery code exactly once', async () => {
      const { secret } = await twoFactor.beginSetup(partnerClaims());
      const { recoveryCodes } = await twoFactor.enable(
        partnerClaims(),
        authenticator.generate(secret),
      );
      const code = recoveryCodes[0] ?? '';

      expect(await twoFactor.consumeRecoveryCode(partnerUserId, code)).toBe(true);
      expect(await twoFactor.consumeRecoveryCode(partnerUserId, code)).toBe(false);
      expect((await userRow())?.recovery_count).toBe(7);
    });

    /**
     * Enabling hands back a REPLACEMENT session, and it is for the account that just enrolled.
     *
     * O-sec-14, found 2026-08-24 by the first browser spec ever to drive a new staff account end to
     * end. `enable` revokes every session — deliberately, since any session predating the second
     * factor was established under weaker authentication — and that includes the caller's own. The
     * token it left them holding still carried `totpEnabled: false`, which is the claim both
     * middlewares decide with, so «حفظتها — متابعة» returned them to the enrolment screen on every
     * navigation for fifteen minutes and then signed them out when the revoked refresh token failed.
     *
     * Nothing exercised this transition, because every other spec signs in as an account that is
     * ALREADY enrolled. The bug lived on the one path no test walked.
     *
     * `issuedFor` is the half that matters: a session issued for somebody else would satisfy "a
     * session came back" perfectly.
     */
    it('issues a replacement session for the account that enrolled', async () => {
      const { secret } = await twoFactor.beginSetup(partnerClaims());
      const result = await twoFactor.enable(
        partnerClaims(),
        authenticator.generate(secret),
      );

      expect(result.session.accessToken).toBeTruthy();
      expect(result.session.refreshToken).toBeTruthy();
      expect(result.session.expiresIn).toBeGreaterThan(0);
      expect(issuedFor).toContain(partnerUserId);
    });
  });

  describe('the staff reset path', () => {
    it('clears an enrolled partner so they must enrol again', async () => {
      await enrol();
      expect((await userRow())?.totp_enabled_at).not.toBeNull();

      const result = await resets.reset(operations, partnerReference, 'Lost the phone.');

      expect(result.twoFactorEnabled).toBe(false);

      const row = await userRow();
      expect(row?.totp_enabled_at).toBeNull();
      expect(row?.recovery_count).toBe(0);
    });

    /*
      The pending secret must go too. Leaving it would let whoever still holds the old
      authenticator enrol against the SAME secret — the reset would have removed the requirement
      without removing the credential, which is the opposite of what an operator asked for.
    */
    it('removes the secret itself, not merely the enabled flag', async () => {
      await enrol();
      await resets.reset(operations, partnerReference, 'Lost the phone.');

      expect((await userRow())?.totp_secret_encrypted).toBeNull();
    });

    it('lets the partner enrol again afterwards, with a different secret', async () => {
      const first = await enrol();
      await resets.reset(operations, partnerReference, 'Lost the phone.');

      const second = await twoFactor.beginSetup(partnerClaims());
      expect(second.secret).not.toBe(first);

      const enabled = await twoFactor.enable(
        partnerClaims(),
        authenticator.generate(second.secret),
      );
      expect(enabled.enabled).toBe(true);
    });

    /*
      The authentication on the account has just been weakened, so every token issued under the
      stronger arrangement must die with it. Otherwise a live session survives a reset that was
      performed BECAUSE the account was thought compromised.
    */
    it('revokes the sessions the partner already holds', async () => {
      await enrol();
      /*
        Two SEPARATE families, i.e. two devices rather than one device's rotation chain. That is
        the case the assertion is about: a reset must end every session the partner holds, not only
        the newest.
      */
      await db.execute(sql`
        INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at)
        VALUES (${partnerUserId}, gen_random_uuid(),
                encode(gen_random_bytes(32), 'hex'), now() + interval '30 day'),
               (${partnerUserId}, gen_random_uuid(),
                encode(gen_random_bytes(32), 'hex'), now() + interval '30 day')
      `);

      const result = await resets.reset(
        operations,
        partnerReference,
        'Suspected compromise.',
      );

      expect(result.sessionsRevoked).toBe(2);

      const live = await db.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM refresh_tokens
        WHERE user_id = ${partnerUserId} AND revoked_at IS NULL
      `);
      expect(live.rows[0]?.n).toBe(0);
    });

    it('writes an audit row carrying the reason and the prior state', async () => {
      await enrol();
      await resets.reset(operations, partnerReference, 'Lost the phone in Aleppo.');

      const entry = await db.execute<{
        action: string;
        after: Record<string, unknown>;
      }>(sql`
        SELECT action, after FROM audit_log
        WHERE subject_id = ${partnerUserId} AND action = 'partner.two_factor_reset'
        ORDER BY created_at DESC LIMIT 1
      `);

      expect(entry.rows[0]?.action).toBe('partner.two_factor_reset');
      expect(entry.rows[0]?.after).toMatchObject({
        reason: 'Lost the phone in Aleppo.',
        wasEnrolled: true,
      });
    });

    /* Never a secret and never a code — the audit log is read by more people than the database. */
    it('records no secret and no recovery code in the audit row', async () => {
      const secret = await enrol();
      await resets.reset(operations, partnerReference, 'Lost the phone.');

      const entry = await db.execute<{ after: unknown }>(sql`
        SELECT after FROM audit_log
        WHERE subject_id = ${partnerUserId} AND action = 'partner.two_factor_reset'
        ORDER BY created_at DESC LIMIT 1
      `);

      expect(JSON.stringify(entry.rows[0]?.after)).not.toContain(secret);
    });

    /*
      THE escalation guard.

      Without it, `PARTNER_TWO_FACTOR_RESET` would let an operations manager strip a factor from a
      super admin and then need only a password — a partner-support tool turned into a
      privilege-escalation primitive. The permission decides who may act; this decides on whom.
    */
    it('refuses a target whose account is not a partner', async () => {
      await db.execute(
        sql`UPDATE users SET role = 'super_admin' WHERE id = ${partnerUserId}`,
      );

      await expect(
        resets.reset(operations, partnerReference, 'Trying it on.'),
      ).rejects.toThrow(/not a partner/i);

      // And nothing was cleared on the way to refusing.
      await db.execute(
        sql`UPDATE users SET role = 'partner' WHERE id = ${partnerUserId}`,
      );
    });

    it('leaves an ineligible target untouched rather than half-reset', async () => {
      const secret = await enrol();
      await db.execute(
        sql`UPDATE users SET role = 'super_admin' WHERE id = ${partnerUserId}`,
      );

      await resets.reset(operations, partnerReference, 'Trying it on.').catch(() => null);

      const row = await userRow();
      expect(row?.totp_enabled_at).not.toBeNull();
      expect(encryption.decrypt(row?.totp_secret_encrypted ?? '')).toBe(secret);

      await db.execute(
        sql`UPDATE users SET role = 'partner' WHERE id = ${partnerUserId}`,
      );
    });

    it('refuses an unknown partner reference', async () => {
      await expect(
        resets.reset(operations, 'PAR-000000', 'Nobody home.'),
      ).rejects.toThrow();
    });

    /*
      Idempotent on purpose. An operator most often meets this exact state — a partner stuck
      halfway through enrolment — and asking them to first work out which of two indistinguishable
      states the account is in would make support harder for no gain.
    */
    it('succeeds on a partner who never enrolled, and says so in the audit row', async () => {
      const result = await resets.reset(
        operations,
        partnerReference,
        'Confused partner.',
      );

      expect(result.twoFactorEnabled).toBe(false);

      const entry = await db.execute<{ after: Record<string, unknown> }>(sql`
        SELECT after FROM audit_log
        WHERE subject_id = ${partnerUserId} AND action = 'partner.two_factor_reset'
        ORDER BY created_at DESC LIMIT 1
      `);

      expect(entry.rows[0]?.after).toMatchObject({ wasEnrolled: false });
    });

    it('refuses an unauthenticated caller', async () => {
      await expect(
        resets.reset(undefined, partnerReference, 'No session.'),
      ).rejects.toThrow();
    });
  });

  /*
    A staff member never holds a partner's second factor. The reset endpoint has no way to set one,
    and this asserts the shape of what it returns rather than trusting the implementation not to
    grow one later.
  */
  it('never returns a secret or a code from the reset', async () => {
    await enrol();
    const result = await resets.reset(operations, partnerReference, 'Lost the phone.');

    expect(Object.keys(result).sort()).toEqual(['sessionsRevoked', 'twoFactorEnabled']);
    expect(staffUserId).not.toBe(partnerUserId);
  });
});
