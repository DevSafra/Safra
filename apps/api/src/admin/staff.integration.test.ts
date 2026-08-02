import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, type Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { AuthTokenService } from '../auth/auth-token.service.js';
import { PasswordService } from '../common/crypto/password.service.js';
import { StaffService } from './staff.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import type { MailService, OutgoingMail } from '../mail/mail.service.js';
import type { TokenService } from '../auth/token.service.js';

/**
 * Staff provisioning against a REAL PostgreSQL (M-5).
 *
 * The properties worth pinning are the refusals. Creating an account is the easy
 * half; what makes this safe is that an administrator cannot quietly widen their own
 * access, cannot lock themselves out, and cannot leave the platform with no
 * administrator at all — and that an invited account is unusable until its owner
 * accepts.
 *
 * Skipped when DATABASE_URL is unset; CI provisions a database and runs it.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('StaffService', () => {
  const db: Database = createDatabase(DATABASE_URL ?? '', 2);

  /** Captures what would have been emailed, so the invitation link is inspectable. */
  const sent: OutgoingMail[] = [];
  const mail = {
    send: (m: OutgoingMail) => {
      sent.push(m);
      return Promise.resolve();
    },
  } as unknown as MailService;

  const revoked: string[] = [];
  const tokens = {
    revokeAllForUser: (id: string) => {
      revoked.push(id);
      return Promise.resolve();
    },
  } as unknown as TokenService;

  const service = new StaffService(
    db,
    { ADMIN_URL: 'https://admin.safra.example' } as never,
    new AuditService(db),
    new AuthTokenService(db),
    mail,
    new PasswordService(),
    tokens,
  );

  const admin = (id: string): AccessTokenClaims =>
    ({ sub: id, role: 'super_admin', permissions: [], locale: 'en' }) as never;

  /** Unique per run so repeated runs cannot collide on the email uniqueness rule. */
  let run = 0;
  const created: string[] = [];

  function address(label: string): string {
    return `m5-${process.pid}-${run}-${label}@safra.test`;
  }

  beforeEach(() => {
    run += 1;
    sent.length = 0;
    revoked.length = 0;
  });

  /**
   * Cleanup SOFT-deletes, because a hard delete is impossible by design.
   *
   * These tests write audit rows, `audit_log` is append-only by trigger, and
   * `audit_log.actor_user_id` is a foreign key to `users` — so any account that has
   * ever done anything cannot be removed from the table. That is the intended
   * behaviour (deleting an account must not erase what it did), and it is the same
   * path the application would take. Addresses are namespaced by pid and run counter,
   * so leaving the rows behind cannot collide with a later run.
   */
  afterAll(async () => {
    await db.execute(sql`
      UPDATE users SET deleted_at = now(), status = 'archived'
      WHERE email LIKE ${`m5-${process.pid}-%@safra.test`} AND deleted_at IS NULL
    `);

    await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
  });

  async function invite(label: string, role = 'support_agent' as const) {
    const result = await service.invite(admin(SUPER_ADMIN_ID), {
      email: address(label),
      role,
    });
    created.push(result.id);
    return result;
  }

  /** A real super admin to act as, and to satisfy the last-admin check. */
  let SUPER_ADMIN_ID = '';

  describe('inviting', () => {
    it('creates an account that cannot yet be used', async () => {
      await seedSuperAdmin();
      const invited = await invite('a');

      const row = await db.execute<{ password_hash: string | null; status: string }>(
        sql`SELECT password_hash, status::text AS status FROM users WHERE id = ${invited.id}`,
      );

      /**
       * No password is the whole design: `AuthService.login` rejects a null hash, so
       * the inviter never knows a credential for an account they created.
       */
      expect(row.rows[0]?.password_hash).toBeNull();
      expect(row.rows[0]?.status).toBe('active');
    });

    it('emails a single-use link to the invitee', async () => {
      await seedSuperAdmin();
      await invite('b');

      expect(sent).toHaveLength(1);
      expect(sent[0]?.text).toContain('https://admin.safra.example/invitation/');
    });

    it('reports the invitation as pending until it is accepted', async () => {
      await seedSuperAdmin();
      const invited = await invite('c');

      const listed = (await service.list()).find((s) => s.id === invited.id);

      expect(listed?.invitationPending).toBe(true);
      expect(listed?.twoFactorEnabled).toBe(false);
    });

    it('refuses a non-staff role', async () => {
      await seedSuperAdmin();

      await expect(
        service.invite(admin(SUPER_ADMIN_ID), {
          // `Role` includes customer, so only the runtime guard catches this — which
          // is the point: the type system does not distinguish staff from customer.
          email: address('cust'),
          role: 'customer',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    /**
     * Inviting an address that already exists must not silently upgrade it. Turning a
     * customer account into a super admin would be an escalation that reads as an
     * ordinary invitation in the audit log.
     */
    it('refuses an email that already has an account', async () => {
      await seedSuperAdmin();
      const first = await invite('dup');

      await expect(
        service.invite(admin(SUPER_ADMIN_ID), {
          email: first.email,
          role: 'support_agent',
        }),
      ).rejects.toThrow(/already exists/i);
    });
  });

  describe('accepting an invitation', () => {
    it('sets the password and makes the account usable', async () => {
      await seedSuperAdmin();
      const invited = await invite('accept');
      const token = tokenFromMail();

      await service.acceptInvitation(token, 'a-strong-password-1');

      const row = await db.execute<{ password_hash: string | null }>(
        sql`SELECT password_hash FROM users WHERE id = ${invited.id}`,
      );

      expect(row.rows[0]?.password_hash).not.toBeNull();
    });

    /** Single-use. A link that has been transmitted is spent. */
    it('cannot be redeemed twice', async () => {
      await seedSuperAdmin();
      await invite('twice');
      const token = tokenFromMail();

      await service.acceptInvitation(token, 'a-strong-password-1');

      await expect(
        service.acceptInvitation(token, 'another-strong-password-1'),
      ).rejects.toThrow(/invalid or has already been used/i);
    });

    /**
     * Purpose isolation. An invitation is the only token that turns a passwordless
     * account into a usable one, so a password-reset token must not do it — and the
     * message must not reveal which of the two failed.
     */
    it('refuses a token issued for a different purpose', async () => {
      await seedSuperAdmin();
      const invited = await invite('purpose');

      const reset = await new AuthTokenService(db).issue(
        invited.id,
        'password_reset',
        60_000,
      );

      await expect(
        service.acceptInvitation(reset.token, 'a-strong-password-1'),
      ).rejects.toThrow(/invalid or has already been used/i);
    });

    it('does not say whether a bad token expired, was used, or never existed', async () => {
      await seedSuperAdmin();

      const message = await service
        .acceptInvitation('a'.repeat(43), 'a-strong-password-1')
        .catch((e: Error) => e.message);

      expect(message).not.toMatch(/expired|consumed|unknown|not found/i);
    });
  });

  describe('the refusals', () => {
    it('refuses to let an administrator change their own role', async () => {
      await seedSuperAdmin();

      await expect(
        service.changeRole(admin(SUPER_ADMIN_ID), SUPER_ADMIN_ID, 'support_agent'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses to let an administrator suspend themselves', async () => {
      await seedSuperAdmin();

      await expect(
        service.setStatus(admin(SUPER_ADMIN_ID), SUPER_ADMIN_ID, 'suspended'),
      ).rejects.toThrow(ForbiddenException);
    });

    /**
     * Nothing but `super_admin` holds `staff.manage`, so removing the last one leaves
     * the platform permanently unadministrable — no invitations, no role changes, and
     * no way back except the production INSERT this feature exists to eliminate.
     */
    it('refuses to demote the last active super admin', async () => {
      const only = await seedSuperAdmin();
      // Seeded BEFORE the suspension so it is suspended too — an actor who is not
      // themselves an active super admin, which is what isolates the check.
      const actor = await seedSuperAdmin('other');
      const restore = await asOnlySuperAdmin(only);

      try {
        await expect(
          service.changeRole(admin(only), only, 'support_agent'),
        ).rejects.toThrow(ForbiddenException); // self-change is caught first

        await expect(
          service.changeRole(admin(actor), only, 'support_agent'),
        ).rejects.toThrow(/last active super admin/i);
      } finally {
        await restore();
      }
    });

    it('refuses to suspend the last active super admin', async () => {
      const only = await seedSuperAdmin();
      const actor = await seedSuperAdmin('other');
      const restore = await asOnlySuperAdmin(only);

      try {
        await expect(service.setStatus(admin(actor), only, 'suspended')).rejects.toThrow(
          /last active super admin/i,
        );
      } finally {
        await restore();
      }
    });
  });

  describe('revoking access takes effect immediately', () => {
    /**
     * A demotion that waits out the 15-minute access-token lifetime is not a
     * demotion — that window is exactly when someone who has just lost access would
     * act.
     */
    it('revokes sessions on a role change', async () => {
      await seedSuperAdmin();
      const target = await invite('revoke-role');

      await service.changeRole(admin(SUPER_ADMIN_ID), target.id, 'finance_officer');

      expect(revoked).toContain(target.id);
    });

    it('revokes sessions on suspension', async () => {
      await seedSuperAdmin();
      const target = await invite('revoke-susp');

      await service.setStatus(admin(SUPER_ADMIN_ID), target.id, 'suspended');

      expect(revoked).toContain(target.id);
    });
  });

  /** The invitation link the service emailed, reduced to its token. */
  function tokenFromMail(): string {
    const url = /invitation\/([\w-]+)/.exec(sent.at(-1)?.text ?? '');
    if (!url?.[1]) throw new Error('No invitation link was emailed.');

    return url[1];
  }

  /** An activated super admin to act as. Reused across tests within a run. */
  async function seedSuperAdmin(label = 'root'): Promise<string> {
    const email = address(label);

    const existing = await db.execute<{ id: string }>(
      sql`SELECT id FROM users WHERE email = ${email}`,
    );

    if (existing.rows[0]) {
      if (label === 'root') SUPER_ADMIN_ID = existing.rows[0].id;
      return existing.rows[0].id;
    }

    const row = await db.execute<{ id: string }>(sql`
      INSERT INTO users (email, password_hash, role, status, preferred_locale,
                         email_verified_at)
      VALUES (${email}, 'x', 'super_admin', 'active', 'en', now())
      RETURNING id
    `);

    const id = row.rows[0]?.id ?? '';
    created.push(id);
    if (label === 'root') SUPER_ADMIN_ID = id;

    return id;
  }

  /**
   * Makes `keep` the only ACTIVE super admin, and returns a function that puts every
   * other one back.
   *
   * The last-admin check counts rows in a shared database, so it cannot be asserted
   * without temporarily changing what is there. Restoring is not optional: other
   * suites sign in as those accounts and vitest runs files in parallel, so leaving
   * them suspended would break unrelated tests in a way that looks like a flake.
   */
  async function asOnlySuperAdmin(keep: string): Promise<() => Promise<void>> {
    const others = await db.execute<{ id: string }>(sql`
      SELECT id FROM users
      WHERE role = 'super_admin' AND status = 'active' AND id <> ${keep}
    `);

    const ids = others.rows.map((row) => row.id);
    if (ids.length === 0) return () => Promise.resolve();

    const list = sql.raw(`ARRAY['${ids.join("','")}']::uuid[]`);

    await db.execute(sql`UPDATE users SET status='suspended' WHERE id = ANY(${list})`);

    return async () => {
      await db.execute(sql`UPDATE users SET status='active' WHERE id = ANY(${list})`);
    };
  }
});
