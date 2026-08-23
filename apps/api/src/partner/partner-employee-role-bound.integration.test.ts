import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';
import { PARTNER_EMPLOYEE_PERMISSIONS, PERMISSIONS as P } from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { PartnerEmployeeRolesService } from './partner-employee-roles.service.js';
import { TokenService } from '../auth/token.service.js';
import type * as schema from '@safra/db/schema';
import type { Env } from '../config/env.js';
import type { SettingsService } from '../settings/settings.service.js';

/**
 * The permission bound, now that a PARTNER writes the rows rather than a super admin.
 *
 * ## What changed and why it needed re-attacking
 *
 * Until 2026-08-23 a role was created by a super admin — somebody who holds every permission on the
 * platform — and `PARTNER_EMPLOYEE_PERMISSIONS` existed to stop them handing a receptionist
 * `PAYOUT_EXECUTE` through a friendly form. The caller is now the partner, who is not staff at all,
 * and the same allow-list has to hold against them.
 *
 * ## Three places, and only one of them is load-bearing
 *
 * - the FORM builds its checkboxes from `assignablePermissions()`
 * - the WRITE validates against `employeeRoleCreateSchema` at the controller's pipe
 * - the READ intersects with `employeePermissions()` every time a role or a token is resolved
 *
 * The first two can be bypassed by a caller that does not go through them — a new controller with
 * its own validation, a data fix, a row written before the list shrank. **The read cannot**, because
 * every path to a permission goes through it. So the tests that matter here write an over-broad row
 * DIRECTLY to the database, past every write guard, and then assert that nothing anywhere grants it.
 *
 * A test that only submitted a bad payload through the schema would prove the schema works, which
 * was never the thing in doubt.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** A permission no employee may ever hold. Chosen because it moves money. */
const FORBIDDEN = P.PAYOUT_EXECUTE;

describeIfDb('what a partner-defined role can and cannot grant', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  let roles: PartnerEmployeeRolesService;
  let tokens: TokenService;

  let partnerId = '';
  let employeeUserId = '';
  let roleId = '';

  const pgArray = (values: readonly string[]): string => `{${values.join(',')}}`;

  const userRow = async (id: string): Promise<typeof schema.users.$inferSelect> => {
    const rows = await db.execute(sql`SELECT * FROM users WHERE id = ${id}::uuid`);

    return rows.rows[0] as unknown as typeof schema.users.$inferSelect;
  };

  beforeEach(async () => {
    await harness.begin();

    roles = new PartnerEmployeeRolesService(db, new AuditService(db));
    tokens = new TokenService(
      {
        JWT_ACCESS_SECRET: 'a'.repeat(64),
        JWT_REFRESH_SECRET: 'b'.repeat(64),
        ACCESS_TOKEN_TTL: '15m',
        REFRESH_TOKEN_TTL: '30d',
      } as unknown as Env,
      db,
      { get: () => Promise.resolve(false) } as unknown as SettingsService,
    );

    const made = await db.execute<{
      partner: string;
      employee: string;
      role: string;
    }>(sql`
      WITH ou AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('bound-owner-' || gen_random_uuid() || '@safra.test', '+963900000900',
                'partner', 'active')
        RETURNING id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT ou.id, (SELECT id FROM partner_types LIMIT 1), 'Bound Co', 'حدود',
               (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1), 'x',
               '+963900000900', 'bound@safra.test', 'approved'
        FROM ou
        RETURNING id
      ), eu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('bound-emp-' || gen_random_uuid() || '@safra.test', '+963900000901',
                'partner_employee', 'active')
        RETURNING id
      ), r AS (
        INSERT INTO partner_employee_roles (partner_id, name, permissions)
        SELECT pa.id, 'حدود-' || gen_random_uuid(), ARRAY['booking.read_own']
        FROM pa
        RETURNING id
      ), em AS (
        INSERT INTO partner_employees (partner_id, user_id, role_id, status, full_name)
        SELECT pa.id, eu.id, r.id, 'active', 'موظّف الحدود' FROM pa, eu, r
        RETURNING id
      )
      SELECT (SELECT id FROM pa) AS partner, (SELECT id FROM eu) AS employee,
             (SELECT id FROM r) AS role
      FROM pa
    `);

    partnerId = made.rows[0]?.partner ?? '';
    employeeUserId = made.rows[0]?.employee ?? '';
    roleId = made.rows[0]?.role ?? '';
  });

  afterEach(async () => {
    await harness.rollback();
  });

  /** The list a partner's checkboxes are built from IS the bound, not a copy of it. */
  it('offers exactly the allow-list and nothing else', () => {
    expect([...roles.assignablePermissions()]).toStrictEqual([
      ...PARTNER_EMPLOYEE_PERMISSIONS,
    ]);
  });

  it('does not offer anything that moves money', () => {
    expect(roles.assignablePermissions()).not.toContain(FORBIDDEN);
  });

  // ── Past every write guard ──────────────────────────────────────────────────

  /*
    Written straight to the table, so no schema and no controller sees it. This is the row a data
    fix leaves behind, or one written before the allow-list shrank, or one a future controller with
    its own validation lets through. Every assertion below is about what happens NEXT.
  */
  const smuggle = async (): Promise<void> => {
    await db.execute(sql`
      UPDATE partner_employee_roles
      SET permissions = ${pgArray([P.BOOKING_READ_OWN, FORBIDDEN])}::text[]
      WHERE id = ${roleId}::uuid
    `);
  };

  it('never puts a smuggled capability in an employee’s token', async () => {
    await smuggle();

    const claims = await tokens.buildClaims(await userRow(employeeUserId));

    expect(claims.permissions).not.toContain(FORBIDDEN);
    expect(claims.permissions).toStrictEqual([P.BOOKING_READ_OWN]);
  });

  it('never shows a smuggled capability on the roles screen', async () => {
    await smuggle();

    const listed = await roles.list(partnerId);

    expect(listed[0]?.permissions).not.toContain(FORBIDDEN);
  });

  /**
   * The screen must not disagree with the token, in EITHER direction.
   *
   * A row displaying a capability the token does not carry is not an escalation — but it tells an
   * owner they granted something they did not, which is the same class of lie as a flow reporting
   * success into an account that cannot sign in. Asserted as equality rather than as two separate
   * "does not contain" checks, because the failure worth catching is drift, not one bad value.
   */
  it('shows exactly what the token carries', async () => {
    await smuggle();

    const listed = await roles.list(partnerId);
    const claims = await tokens.buildClaims(await userRow(employeeUserId));

    expect(listed[0]?.permissions).toStrictEqual(claims.permissions);
  });

  /*
    The control. Without it every assertion above would pass over a role that grants NOTHING —
    "withheld" and "absent" are indistinguishable, which is the failure this suite has produced
    three times in one day.
  */
  it('still grants the capabilities the partner legitimately chose', async () => {
    await smuggle();

    const claims = await tokens.buildClaims(await userRow(employeeUserId));

    expect(claims.permissions).toContain(P.BOOKING_READ_OWN);
  });
});
