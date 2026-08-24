import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';
import type * as schema from '@safra/db/schema';
import { PARTNER_EMPLOYEE_PERMISSIONS, PERMISSIONS as P } from '@safra/contracts';

import { TokenService } from './token.service.js';
import { PartnerEmployeesService } from '../partner/partner-employees.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import type { AuthTokenService } from './auth-token.service.js';
import type { MailService } from '../mail/mail.service.js';
import type { Env } from '../config/env.js';
import type { SettingsService } from '../settings/settings.service.js';
import type { AccessTokenClaims } from './token.service.js';

/**
 * An employee may never out-rank their employer (Bashar, 2026-08-23).
 *
 * ## What this covers that `partner-employee.test.ts` cannot
 *
 * That test proves the STATIC half: `PARTNER_EMPLOYEE_PERMISSIONS` is a subset of what a partner
 * holds, so no role can be defined carrying more than the employer has. This is the other half —
 * whether the RESOLVER hands an employee authority in a situation where the employer has none.
 *
 * A list cannot answer that, because the interesting cases are all ABSENCES rather than grants: a
 * deleted employer, a suspended employment, a deleted role, an override written directly onto the
 * account. Deny-by-default has to survive a missing row, and a resolver that reads authority from
 * a JOIN can lose a condition without losing a result — which is exactly how the contract stack's
 * `readFile` guard was bypassed earlier today.
 *
 * ## The employer's own branch is the yardstick
 *
 * Every assertion below about a deleted partner checks the OWNER first. The rule is not "an
 * employee gets nothing in this case"; it is "an employee gets no more than the owner", and the
 * only way to state that honestly is to resolve both and compare.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('a partner employee never out-ranks their employer', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  const service = new TokenService(
    {
      JWT_ACCESS_SECRET: 'a'.repeat(64),
      JWT_REFRESH_SECRET: 'b'.repeat(64),
      ACCESS_TOKEN_TTL: '15m',
      REFRESH_TOKEN_TTL: '30d',
    } as unknown as Env,
    db,
    /* `enabledGrants` is the only setting this path reads; no runtime grant is enabled here. */
    { get: () => Promise.resolve(false) } as unknown as SettingsService,
  );

  let partnerId = '';
  let ownerId = '';
  let employeeId = '';
  let employmentId = '';
  let roleId = '';

  /*
    Ending an employment is `PartnerEmployeesService.remove`, so the test that cares what removal
    LEAVES BEHIND has to go through it. An `UPDATE partner_employees SET deleted_at` of its own
    would assert the same outcome through a door the application never uses — and it could only
    pass if the resolver inferred a permission set from a MISSING row, which is the shape that
    produced today's `readFile` bypass. Only `mail` and `authTokens` are stubbed; the rest is real.
  */
  const employees = new PartnerEmployeesService(
    db,
    new AuditService(db),
    {} as unknown as AuthTokenService,
    service,
    {} as unknown as MailService,
    { PARTNER_URL: 'https://partner.example' } as unknown as Env,
  );

  /*
    `partner_employee_roles.permissions` is `text[]`, so the fixtures pass a Postgres ARRAY LITERAL
    rather than a JavaScript array. Drizzle expands a JS array into a parenthesised tuple — fine for
    an `IN (…)`, wrong for a column — and the failure is a syntax error at run time, which no
    typecheck sees. Permission values are dot-and-underscore only, so a bare `{a,b}` literal needs
    no quoting.
  */
  const pgArray = (values: readonly string[]): string => `{${values.join(',')}}`;

  /* `buildClaims` takes the row, so the test reads it back rather than reconstructing it. */
  const userRow = async (id: string): Promise<typeof schema.users.$inferSelect> => {
    const rows = await db.execute(sql`SELECT * FROM users WHERE id = ${id}::uuid`);

    return rows.rows[0] as unknown as typeof schema.users.$inferSelect;
  };

  beforeEach(async () => {
    await harness.begin();

    const made = await db.execute<{
      partner_id: string;
      owner: string;
      employee: string;
      role_id: string;
      employment_id: string;
    }>(sql`
      WITH ou AS (
        INSERT INTO users (email, phone, role, status, preferred_locale)
        VALUES ('pe-owner-' || gen_random_uuid() || '@safra.test', '+963900000500',
                'partner', 'active', 'ar')
        RETURNING id
      ), eu AS (
        INSERT INTO users (email, phone, role, status, preferred_locale)
        VALUES ('pe-staff-' || gen_random_uuid() || '@safra.test', '+963900000501',
                'partner_employee', 'active', 'ar')
        RETURNING id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT ou.id, (SELECT id FROM partner_types LIMIT 1), 'Emp Test', 'موظفون',
               (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1), 'x',
               '+963900000500', 'pe-p@safra.test', 'approved'
        FROM ou
        RETURNING id
      ), ro AS (
        INSERT INTO partner_employee_roles (partner_id, name, permissions)
        SELECT pa.id, 'استقبال-' || gen_random_uuid(),
               ${pgArray(PARTNER_EMPLOYEE_PERMISSIONS)}::text[]
        FROM pa
        RETURNING id
      ), em AS (
        INSERT INTO partner_employees (partner_id, user_id, role_id, status, full_name)
        SELECT pa.id, eu.id, ro.id, 'active', 'Receptionist' FROM pa, eu, ro
        RETURNING id
      )
      SELECT pa.id AS partner_id, (SELECT id FROM ou) AS owner,
             (SELECT id FROM eu) AS employee, (SELECT id FROM ro) AS role_id,
             (SELECT id FROM em) AS employment_id
      FROM pa
    `);

    partnerId = made.rows[0]?.partner_id ?? '';
    ownerId = made.rows[0]?.owner ?? '';
    employeeId = made.rows[0]?.employee ?? '';
    roleId = made.rows[0]?.role_id ?? '';
    employmentId = made.rows[0]?.employment_id ?? '';
  });

  afterEach(async () => {
    await harness.rollback();
  });

  it('gives an ordinary employee their role, bounded by the list', async () => {
    const claims = await service.buildClaims(await userRow(employeeId));

    expect(claims.partnerId).toBe(partnerId);
    expect(claims.permissions).toEqual([...PARTNER_EMPLOYEE_PERMISSIONS]);
  });

  /*
    The override path the REPLACEMENT exists to close.

    `permission_overrides` is a staff mechanism, and `resolvePermissions` has already applied it by
    the time the employee branch runs. Assigning rather than merging is what stops a row on an
    employee account from handing a receptionist a payout button.
  */
  it('ignores a permission override written onto an employee account', async () => {
    await db.execute(sql`
      UPDATE users SET permission_overrides = ${JSON.stringify([P.PAYOUT_EXECUTE])}::jsonb
      WHERE id = ${employeeId}::uuid
    `);

    const claims = await service.buildClaims(await userRow(employeeId));

    expect(claims.permissions).not.toContain(P.PAYOUT_EXECUTE);
    expect(claims.permissions).toEqual([...PARTNER_EMPLOYEE_PERMISSIONS]);
  });

  /*
    A role row is data, and data outlives the rule that let it in. Shrinking the list has to
    REVOKE, not merely stop granting — otherwise every role written before the change keeps its
    old authority and there is no row to migrate because nobody knows which ones to look at.
  */
  it('drops a permission a role carries that the list no longer allows', async () => {
    await db.execute(sql`
      UPDATE partner_employee_roles
      SET permissions = ${pgArray([P.BOOKING_READ_OWN, P.PAYOUT_EXECUTE])}::text[]
      WHERE id = ${roleId}::uuid
    `);

    const claims = await service.buildClaims(await userRow(employeeId));

    expect(claims.permissions).toEqual([P.BOOKING_READ_OWN]);
  });

  /* Two switches with two owners: the platform suspends the ACCOUNT, the partner the EMPLOYMENT. */
  it('gives a suspended employment no partner and no permissions', async () => {
    await db.execute(sql`
      UPDATE partner_employees SET status = 'suspended' WHERE user_id = ${employeeId}::uuid
    `);

    const claims = await service.buildClaims(await userRow(employeeId));

    expect(claims.partnerId).toBeUndefined();
    expect(claims.permissions).toEqual([]);
  });

  it('gives an employee whose employment was removed nothing', async () => {
    await db.execute(sql`
      UPDATE partner_employees SET deleted_at = now() WHERE user_id = ${employeeId}::uuid
    `);

    const claims = await service.buildClaims(await userRow(employeeId));

    expect(claims.partnerId).toBeUndefined();
    expect(claims.permissions).toEqual([]);
  });

  /* A deleted role must not leave the employment standing with the old permission set. */
  it('gives an employee of a soft-deleted role nothing', async () => {
    await db.execute(sql`
      UPDATE partner_employee_roles SET deleted_at = now() WHERE id = ${roleId}::uuid
    `);

    const claims = await service.buildClaims(await userRow(employeeId));

    expect(claims.partnerId).toBeUndefined();
    expect(claims.permissions).toEqual([]);
  });

  /**
   * THE test. A soft-deleted employer must take their employees with them.
   *
   * The owner's own branch filters `isNull(partners.deletedAt)`, so removing the partner strips
   * `partnerId` from the OWNER's claims and every partner-scoped query answers empty for them. The
   * employee branch joins `partner_employees` to `partner_employee_roles` and never reaches
   * `partners` at all — so unless the condition is stated there too, the employee keeps a partner
   * id and a full role against a business the owner can no longer reach.
   *
   * That is the inversion this boundary exists to prevent, and it is not a small one: the role
   * carries `BOOKING_READ_OWN`, `MESSAGE_SEND` and `BOOKING_CHECK_IN`, so the survivor can read the
   * business's guest list, write to guests as the business, and admit people to its rooms.
   * `RequireVerifiedPartner` does re-read the database and would refuse a price or a photograph,
   * but none of those three routes is behind it.
   */
  it('gives an employee of a soft-deleted partner no more than it gives the owner', async () => {
    await db.execute(sql`
      UPDATE partners SET deleted_at = now() WHERE id = ${partnerId}::uuid
    `);

    const owner = await service.buildClaims(await userRow(ownerId));

    expect(owner.partnerId).toBeUndefined();

    const employee = await service.buildClaims(await userRow(employeeId));

    expect(employee.partnerId).toBeUndefined();
    expect(employee.permissions).toEqual([]);
  });

  /**
   * An employee of a SUSPENDED partner still resolves their employer — and that is the policy.
   *
   * This asserted the opposite until 2026-08-24, and the opposite was what the code did: the
   * employee branch filtered `partners.suspended_at`, so a receptionist at a suspended business got
   * no partner and no permissions. Their portal rendered empty, with nothing anywhere saying why —
   * not even the suspension notice, which needs the partner scope to be read at all.
   *
   * Bashar's policy overruled it: *"The partner may still sign in and view their account. The
   * partner may view the suspension reason and relevant notices."* Suspension is an enforcement
   * action against a BUSINESS, and the people who work there still need to see what has happened
   * to it.
   *
   * **This test is inverted rather than deleted**, because the important half is the same in both
   * versions: whatever suspension does, it must do the SAME thing to the owner and to their staff.
   * That property is what this file is for, and it is asserted below.
   *
   * What an employee may DO while suspended is refused per action by `SuspendedPartnerGuard`, which
   * reads the column at request time — see its docblock for why the token was the wrong place.
   */
  it('still resolves the employer for an employee of a SUSPENDED partner', async () => {
    await db.execute(sql`
      UPDATE partners SET suspended_at = now(), suspended_reason = 'test'
      WHERE id = ${partnerId}::uuid
    `);

    const claims = await service.buildClaims(await userRow(employeeId));

    expect(claims.partnerId).toBe(partnerId);
    expect(claims.permissions.length).toBeGreaterThan(0);
  });

  /**
   * Suspension must treat the OWNER and their staff identically.
   *
   * Originally: the employee branch filtered `partners.suspended_at` and the partner branch did
   * not, so suspending a business silenced every receptionist while leaving the person with the
   * MOST access trading exactly as before — a lever that stopped the staff and not the owner.
   *
   * The policy has since moved the enforcement out of the token entirely (Bashar, 2026-08-24), so
   * both branches now resolve. The asymmetry is what this test exists to catch, and it catches it
   * in either direction.
   *
   * This is not an escalation of employee over employer — the ordering still holds — so it is not
   * the boundary this file is named for. It is the same column being load-bearing in one branch and
   * absent in the other, which is how the two drift.
   */
  it('treats the owner and their staff identically under suspension', async () => {
    await db.execute(sql`
      UPDATE partners SET suspended_at = now(), suspended_reason = 'test'
      WHERE id = ${partnerId}::uuid
    `);

    const owner = await service.buildClaims(await userRow(ownerId));
    const employee = await service.buildClaims(await userRow(employeeId));

    /*
      Both resolve, and that is the point of asserting them together rather than apart. The original
      defect this test was written for was the same column being load-bearing in one branch and
      absent in the other — which is how a lever ends up stopping the staff and not the owner, the
      wrong half. Whichever way the policy goes, the two branches must agree.
    */
    expect(owner.partnerId).toBe(partnerId);
    expect(employee.partnerId).toBe(partnerId);
  });

  // ── What becoming an employee COSTS the account it lands on ─────────────────

  /**
   * A customer who accepts an employee invitation must not lose their own account.
   *
   * `invite` deliberately ADOPTS an existing customer account rather than refusing the address, and
   * `acceptInvitation` then sets `role = 'partner_employee'` on it. That is the whole conversion —
   * and `attachOwningIds` resolves `customerProfileId` only `if (user.role === 'customer')`.
   *
   * So the moment a customer activates, their own bookings, wallet and gift cards become
   * unreachable: not deleted, but with nothing left to resolve them through. The profile row still
   * exists and no claim points at it.
   *
   * This is reachable by ANY partner against ANY address — invite is bounded to a `customer` role,
   * which is precisely the account this destroys. The realistic case needs no attacker at all: a
   * hotel invites its receptionist, who happens to book with SAFRA, and her trips disappear.
   *
   * The UPDATE below is copied from `acceptInvitation` rather than called through it, so the test
   * states the same transition the service performs without wiring five collaborators to reach it.
   */
  it('does not strand a customer profile when the account becomes an employee', async () => {
    const profile = await db.execute<{ id: string }>(sql`
      INSERT INTO customer_profiles (user_id, full_name, email, phone, is_guest)
      SELECT u.id, 'Receptionist', u.email, '+963900000502', false
      FROM users u WHERE u.id = ${employeeId}::uuid
      RETURNING id
    `);

    await db.execute(sql`
      UPDATE users SET role = 'customer'::user_role WHERE id = ${employeeId}::uuid
    `);

    const before = await service.buildClaims(await userRow(employeeId));

    expect(before.customerProfileId).toBe(profile.rows[0]?.id);

    /* Exactly what `acceptInvitation` writes. */
    await db.execute(sql`
      UPDATE users SET role = 'partner_employee'::user_role WHERE id = ${employeeId}::uuid
    `);

    const after = await service.buildClaims(await userRow(employeeId));

    expect(after.partnerId).toBe(partnerId);
    expect(after.customerProfileId).toBe(profile.rows[0]?.id);
  });

  /**
   * Removing an employment must leave a USABLE account, not merely a resolvable profile.
   *
   * Two halves, and only together do they protect the receptionist who books with SAFRA herself.
   * `customerProfileId` resolving regardless of role gives her trips somewhere to be found again;
   * `remove` putting `users.role` back to `customer` is what gives her permission to read them.
   * Without the second, `ROLE_PERMISSIONS.partner_employee` is empty and there is no role row left
   * to intersect, so the account signs in and can do nothing — a profile nobody may read is not
   * access.
   *
   * ## Why this drives the SERVICE and not an UPDATE
   *
   * An earlier version of this test ended the employment with raw SQL and asserted the same
   * outcome. That is the same assertion through a door the application never opens, and it could
   * only ever pass if `buildClaims` INFERRED the customer permission set from the absence of a live
   * employment. Deriving authority from a missing row is precisely the shape that produced the
   * `readFile` scope bypass earlier the same day, and it would have contradicted the five tests
   * above — a suspended employer, a withdrawn role and a suspended employment must all yield
   * nothing, and a fallback keyed on absence cannot tell those apart from a finished job.
   *
   * So the truth is written where the decision is made, and this drives the decision.
   */
  it('leaves a removed employee able to USE their own customer account again', async () => {
    const profile = await db.execute<{ id: string }>(sql`
      INSERT INTO customer_profiles (user_id, full_name, email, phone, is_guest)
      SELECT u.id, 'Receptionist', u.email, '+963900000502', false
      FROM users u WHERE u.id = ${employeeId}::uuid
      RETURNING id
    `);

    /* Activated, as `acceptInvitation` leaves them — the state a real removal acts on. */
    await db.execute(sql`
      UPDATE users SET role = 'partner_employee'::user_role WHERE id = ${employeeId}::uuid
    `);

    await employees.remove(
      { sub: ownerId, role: 'partner' } as unknown as AccessTokenClaims,
      partnerId,
      employmentId,
    );

    const claims = await service.buildClaims(await userRow(employeeId));

    expect(claims.partnerId).toBeUndefined();
    expect(claims.customerProfileId).toBe(profile.rows[0]?.id);
    /* The profile is reachable; this is whether they may actually read their own bookings. */
    expect(claims.permissions).toContain(P.BOOKING_READ_OWN);
  });
});
