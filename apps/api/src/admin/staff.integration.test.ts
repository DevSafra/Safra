import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

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
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  /* Every row this suite writes is discarded when the test that wrote it ends. */
  const db: Database = harness.db;

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

  beforeEach(async () => {
    await harness.begin();

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
  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  /**
   * The id of the seeded role that admits as a given enum value.
   *
   * `changeRole` takes a `staffRoleId` since 2026-08-23, not an enum — the role row decides what
   * somebody may do and its `admits_as` decides which enum they hold. The four roles that used to
   * BE the enum are seeded rows now (`post/0008`), so a test that wants "make them a support agent"
   * asks for the role that admits as one.
   */
  const roleAdmitting = async (admitsAs: string): Promise<string> => {
    const rows = await db.execute<{ id: string }>(sql`
      SELECT id FROM staff_roles
      WHERE admits_as = ${admitsAs}::user_role AND deleted_at IS NULL
      LIMIT 1
    `);

    const id = rows.rows[0]?.id;

    if (!id) throw new Error(`no seeded role admits as ${admitsAs}`);

    return id;
  };

  async function invite(label: string, admitsAs = 'support_agent' as const) {
    const result = await service.invite(admin(SUPER_ADMIN_ID), {
      email: address(label),
      staffRoleId: await roleAdmitting(admitsAs),
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

      const listed = (await service.list({ limit: 100, page: 1 })).items.find(
        (member) => member.id === invited.id,
      );

      expect(listed?.invitationPending).toBe(true);
      expect(listed?.twoFactorEnabled).toBe(false);
    });

    it('refuses a non-staff role', async () => {
      await seedSuperAdmin();

      await expect(
        service.invite(admin(SUPER_ADMIN_ID), {
          email: address('cust'),
          /*
            A role id that does not exist. The enum version of this test invited as `customer` to
            prove the runtime guard caught what the type system could not; since 2026-08-23 an
            invitation names a ROLE ROW, so the equivalent hole is an id nobody issued — and the
            guard that catches it is the lookup, not a role check.
          */
          staffRoleId: '00000000-0000-0000-0000-0000000000ee',
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
          staffRoleId: await roleAdmitting('support_agent'),
        }),
      ).rejects.toThrow(/already exists/i);
    });
  });

  /**
   * The WINDOW: an invited staff member holds their named role's permissions from the moment they
   * redeem, never an enum's (2026-08-23).
   *
   * ## What this is guarding
   *
   * Inviting used to take an enum value, so putting somebody into a custom role was invite-then-
   * change — and between those two actions `staff_role_id` was null, so resolution fell back to
   * `ROLE_PERMISSIONS[whichever enum was chosen]`. Somebody destined for a narrow role carried the
   * full support-agent set until a second step that nothing forced anybody to take.
   *
   * ## Why it is here rather than in the browser suite
   *
   * The console can drive everything up to the invitation being sent, and no further: redeeming
   * needs a mailbox and a password satisfying `passwordSchema`, which the shared testbed password
   * cannot. So the half that matters — what the account carries AFTER redemption — is proved here
   * or it is not proved at all.
   */
  describe('what an invited staff member actually carries', () => {
    /** A password the policy accepts. `TESTBED_PASSWORD` has no uppercase and would be refused. */
    const PASSWORD = 'A-real-Password-9';

    const claimsFor = async (userId: string) => {
      const rows = await db.execute<{
        permissions: string[] | null;
        staff_role_id: string;
      }>(sql`
        SELECT u.staff_role_id, r.permissions
        FROM users u
        LEFT JOIN staff_roles r ON r.id = u.staff_role_id AND r.deleted_at IS NULL
        WHERE u.id = ${userId}::uuid
      `);

      return rows.rows[0];
    };

    it('attaches the named role at INVITE time, not after a second step', async () => {
      await seedSuperAdmin();

      const narrow = await db.execute<{ id: string }>(sql`
        INSERT INTO staff_roles (name, permissions, admits_as)
        VALUES ('ضيّق-' || gen_random_uuid(), ARRAY['booking.read_all'], 'support_agent')
        RETURNING id
      `);

      const roleId = narrow.rows[0]?.id ?? '';
      const invited = await service.invite(admin(SUPER_ADMIN_ID), {
        email: address('narrow'),
        staffRoleId: roleId,
      });

      created.push(invited.id);

      const row = await claimsFor(invited.id);

      /* The window closes HERE — before redemption, not after a follow-up action. */
      expect(row?.staff_role_id).toBe(roleId);
      expect(row?.permissions).toEqual(['booking.read_all']);
    });

    /**
     * And redeeming does not widen it.
     *
     * `acceptInvitation` sets a password and verifies the address; it must not touch the role. If
     * it did, the narrow role would survive the invitation and be lost at the moment the person
     * actually starts using the account.
     */
    it('still carries the narrow role after the invitation is redeemed', async () => {
      await seedSuperAdmin();

      const narrow = await db.execute<{ id: string }>(sql`
        INSERT INTO staff_roles (name, permissions, admits_as)
        VALUES ('ضيّق2-' || gen_random_uuid(), ARRAY['booking.read_all'], 'support_agent')
        RETURNING id
      `);

      const roleId = narrow.rows[0]?.id ?? '';
      const invited = await service.invite(admin(SUPER_ADMIN_ID), {
        email: address('redeem'),
        staffRoleId: roleId,
      });

      created.push(invited.id);

      /*
        The REAL token, out of the captured invitation mail. It is returned once and stored only as
        a hash, so the database cannot give it back — reading it from the message is the only way to
        redeem in a test, and it is also what proves the link we send actually works.
      */
      const link = sent.at(-1)?.text ?? '';
      const token = /\/invitation\/([A-Za-z0-9_-]+)/.exec(link)?.[1] ?? '';

      expect(token).not.toBe('');

      await service.acceptInvitation(token, PASSWORD);

      const row = await claimsFor(invited.id);

      /* Redemption sets a password and verifies the address. It must not touch the role. */
      expect(row?.staff_role_id).toBe(roleId);
      expect(row?.permissions).toEqual(['booking.read_all']);

      const account = await db.execute<{ has_password: boolean }>(sql`
        SELECT password_hash IS NOT NULL AS has_password FROM users
        WHERE id = ${invited.id}::uuid
      `);

      /* And it did redeem — otherwise the two assertions above pass on an un-redeemed account. */
      expect(account.rows[0]?.has_password).toBe(true);
    });

    /**
     * The CONTROL, and without it the two above prove nothing.
     *
     * If a named role granted nothing at all, «carries booking.read_all» would still fail — but
     * «does not carry the support-agent set» would pass over an account with no permissions
     * whatsoever. This asserts the difference is the ROLE rather than emptiness.
     */
    it('does not carry the enum’s permission set as well', async () => {
      await seedSuperAdmin();

      const narrow = await db.execute<{ id: string }>(sql`
        INSERT INTO staff_roles (name, permissions, admits_as)
        VALUES ('ضيّق3-' || gen_random_uuid(), ARRAY['booking.read_all'], 'support_agent')
        RETURNING id
      `);

      const invited = await service.invite(admin(SUPER_ADMIN_ID), {
        email: address('narrow3'),
        staffRoleId: narrow.rows[0]?.id ?? '',
      });

      created.push(invited.id);

      const row = await claimsFor(invited.id);

      /* Exactly one capability — not the twenty-odd a support agent holds by enum. */
      expect(row?.permissions).toHaveLength(1);
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

  /**
   * The staff list is paginated (2026-08-05).
   *
   * It returned every row until then. Rule 2 has required pagination on every list endpoint
   * since the project started, and this one was the exception nobody noticed because a staff
   * list sounds small — an unbounded list endpoint is a DoS vector however slowly it grows.
   */
  describe('pagination', () => {
    it('returns a page, a total and a page count', async () => {
      await seedSuperAdmin();
      for (const suffix of ['p1', 'p2', 'p3']) await invite(suffix);

      const first = await service.list({ limit: 2, page: 1 });

      expect(first.items).toHaveLength(2);
      expect(first.page).toBe(1);

      /*
        The total counts the whole set, not the page — that is the number the console prints under
        the table, and a total that only counted the page would read "2 found" on every page.
      */
      expect(first.total).toBeGreaterThanOrEqual(4);
      expect(first.pages).toBe(Math.ceil(first.total / 2));
    });

    /** Consecutive pages do not overlap. */
    it('page two shows different rows from page one', async () => {
      await seedSuperAdmin();
      for (const suffix of ['q1', 'q2', 'q3']) await invite(suffix);

      const first = await service.list({ limit: 2, page: 1 });
      const second = await service.list({ limit: 2, page: 2 });

      const firstIds = first.items.map((member) => member.id);
      const secondIds = second.items.map((member) => member.id);

      expect(secondIds.filter((id) => firstIds.includes(id))).toStrictEqual([]);
    });

    /**
     * Walking one row at a time visits the same rows, in the same order, as one larger page.
     *
     * Deliberately NOT "walks every row": the development database holds more staff than the
     * API's 100-row ceiling, so a full walk and a single page are truncated by different limits
     * and comparing them fails for a reason that has nothing to do with pagination. Comparing
     * the FIRST N rows either way is what a stable ORDER BY promises across page boundaries.
     */
    it('walks the same rows one at a time as it does in one page', async () => {
      await seedSuperAdmin();
      for (const suffix of ['w1', 'w2', 'w3']) await invite(suffix);

      const SIZE = 5;
      const inOnePage = (await service.list({ limit: SIZE, page: 1 })).items.map(
        (m) => m.id,
      );

      const walked: string[] = [];

      // Page size one is the harshest walk: every row is a page boundary.
      for (let page = 1; page <= SIZE; page += 1) {
        const result = await service.list({ limit: 1, page });

        walked.push(...result.items.map((m) => m.id));
      }

      expect(walked).toStrictEqual(inOnePage);
    });

    /**
     * A page past the end is empty, not an error.
     *
     * The reader can type a page number, so out-of-range is a normal input rather than an attack:
     * an empty table with the total still shown tells them where they are, whereas a 400 loses the
     * screen. The schema's ceiling is what stops a hostile `?page=1e9` from costing a deep scan.
     */
    it('returns an empty page past the last one', async () => {
      await seedSuperAdmin();

      const result = await service.list({ limit: 10, page: 100_000 });

      expect(result.items).toStrictEqual([]);
      expect(result.total).toBeGreaterThan(0);
    });
  });

  describe('the refusals', () => {
    it('refuses to let an administrator change their own role', async () => {
      await seedSuperAdmin();

      await expect(
        service.changeRole(
          admin(SUPER_ADMIN_ID),
          SUPER_ADMIN_ID,
          await roleAdmitting('support_agent'),
        ),
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
          service.changeRole(admin(only), only, await roleAdmitting('support_agent')),
        ).rejects.toThrow(ForbiddenException); // self-change is caught first

        await expect(
          service.changeRole(admin(actor), only, await roleAdmitting('support_agent')),
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

      await service.changeRole(
        admin(SUPER_ADMIN_ID),
        target.id,
        await roleAdmitting('finance_officer'),
      );

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
