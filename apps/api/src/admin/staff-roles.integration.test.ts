import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';
import {
  ERROR,
  PERMISSIONS as P,
  STAFF_ASSIGNABLE_PERMISSIONS,
  staffRoleCreateSchema,
} from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { StaffRolesService, type StaffRoleRow } from './staff-roles.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * The roles a super admin names for SAFRA's own employees, against a real database.
 *
 * The console's counterpart to `partner-employee-roles.integration.test.ts`. What is different is
 * the stakes: a partner mis-naming a role inconveniences their receptionist, and a super admin
 * editing the wrong row can make the platform unadministerable. So most of this file is about the
 * three ways that could happen.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('the staff role catalogue', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  let service: StaffRolesService;
  let staffUserId = '';

  const staff = (): AccessTokenClaims =>
    ({ sub: staffUserId, role: 'super_admin' }) as unknown as AccessTokenClaims;

  const named = (name: string) => `${name}-${crypto.randomUUID().slice(0, 8)}`;

  const createRole = async (
    name: string,
    permissions: string[],
  ): Promise<StaffRoleRow> => {
    const roles = await service.create(
      staff(),
      staffRoleCreateSchema.parse({ name, permissions }),
    );
    const created = roles.find((role) => role.name === name);

    if (!created) throw new Error(`role ${name} was not created`);

    return created;
  };

  beforeEach(async () => {
    await harness.begin();

    service = new StaffRolesService(db, new AuditService(db));

    const made = await db.execute<{ id: string }>(sql`
      INSERT INTO users (email, phone, role, status)
      VALUES ('sr-' || gen_random_uuid() || '@safra.test', '+963900000800', 'super_admin', 'active')
      RETURNING id
    `);

    staffUserId = made.rows[0]?.id ?? '';
  });

  afterEach(async () => {
    await harness.rollback();
  });

  /** THE test: the INSERT executes. The partner-side equivalent 500'd on every call for an hour. */
  it('creates a role and lists it back', async () => {
    const role = await createRole(named('مشرف حجوزات'), [
      P.BOOKING_READ_ALL,
      P.BOOKING_UPDATE_STATUS,
    ]);

    expect(role.permissions).toEqual([P.BOOKING_READ_ALL, P.BOOKING_UPDATE_STATUS]);
    expect(role.employeeCount).toBe(0);
    expect(role.isSystem).toBe(false);
  });

  it('stores the permissions as a real text[] column', async () => {
    const name = named('محاسب');

    await createRole(name, [P.PAYMENT_READ]);

    const row = await db.execute<{ n: string }>(sql`
      SELECT array_length(permissions, 1)::text AS n FROM staff_roles WHERE name = ${name}
    `);

    expect(row.rows[0]?.n).toBe('1');
  });

  it('refuses a second live role with the same name, whatever the case', async () => {
    const name = named('تدقيق');

    await createRole(name, [P.PAYMENT_READ]);

    await expect(
      service.create(staff(), {
        name: name.toUpperCase(),
        permissions: [P.PAYMENT_READ],
      }),
    ).rejects.toMatchObject({ response: { code: ERROR.STAFF_ROLE_NAME_TAKEN } });
  });

  // ── The three ways to lock the platform out of itself ────────────────────────

  describe('the system role', () => {
    const systemRole = async () => {
      const roles = await service.list();
      const system = roles.find((role) => role.isSystem);

      if (!system) throw new Error('no system role is seeded');

      return system;
    };

    /** Seeded by `post/0008`, and its flag is the only thing standing between us and a lockout. */
    it('exists and is marked', async () => {
      expect((await systemRole()).isSystem).toBe(true);
    });

    /**
     * THE assertion. Without this a super admin edits their own role, drops `staff.manage`, and
     * nobody is left who can put it back — irreversible, through a form that looks like a save.
     */
    it('cannot be edited', async () => {
      const system = await systemRole();

      await expect(
        service.update(staff(), system.id, {
          name: named('مخترق'),
          permissions: [P.BOOKING_READ_ALL],
        }),
      ).rejects.toMatchObject({ response: { code: ERROR.STAFF_ROLE_SYSTEM } });
    });

    it('cannot be withdrawn', async () => {
      const system = await systemRole();

      await expect(service.remove(staff(), system.id)).rejects.toMatchObject({
        response: { code: ERROR.STAFF_ROLE_SYSTEM },
      });
    });

    /* Refused BEFORE the name check, so "may I edit this" cannot depend on what name was sent. */
    it('is refused as a system role even when the new name is already taken', async () => {
      const taken = named('مأخوذ');

      await createRole(taken, [P.PAYMENT_READ]);

      const system = await systemRole();

      await expect(
        service.update(staff(), system.id, {
          name: taken,
          permissions: [P.PAYMENT_READ],
        }),
      ).rejects.toMatchObject({ response: { code: ERROR.STAFF_ROLE_SYSTEM } });
    });
  });

  describe('what a role may carry', () => {
    /**
     * THE boundary. A role that can define roles can grant itself everything, and «مشرف حجوزات»
     * becomes a super admin one save later.
     */
    it('never lets a role manage roles', () => {
      expect(
        staffRoleCreateSchema.safeParse({
          name: 'تصعيد',
          permissions: [P.BOOKING_READ_ALL, P.STAFF_ROLE_MANAGE],
        }).success,
      ).toBe(false);
    });

    /* Dangerous and ESCALATING are different, and only the second must be impossible. */
    it('does allow emergency mode, which is dangerous but cannot acquire anything else', () => {
      expect(
        staffRoleCreateSchema.safeParse({
          name: 'مناوبة ليلية',
          permissions: [P.EMERGENCY_MODE_ACTIVATE],
        }).success,
      ).toBe(true);
    });

    it('offers everything except the forbidden one', () => {
      expect(STAFF_ASSIGNABLE_PERMISSIONS).not.toContain(P.STAFF_ROLE_MANAGE);
      expect(STAFF_ASSIGNABLE_PERMISSIONS).toContain(P.BOOKING_READ_ALL);
    });

    /**
     * Narrowed on READ, so a row written past every write guard still cannot grant it.
     *
     * The write path is a good error message; the read is the layer a future caller with its own
     * validation cannot bypass.
     */
    it('drops a forbidden permission smuggled into a stored row', async () => {
      const role = await createRole(named('مهرَّب'), [P.BOOKING_READ_ALL]);

      await db.execute(sql`
        UPDATE staff_roles
        SET permissions = ARRAY['booking.read_all', 'staff_role.manage']
        WHERE id = ${role.id}::uuid
      `);

      const listed = (await service.list()).find((row) => row.id === role.id);

      expect(listed?.permissions).toEqual([P.BOOKING_READ_ALL]);
    });
  });

  describe('withdrawing', () => {
    it('removes a role nobody holds', async () => {
      const role = await createRole(named('غير-مستخدم'), [P.PAYMENT_READ]);

      const roles = await service.remove(staff(), role.id);

      expect(roles.find((row) => row.id === role.id)).toBeUndefined();
    });

    it('refuses while a staff member still holds it, and counts them', async () => {
      const role = await createRole(named('مشغول'), [P.PAYMENT_READ]);

      await db.execute(sql`
        UPDATE users SET staff_role_id = ${role.id}::uuid WHERE id = ${staffUserId}::uuid
      `);

      await expect(service.remove(staff(), role.id)).rejects.toMatchObject({
        response: { code: ERROR.STAFF_ROLE_IN_USE },
      });

      const listed = (await service.list()).find((row) => row.id === role.id);

      expect(listed?.employeeCount).toBe(1);
    });
  });
});
