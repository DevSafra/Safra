import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { AuthTokenService } from '../auth/auth-token.service.js';
import { PasswordService } from '../common/crypto/password.service.js';
import { StaffService } from './staff.service.js';
import type { MailService } from '../mail/mail.service.js';
import type { TokenService } from '../auth/token.service.js';

/**
 * Who الموظفون is allowed to consider a member of staff.
 *
 * ## The bug, found 2026-08-23 by clicking a row
 *
 * `StaffService` decided staff-ness with a DENY-list — `role <> 'customer' AND role <> 'partner'`
 * — which was right while those were the only two non-staff roles. `partner_employee` was added
 * the same day, and it is neither, so every partner's receptionist appeared in SAFRA's own staff
 * registry, was counted in its KPI cards, and could be opened, re-roled and suspended from it.
 *
 * ## How far it reached, stated exactly
 *
 * The READS only. `changeRole` and `setStatus` were never exposed — both go through `staffById`,
 * which asks `isStaffRole` and refuses. I assumed otherwise when I found this and the third test
 * below is what corrected me: it passed against the unfixed code. That is the reason it is still
 * here rather than deleted as redundant. It now records a fact about this service that is easy to
 * lose — the mutations do not trust the list's predicate — and it fails the day one of them starts
 * looking a member up its own way.
 *
 * The visible damage was a registry that disagreed with its own counters. Those have always used an
 * allow-list, so the KPI card counted SAFRA's staff while the table under it also listed partner
 * employees.
 *
 * ## Why this suite asserts BOTH directions
 *
 * "Withheld" and "absent" are indistinguishable from one side. A test that only proves the partner
 * employee is missing also passes on a `StaffService` that returns nothing at all, or that throws
 * for every id — so each case is paired with a real staff account that must still be there. The
 * second half is what proves the first half means anything.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('who الموظفون counts as staff', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  let db: Database;
  let service: StaffService;

  beforeEach(async () => {
    await harness.begin();
    db = harness.db;

    service = new StaffService(
      db,
      { ADMIN_URL: 'https://admin.safra.example' } as never,
      new AuditService(db),
      new AuthTokenService(db),
      { send: () => Promise.resolve() } as unknown as MailService,
      new PasswordService(),
      /*
        `staffPermissions` is stubbed, and only the CONTROL half of these tests reaches it.

        `detail` resolves a member's capabilities through it — that is the real `TokenService`
        method that mints the token the guard reads, which is exactly why it is not reimplemented
        here. What this suite is about is WHO may be opened at all, and a partner employee is
        refused before any of it runs.
      */
      {
        revokeAllForUser: () => Promise.resolve(),
        staffPermissions: () => ['booking.read_all'],
      } as unknown as TokenService,
    );
  });

  afterEach(async () => {
    await harness.rollback();
  });

  /** A user of any role, so each test states the role it is about in one word. */
  async function user(role: string): Promise<{ id: string; email: string }> {
    const email = `membership-${role}-${process.hrtime.bigint()}@safra.test`;

    const row = await db.execute<{ id: string }>(sql`
      INSERT INTO users (email, password_hash, role, status, preferred_locale,
                         email_verified_at)
      VALUES (${email}, 'x', ${role}::user_role, 'active', 'en', now())
      RETURNING id
    `);

    return { id: row.rows[0]?.id ?? '', email };
  }

  /**
   * The list. A partner's employee is not staff; a support agent is.
   *
   * Read at a page size large enough to hold a development database's accounts, because "not on
   * page one" is not the same claim as "not in the registry".
   */
  it('lists SAFRA staff and not a partner employee', async () => {
    const employee = await user('partner_employee');
    const agent = await user('support_agent');

    const page = await service.list({ page: 1, limit: 200 });
    const emails = page.items.map((item) => item.email);

    expect(
      emails,
      `A partner's employee appeared in SAFRA's staff registry. The predicate in ` +
        `staff.service.ts must be the STAFF_ROLES allow-list, not a list of roles to exclude — ` +
        `every role added to the enum is admitted by a deny-list, silently and permissively.`,
    ).not.toContain(employee.email);

    /* The control: withheld must be distinguishable from absent. */
    expect(emails).toContain(agent.email);
  });

  /** The record. Not found, and identical to a uuid that belongs to nobody. */
  it('refuses to open a partner employee as a staff record', async () => {
    const employee = await user('partner_employee');
    const agent = await user('support_agent');

    await expect(service.detail(employee.id)).rejects.toThrow();

    /* The control again: a real staff record still resolves, and carries their role. */
    const detail = await service.detail(agent.id);

    expect(detail.email).toBe(agent.email);
    expect(detail.role).toBe('support_agent');
  });

  /**
   * The mutations, which were ALREADY safe — and this test is how that was established.
   *
   * Run against the unfixed deny-list it passes, while the two above fail. That is what bounded the
   * finding to a read: `staffById` asks `isStaffRole` before either mutation touches a row.
   *
   * Kept rather than dropped as redundant. "They happen to share a private method" is a fact about
   * today's code, and if one of them ever looks a member up its own way the damage is another
   * company's employee holding a SAFRA console role — with `changeRole` writing both
   * `staff_role_id` and `role = admits_as`, and revoking their sessions on the way out.
   */
  it('refuses to re-role or suspend a partner employee', async () => {
    const employee = await user('partner_employee');
    const actor = await user('super_admin');

    const role = await db.execute<{ id: string }>(sql`
      SELECT id FROM staff_roles WHERE deleted_at IS NULL LIMIT 1
    `);
    const staffRoleId = role.rows[0]?.id;

    if (staffRoleId) {
      await expect(
        service.changeRole(
          { sub: actor.id, role: 'super_admin', permissions: [], locale: 'en' } as never,
          employee.id,
          staffRoleId,
        ),
      ).rejects.toThrow();
    }

    await expect(
      service.setStatus(
        { sub: actor.id, role: 'super_admin', permissions: [], locale: 'en' } as never,
        employee.id,
        'suspended',
      ),
    ).rejects.toThrow();

    /* And the row is untouched — a refusal that still wrote would be worse than no refusal. */
    const after = await db.execute<{ role: string; status: string }>(sql`
      SELECT role::text AS role, status::text AS status FROM users WHERE id = ${employee.id}
    `);

    expect(after.rows[0]?.role).toBe('partner_employee');
    expect(after.rows[0]?.status).toBe('active');
  });

  /**
   * A customer and a partner owner were never staff, and must stay that way.
   *
   * The deny-list named them explicitly; the allow-list names neither. That is the change most
   * likely to go wrong in the permissive direction without anybody noticing, so it is stated.
   */
  it('still refuses a customer and a partner owner', async () => {
    for (const role of ['customer', 'partner']) {
      const person = await user(role);

      await expect(service.detail(person.id), role).rejects.toThrow();
    }
  });
});
