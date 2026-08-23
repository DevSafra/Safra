import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';
import {
  ERROR,
  PARTNER_EMPLOYEE_PERMISSIONS,
  PERMISSIONS as P,
  type EmployeeRoleCreateInput,
} from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import {
  PartnerEmployeeRolesService,
  type EmployeeRoleRow,
} from './partner-employee-roles.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * The super admin's role catalogue, exercised against a real database.
 *
 * ## Why this file exists
 *
 * `create` and `update` interpolated a JS array straight into a `sql` template. Drizzle expands
 * that to a TUPLE, Postgres reads it as `record`, and a `text[]` column refuses it — so both writes
 * answered 500 on **every** call. `pnpm verify` was green throughout, because nothing here ran
 * against Postgres; it took a browser click to find.
 *
 * That is the second employees endpoint in one afternoon reported as working while it 500'd on
 * first real use, and both times the gap was identical: no test drove the actual SQL. The lesson is
 * not "remember the array trap" — it is already written down in this project's notes, and was
 * missed anyway. It is that a service which writes raw SQL needs a test that executes it.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('the employee role catalogue', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  let service: PartnerEmployeeRolesService;
  let partnerId = '';
  let otherPartnerId = '';
  let staffUserId = '';

  const staff = (): AccessTokenClaims =>
    ({ sub: staffUserId, role: 'partner' }) as unknown as AccessTokenClaims;

  const named = (name: string) => `${name}-${crypto.randomUUID().slice(0, 8)}`;

  beforeEach(async () => {
    await harness.begin();

    service = new PartnerEmployeeRolesService(db, new AuditService(db));

    const made = await db.execute<{
      staff: string;
      partner: string;
      other: string;
    }>(sql`
      WITH su AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('roles-' || gen_random_uuid() || '@safra.test', '+963900000700',
                'partner', 'active')
        RETURNING id
      ), ou2 AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('roles-b-' || gen_random_uuid() || '@safra.test', '+963900000702',
                'partner', 'active')
        RETURNING id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email)
        SELECT su.id, (SELECT id FROM partner_types LIMIT 1), 'Roles Co', 'أدوار',
               (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1), 'x',
               '+963900000700', 'roles@safra.test'
        FROM su
        RETURNING id
      ), pb AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email)
        SELECT ou2.id, (SELECT id FROM partner_types LIMIT 1), 'Other Co', 'آخر',
               (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1), 'x',
               '+963900000702', 'roles-b@safra.test'
        FROM ou2
        RETURNING id
      )
      SELECT (SELECT id FROM su) AS staff, (SELECT id FROM pa) AS partner,
             (SELECT id FROM pb) AS other
    `);

    staffUserId = made.rows[0]?.staff ?? '';
    partnerId = made.rows[0]?.partner ?? '';
    otherPartnerId = made.rows[0]?.other ?? '';
  });

  afterEach(async () => {
    await harness.rollback();
  });

  /**
   * Creates a role and returns THAT role, found by name.
   *
   * `create` answers with the whole catalogue ordered by name, so `const [role] = await create(…)`
   * takes whichever role sorts first — not the one just made. That passed only while the table was
   * empty; the moment real roles existed in the dev database the tests began acting on somebody
   * else's row, and «removes a role nobody holds» started deleting a role that had five employees.
   *
   * A fixture that silently operates on the wrong row is the same class as an assertion that
   * cannot fail: it is green for a reason unrelated to the thing under test.
   */
  const createRole = async (
    name: string,
    permissions: EmployeeRoleCreateInput['permissions'],
  ): Promise<EmployeeRoleRow> => {
    const roles = await service.create(staff(), partnerId, { name, permissions });
    const created = roles.find((role) => role.name === name);

    if (!created) throw new Error(`role ${name} was not created`);

    return created;
  };

  /** THE test. It asserts the thing that was broken: that the INSERT executes at all. */
  it('creates a role and lists it back', async () => {
    const name = named('استقبال');
    const roles = await service.create(staff(), partnerId, {
      name,
      permissions: [P.BOOKING_READ_OWN, P.BOOKING_CHECK_IN],
    });

    const created = roles.find((role) => role.name === name);

    expect(created).toBeDefined();
    expect(created?.permissions).toEqual([P.BOOKING_READ_OWN, P.BOOKING_CHECK_IN]);
    expect(created?.employeeCount).toBe(0);
  });

  /** The array reaches Postgres as an ARRAY, not a record — this is the 500 that shipped. */
  it('stores the permissions as a real text[] column', async () => {
    const name = named('محاسبة');

    await service.create(staff(), partnerId, { name, permissions: [P.MESSAGE_READ] });

    const row = await db.execute<{ n: string }>(sql`
      SELECT array_length(permissions, 1)::text AS n
      FROM partner_employee_roles WHERE name = ${name}
    `);

    expect(row.rows[0]?.n).toBe('1');
  });

  it('creates a role carrying every assignable capability', async () => {
    const name = named('كل-الصلاحيات');

    const roles = await service.create(staff(), partnerId, {
      name,
      permissions: [...PARTNER_EMPLOYEE_PERMISSIONS],
    });

    expect(roles.find((role) => role.name === name)?.permissions).toHaveLength(
      PARTNER_EMPLOYEE_PERMISSIONS.length,
    );
  });

  it('refuses a second live role with the same name, whatever the case', async () => {
    const name = named('تدبير');

    await service.create(staff(), partnerId, {
      name,
      permissions: [P.CALENDAR_MANAGE_OWN],
    });

    await expect(
      service.create(staff(), partnerId, {
        name: name.toUpperCase(),
        permissions: [P.CALENDAR_MANAGE_OWN],
      }),
    ).rejects.toMatchObject({ response: { code: ERROR.EMPLOYEE_ROLE_NAME_TAKEN } });
  });

  describe('updating', () => {
    it('rewrites the name and the whole permission set', async () => {
      const name = named('قبل');
      const before = await createRole(name, [P.BOOKING_READ_OWN]);

      const after = named('بعد');
      const roles = await service.update(staff(), partnerId, before.id, {
        name: after,
        permissions: [P.MESSAGE_READ, P.MESSAGE_SEND],
      });

      const updated = roles.find((role) => role.id === before.id);

      expect(updated?.name).toBe(after);
      expect(updated?.permissions).toEqual([P.MESSAGE_READ, P.MESSAGE_SEND]);
    });

    it('refuses a name another live role already holds', async () => {
      const taken = named('مأخوذ');

      await service.create(staff(), partnerId, {
        name: taken,
        permissions: [P.BOOKING_READ_OWN],
      });
      const other = await createRole(named('آخر'), [P.BOOKING_READ_OWN]);

      await expect(
        service.update(staff(), partnerId, other.id, {
          name: taken,
          permissions: [P.BOOKING_READ_OWN],
        }),
      ).rejects.toMatchObject({ response: { code: ERROR.EMPLOYEE_ROLE_NAME_TAKEN } });
    });

    it('answers a role that is not there', async () => {
      await expect(
        service.update(staff(), partnerId, '00000000-0000-0000-0000-0000000000dd', {
          name: named('لا-شيء'),
          permissions: [P.BOOKING_READ_OWN],
        }),
      ).rejects.toMatchObject({ response: { code: ERROR.EMPLOYEE_ROLE_NOT_FOUND } });
    });
  });

  describe('withdrawing', () => {
    it('removes a role nobody holds', async () => {
      const role = await createRole(named('غير-مستخدم'), [P.BOOKING_READ_OWN]);

      const roles = await service.remove(staff(), partnerId, role.id);

      expect(roles.find((row) => row.id === role.id)).toBeUndefined();
    });

    /**
     * Refused rather than cascaded. An employee pointing at a withdrawn role resolves to NO
     * permissions — an account that signs in and can do nothing, for a reason no screen explains.
     */
    it('refuses while an employee still holds it, and counts them', async () => {
      const role = await createRole(named('مشغول'), [P.BOOKING_READ_OWN]);

      /* The holder works for THIS partner — a cross-tenant employment is not a state that exists. */
      await db.execute(sql`
        WITH ou AS (
          INSERT INTO users (email, phone, role, status)
          VALUES ('roles-emp-' || gen_random_uuid() || '@safra.test', '+963900000701',
                  'partner_employee', 'active')
          RETURNING id
        )
        INSERT INTO partner_employees (partner_id, user_id, role_id, full_name)
        SELECT ${partnerId}::uuid, ou.id, ${role.id}::uuid, 'حامل الدور' FROM ou
      `);

      await expect(service.remove(staff(), partnerId, role.id)).rejects.toMatchObject({
        response: { code: ERROR.EMPLOYEE_ROLE_IN_USE },
      });

      /* And the count is what lets the screen refuse BEFORE offering the button. */
      const roles = await service.list(partnerId);

      expect(roles.find((row) => row.id === role.id)?.employeeCount).toBe(1);
    });
  });

  /**
   * TENANCY — the boundary this rework creates, and the one that did not exist before.
   *
   * Roles were global until 2026-08-23, so "whose role is this" was not a question. Now it is, and
   * every one of these is a way to get it wrong: a caller-supplied `roleId`, a name-collision
   * pre-check, and three writes that each take an id.
   *
   * The leak is subtler than an escalation. A partner cannot gain permissions this way — the
   * allow-list still bounds what any role can carry. What they can learn is that another business
   * exists and what it calls its jobs: «مشرف فرع دمشق» tells you a competitor has a Damascus
   * branch, and a namespace that answers «taken» is enumerable one guess at a time.
   */
  describe('one partner cannot reach another partner’s roles', () => {
    it('does not list them', async () => {
      const name = named('سري');

      await service.create(staff(), otherPartnerId, {
        name,
        permissions: [P.BOOKING_READ_OWN],
      });

      const mine = await service.list(partnerId);

      expect(mine.some((role) => role.name === name)).toBe(false);
    });

    /** The same name is FREE for everybody — a first-come global namespace is a denial of service. */
    it('lets two partners use the same name', async () => {
      const name = named('استقبال');

      await service.create(staff(), otherPartnerId, {
        name,
        permissions: [P.BOOKING_READ_OWN],
      });

      await expect(
        service.create(staff(), partnerId, { name, permissions: [P.BOOKING_READ_OWN] }),
      ).resolves.toBeDefined();
    });

    it('cannot edit one', async () => {
      const theirs = await service.create(staff(), otherPartnerId, {
        name: named('لهم'),
        permissions: [P.BOOKING_READ_OWN],
      });

      const target = theirs[0];

      await expect(
        service.update(staff(), partnerId, target?.id ?? '', {
          name: named('مسروق'),
          permissions: [P.BOOKING_READ_OWN],
        }),
      ).rejects.toMatchObject({ response: { code: ERROR.EMPLOYEE_ROLE_NOT_FOUND } });
    });

    it('cannot withdraw one', async () => {
      const theirs = await service.create(staff(), otherPartnerId, {
        name: named('لهم-أيضاً'),
        permissions: [P.BOOKING_READ_OWN],
      });

      const target = theirs[0];

      await expect(
        service.remove(staff(), partnerId, target?.id ?? ''),
      ).rejects.toMatchObject({ response: { code: ERROR.EMPLOYEE_ROLE_NOT_FOUND } });
    });
  });

  /** The screen's checkboxes come from here, so they cannot offer what the API would reject. */
  it('serves exactly the assignable capabilities', () => {
    expect(service.assignablePermissions()).toEqual(PARTNER_EMPLOYEE_PERMISSIONS);
  });

  /** A stored role is narrowed on read, so shrinking the allow-list revokes rather than lingers. */
  it('drops a stored capability the allow-list no longer contains', async () => {
    const name = named('قديم');
    const role = await createRole(name, [P.BOOKING_READ_OWN]);

    await db.execute(sql`
      UPDATE partner_employee_roles
      SET permissions = ARRAY['booking.read_own', 'payout.execute']
      WHERE id = ${role.id}::uuid
    `);

    const roles = await service.list(partnerId);

    expect(roles.find((row) => row.id === role.id)?.permissions).toEqual([
      P.BOOKING_READ_OWN,
    ]);
  });
});
