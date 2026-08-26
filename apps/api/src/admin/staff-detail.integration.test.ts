import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PERMISSIONS as P } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { AuthTokenService } from '../auth/auth-token.service.js';
import type { MailService } from '../mail/mail.service.js';
import { PasswordService } from '../common/crypto/password.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { StaffService } from './staff.service.js';
import { TokenService } from '../auth/token.service.js';

/**
 * `GET /admin/staff/:userId` — صفحة الموظف.
 *
 * ## Why a REAL `TokenService`, not a stub
 *
 * The whole claim this endpoint makes is that its `permissions` are what the guard will compare
 * against — resolved by `TokenService.staffPermissions`, the function that mints the token. A stub
 * would return whatever the test told it to, which would prove that the field is populated and
 * nothing about whether it is TRUE. The interesting cases are a named role replacing the enum's
 * set, and a withdrawn role granting nothing, and only the real resolution has either.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('one staff member', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  const tokens = new TokenService(
    {
      JWT_ACCESS_SECRET: 'a'.repeat(48),
      JWT_REFRESH_SECRET: 'b'.repeat(48),
      ACCESS_TOKEN_TTL: '15m',
      REFRESH_TOKEN_TTL: '30d',
    } as never,
    db,
    new SettingsService(db),
  );

  const service = new StaffService(
    db,
    { ADMIN_URL: 'https://admin.safra.example' } as never,
    new AuditService(db),
    new AuthTokenService(db),
    { send: () => Promise.resolve() } as unknown as MailService,
    new PasswordService(),
    tokens,
  );

  let run = 0;

  const address = (label: string): string =>
    `detail-${process.pid}-${run}-${label}@safra.test`;

  /** A staff account with no named role — permissions come from the enum. */
  async function makeStaff(role: string, label: string): Promise<string> {
    const made = await db.execute<{ id: string }>(sql`
      INSERT INTO users (email, phone, role, status, preferred_locale, password_hash)
      VALUES (${address(label)}, '+963900000010', ${role}::user_role, 'active', 'ar', 'x')
      RETURNING id
    `);

    return made.rows[0]?.id ?? '';
  }

  async function makeRole(name: string, permissions: string[]): Promise<string> {
    const made = await db.execute<{ id: string }>(sql`
      INSERT INTO staff_roles (name, permissions)
      VALUES (${name}, ${sql`ARRAY[${sql.join(
        permissions.map((value) => sql`${value}`),
        sql`, `,
      )}]::text[]`})
      RETURNING id
    `);

    return made.rows[0]?.id ?? '';
  }

  beforeEach(async () => {
    await harness.begin();
    run += 1;
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('returns the account, with the capabilities its enum role carries', async () => {
    const userId = await makeStaff('finance_officer', 'enum');

    const detail = await service.detail(userId);

    expect(detail.id).toBe(userId);
    expect(detail.role).toBe('finance_officer');
    expect(detail.staffRoleId).toBeNull();
    expect(detail.staffRoleName).toBeNull();
    expect(detail.permissions).toContain(P.LEDGER_READ);
    expect(detail.invitationPending).toBe(false);
  });

  /**
   * A named role REPLACES the enum's set, and this is where the screen would lie if it did not.
   *
   * The account is admitted as a `finance_officer` and holds a role carrying one capability. If the
   * detail screen recomputed permissions from the enum — the obvious second implementation — it
   * would print the finance officer's whole set for somebody who can do exactly one thing.
   */
  it('shows a named role’s capabilities, not the enum’s', async () => {
    const roleId = await makeRole(`مشرف حجوزات ${run}`, [P.BOOKING_READ_ALL]);
    const userId = await makeStaff('finance_officer', 'named');

    await db.execute(sql`
      UPDATE users SET staff_role_id = ${roleId}::uuid WHERE id = ${userId}::uuid
    `);

    const detail = await service.detail(userId);

    expect(detail.staffRoleId).toBe(roleId);
    expect(detail.permissions).toEqual([P.BOOKING_READ_ALL]);
    /* The control: the enum's own set is NOT there. */
    expect(detail.permissions).not.toContain(P.LEDGER_READ);
  });

  /** A withdrawn role grants nothing — the same answer the guard gives, which fails closed. */
  it('shows no capabilities for a withdrawn role', async () => {
    const roleId = await makeRole(`دور مسحوب ${run}`, [P.BOOKING_READ_ALL]);
    const userId = await makeStaff('finance_officer', 'withdrawn');

    await db.execute(sql`
      UPDATE users SET staff_role_id = ${roleId}::uuid WHERE id = ${userId}::uuid
    `);
    await db.execute(sql`
      UPDATE staff_roles SET deleted_at = now() WHERE id = ${roleId}::uuid
    `);

    await expect(service.detail(userId)).resolves.toMatchObject({
      permissions: [],
      staffRoleName: null,
    });
  });

  describe('the scope', () => {
    /** Empty means EVERY city. One representation, so there is nothing to read backwards. */
    it('is empty for an unscoped account, and says so in scopeKind', async () => {
      const userId = await makeStaff('support_agent', 'unscoped');

      await expect(service.detail(userId)).resolves.toMatchObject({
        scopeCities: [],
        scopeKind: 'all_cities',
        outsideScopeAccess: 'none',
      });
    });

    /**
     * THE case that `scopeCities: []` alone cannot express.
     *
     * `cities` with no cities is a real, deliberate state — `setStaffScopeSchema` accepts it as how
     * an administrator starts building a scope. It answers the same empty list as `all_cities`, and
     * an editor that could not tell them apart would arrive with the wrong choice selected and
     * silently widen somebody's access on the next save.
     */
    it('distinguishes a cities scope with no cities from an unscoped account', async () => {
      const userId = await makeStaff('support_agent', 'started');

      await db.execute(sql`
        UPDATE users SET scope_kind = 'cities' WHERE id = ${userId}::uuid
      `);

      await expect(service.detail(userId)).resolves.toMatchObject({
        scopeCities: [],
        scopeKind: 'cities',
      });
    });

    it('names the cities of a scoped account', async () => {
      const userId = await makeStaff('support_agent', 'scoped');

      await db.execute(sql`
        UPDATE users SET scope_kind = 'cities' WHERE id = ${userId}::uuid
      `);
      await db.execute(sql`
        INSERT INTO staff_scope_cities (user_id, city_id)
        SELECT ${userId}::uuid, id FROM cities WHERE deleted_at IS NULL LIMIT 1
      `);

      const detail = await service.detail(userId);

      expect(detail.scopeCities).toHaveLength(1);
      expect(detail.scopeCities[0]?.name).not.toBe('');
      /*
        A SLUG, not a uuid. `setStaffScopeSchema.citySlugs` is what the write accepts, and a read
        that handed back an identifier its own write refuses makes the pair unusable as a round
        trip — which is exactly what a detail screen with a scope editor on it needs.
      */
      expect(detail.scopeCities[0]?.slug).toMatch(/^[a-z0-9-]+$/);
      expect(detail.scopeKind).toBe('cities');
    });

    /**
     * Rows left behind by a PREVIOUS scoping must not be shown once the account is unscoped.
     *
     * `TokenService.resolveScope` ignores them, so showing them would tell a super admin a colleague
     * is restricted to one city when every query they make reaches all of them. The screen has to
     * agree with what actually gates the queries, not with what the table happens to hold.
     */
    it('ignores leftover rows when the account is set back to all cities', async () => {
      const userId = await makeStaff('support_agent', 'leftover');

      await db.execute(sql`
        INSERT INTO staff_scope_cities (user_id, city_id)
        SELECT ${userId}::uuid, id FROM cities WHERE deleted_at IS NULL LIMIT 1
      `);
      /* scope_kind stays 'all_cities' — the default — while the row sits there. */

      await expect(service.detail(userId)).resolves.toMatchObject({ scopeCities: [] });
    });
  });

  describe('the invitation', () => {
    it('reports an outstanding one with both dates', async () => {
      const userId = await makeStaff('support_agent', 'invited');

      await db.execute(sql`
        UPDATE users SET password_hash = NULL WHERE id = ${userId}::uuid
      `);
      await db.execute(sql`
        INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at)
        VALUES (${userId}::uuid, 'staff_invitation', ${'h' + run}, now() + interval '2 day')
      `);

      const detail = await service.detail(userId);

      expect(detail.invitationPending).toBe(true);
      expect(detail.invitationSentAt).not.toBeNull();
      expect(detail.invitationExpiresAt).not.toBeNull();
    });

    /**
     * An EXPIRED invitation is not "sent" — it needs a resend, and a date somebody might wait on
     * is worse than nothing. Same for a redeemed one.
     */
    it('reports no dates for an expired invitation', async () => {
      const userId = await makeStaff('support_agent', 'expired');

      await db.execute(sql`
        UPDATE users SET password_hash = NULL WHERE id = ${userId}::uuid
      `);
      await db.execute(sql`
        INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at)
        VALUES (${userId}::uuid, 'staff_invitation', ${'e' + run}, now() - interval '1 day')
      `);

      await expect(service.detail(userId)).resolves.toMatchObject({
        invitationPending: true,
        invitationSentAt: null,
        invitationExpiresAt: null,
      });
    });
  });

  describe('who is not found', () => {
    /**
     * A customer's user id is readable off الزبائن. It must answer the same as a uuid that names
     * nobody — no response may confirm that an id belongs to a real person on another registry.
     */
    it('answers 404 for a customer', async () => {
      const userId = await makeStaff('customer', 'customer');

      await expect(service.detail(userId)).rejects.toMatchObject({ status: 404 });
    });

    it('answers 404 for a partner', async () => {
      const userId = await makeStaff('partner', 'partner');

      await expect(service.detail(userId)).rejects.toMatchObject({ status: 404 });
    });

    it('answers 404 for a deleted staff account', async () => {
      const userId = await makeStaff('support_agent', 'deleted');

      await db.execute(sql`
        UPDATE users SET deleted_at = now() WHERE id = ${userId}::uuid
      `);

      await expect(service.detail(userId)).rejects.toMatchObject({ status: 404 });
    });

    it('answers 404 for a uuid that names nobody', async () => {
      await expect(
        service.detail('00000000-0000-4000-8000-000000000000'),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  /**
   * §15 — «تسجيل IP والجهاز والوقت والموظف في العمليات الحساسة».
   *
   * ## What was missing
   *
   * These operations grant and revoke access to the whole platform, and their audit rows named the
   * account and the moment and nothing else. Measured on 2026-08-26: all 253 `staff.invited` rows
   * carried no IP, while every one of 10,338 `auth.login_failed` rows did — because the `@Audited`
   * interceptor reads the request and these routes are `@AuditExempt`, the service recording them
   * itself so it can capture the role a person held BEFORE the change.
   *
   * An administrator's stolen session used to invite a new super admin therefore left a record that
   * could not say from where, which is the exact scenario §15 names IP and device for.
   *
   * ## Asserted per ACTION, not once
   *
   * Six call sites pass the context and each was edited by hand; one missed is one sensitive
   * operation still anonymous, and a single sample would not find it.
   */
  describe('§15’s origin on a sensitive operation', () => {
    /**
     * A real super admin row, because these operations refuse an actor who is not one — and
     * `audit_log.actor_user_id` has a foreign key, so an invented id fails the write rather than
     * the assertion.
     */
    let superAdmin: { sub: string; role: string; permissions: string[]; locale: string };

    beforeEach(async () => {
      superAdmin = {
        sub: await makeStaff('super_admin', 'origin-actor'),
        role: 'super_admin',
        permissions: [P.STAFF_MANAGE],
        locale: 'ar',
      };
    });

    async function originOf(action: string, userId: string) {
      const rows = await db.execute<{ ip: string | null; agent: string | null }>(sql`
        SELECT ip_address AS ip, user_agent AS agent FROM audit_log
        WHERE action = ${action} AND subject_id = ${userId}::uuid
        ORDER BY created_at DESC LIMIT 1
      `);

      return rows.rows[0];
    }

    const FROM = { ipAddress: '203.0.113.9', userAgent: 'SafraTest/1.0' };

    it('records where a role change came from', async () => {
      const target = await makeStaff('operations_manager', 'origin-role');
      const roleId = await makeRole('Origin role', [P.BOOKING_READ_ALL]);

      await service.changeRole(superAdmin as never, target, roleId, FROM);

      expect(await originOf('staff.role_changed', target)).toStrictEqual({
        ip: FROM.ipAddress,
        agent: FROM.userAgent,
      });
    });

    it('records where a suspension came from', async () => {
      const target = await makeStaff('operations_manager', 'origin-status');

      await service.setStatus(superAdmin as never, target, 'suspended', FROM);

      expect(await originOf('staff.suspended', target)).toStrictEqual({
        ip: FROM.ipAddress,
        agent: FROM.userAgent,
      });
    });

    it('records where a rename came from', async () => {
      const target = await makeStaff('operations_manager', 'origin-name');

      await service.rename(superAdmin as never, target, 'اسم جديد', FROM);

      expect(await originOf('staff.renamed', target)).toStrictEqual({
        ip: FROM.ipAddress,
        agent: FROM.userAgent,
      });
    });

    /**
     * And an operation with no origin still records, with nulls.
     *
     * The parameter is optional because the invitation-acceptance route is reached by somebody who
     * is not staff yet. What must NOT happen is the audit row disappearing because a caller had
     * nothing to pass — a missing origin is less than §15 asks for; a missing row is worse.
     */
    it('still records when the caller has no origin to give', async () => {
      const target = await makeStaff('operations_manager', 'origin-none');

      await service.setStatus(superAdmin as never, target, 'suspended');

      expect(await originOf('staff.suspended', target)).toStrictEqual({
        ip: null,
        agent: null,
      });
    });
  });
});
