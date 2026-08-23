import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import {
  ERROR,
  STAFF_ASSIGNABLE_PERMISSIONS,
  staffRolePermissions,
  type StaffRoleCreateInput,
} from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { badRequest, conflict, notFound } from '../common/errors/app-error.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * `employeeCount`, not `memberCount` — the same field name the partner-side roles API uses.
 *
 * It was `memberCount` for about an hour, on the reasoning that SAFRA's people are staff rather
 * than employees. Two names for one idea across two APIs cost exactly what it always costs: the
 * console's component read `employeeCount` against a schema declaring `memberCount`, so every role
 * row called `undefined.toLocaleString()` and the delete control was offered for held roles because
 * `undefined > 0` is false. One crash, one silent wrong answer, from one word.
 *
 * Bashar calls both populations employees — "his own employees", "the partner employees" — so that
 * is the word, on both sides.
 */
export type StaffRoleRow = {
  id: string;
  name: string;
  permissions: string[];
  employeeCount: number;
  isSystem: boolean;
  createdAt: string;
};

/**
 * A `text[]` literal whose elements stay BOUND PARAMETERS.
 *
 * A JS array interpolated into a drizzle `sql` template expands to a tuple — `($1,$2,$3)`, a
 * `record` — and a `text[]` column refuses it. That shipped once today on the partner side and
 * answered 500 on every call; the integration tests beside this file exist so it cannot ship twice.
 */
function textArray(values: readonly string[]) {
  return sql`ARRAY[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )}]::text[]`;
}

/**
 * The roles a super admin names for SAFRA's own employees (Bashar, 2026-08-23).
 *
 * The console's counterpart to `PartnerEmployeeRolesService`: the same screen, the same shape, a
 * different population. A partner names the jobs in their business; the super admin names the jobs
 * in this one. Neither administers the other — *"The super admin has nothing to do with the partner
 * role definitions / employees."*
 *
 * ## Three invariants, and each one is a way to lock the platform out of itself
 *
 * 1. **A system role cannot be edited, renamed, reduced or retired.** `super_admin` is seeded with
 *    `is_system`. Without this a super admin edits their own role, drops `staff.manage`, and there
 *    is nobody left who can put it back — an irreversible lockout through a form that looks like an
 *    ordinary save.
 * 2. **No role may carry `STAFF_ROLE_MANAGE`.** Enforced in the schema by
 *    `isStaffAssignablePermission` and again on read by `staffRolePermissions`. A role that can
 *    define roles can grant itself everything.
 * 3. **The last active super admin cannot be moved off the role.** Held in `staff.service.ts`,
 *    where changing somebody's role lives. The first invariant does not cover it: the ROLE survives
 *    while its last holder is reassigned, and the platform becomes unadministerable with the row
 *    sitting there intact.
 *
 * The third was found by reading the code rather than by reasoning about it, which is why it is
 * written down here as well as enforced there.
 */
@Injectable()
export class StaffRolesService {
  private readonly logger = new Logger(StaffRolesService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /** Every live role, with how many staff hold it. Small by design — bounded by the org chart. */
  async list(): Promise<StaffRoleRow[]> {
    const rows = await this.db.execute<{
      id: string;
      name: string;
      permissions: string[];
      employee_count: string;
      is_system: boolean;
      created_at: string;
    }>(sql`
      SELECT r.id, r.name, r.permissions, r.is_system,
             to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS created_at,
             (
               SELECT count(*) FROM users u
               WHERE u.staff_role_id = r.id AND u.deleted_at IS NULL
             )::text AS employee_count
      FROM staff_roles r
      WHERE r.deleted_at IS NULL
      ORDER BY r.is_system DESC, r.name
    `);

    return rows.rows.map((row) => ({
      id: row.id,
      name: row.name,
      /* Narrowed on the way out — a stored row is not authoritative. */
      permissions: staffRolePermissions(row.permissions),
      employeeCount: Number(row.employee_count),
      isSystem: row.is_system,
      createdAt: row.created_at,
    }));
  }

  /** What a role MAY carry, so the screen's checkboxes cannot offer what the API refuses. */
  assignablePermissions(): readonly string[] {
    return STAFF_ASSIGNABLE_PERMISSIONS;
  }

  async create(
    actor: AccessTokenClaims | undefined,
    input: StaffRoleCreateInput,
  ): Promise<StaffRoleRow[]> {
    await this.refuseNameClash(input.name);

    await this.db.transaction(async (tx) => {
      const rows = await tx.execute<{ id: string }>(sql`
        INSERT INTO staff_roles (name, permissions, created_by_user_id)
        VALUES (${input.name}, ${textArray(input.permissions)}, ${actor?.sub}::uuid)
        RETURNING id
      `);

      await this.audit.record(
        {
          actorUserId: actor?.sub,
          actorRole: actor?.role,
          action: 'staff_role.created',
          subjectType: 'staff_role',
          subjectId: rows.rows[0]?.id,
          after: { name: input.name, permissions: input.permissions },
        },
        tx as unknown as Database,
      );
    });

    this.logger.log(`Staff role created: ${input.name}.`);

    return this.list();
  }

  async update(
    actor: AccessTokenClaims | undefined,
    id: string,
    input: StaffRoleCreateInput,
  ): Promise<StaffRoleRow[]> {
    const before = await this.liveRole(id);

    /*
      A system role is refused BEFORE the name check, so the answer to "may I edit this" does not
      depend on what name was submitted.
    */
    if (before.is_system) throw badRequest(ERROR.STAFF_ROLE_SYSTEM);

    await this.refuseNameClash(input.name, id);

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE staff_roles
        SET name = ${input.name}, permissions = ${textArray(input.permissions)},
            updated_at = now()
        WHERE id = ${id}::uuid
      `);

      await this.audit.record(
        {
          actorUserId: actor?.sub,
          actorRole: actor?.role,
          action: 'staff_role.updated',
          subjectType: 'staff_role',
          subjectId: id,
          before: { name: before.name, permissions: before.permissions },
          after: { name: input.name, permissions: input.permissions },
        },
        tx as unknown as Database,
      );
    });

    /*
      Sessions are not revoked, deliberately — the same decision as the partner side. A narrowed
      role lands on the next token build, and signing out a shift because somebody fixed a typo is
      worse than a few minutes of the old set. Taking authority away IMMEDIATELY is what suspending
      an account is for, and that does revoke.
    */
    return this.list();
  }

  /** Withdraws a role. Soft, refused while anybody holds it, and never for a system role. */
  async remove(
    actor: AccessTokenClaims | undefined,
    id: string,
  ): Promise<StaffRoleRow[]> {
    const role = await this.liveRole(id);

    if (role.is_system) throw badRequest(ERROR.STAFF_ROLE_SYSTEM);

    /*
      Refused rather than cascaded. A staff member whose role vanished resolves to no permissions —
      an account that still signs in to the console and can do nothing, for a reason no screen
      explains. Moving those people is a decision and it belongs to whoever is deleting.
    */
    if (Number(role.members) > 0) throw badRequest(ERROR.STAFF_ROLE_IN_USE);

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE staff_roles SET deleted_at = now(), updated_at = now()
        WHERE id = ${id}::uuid
      `);

      await this.audit.record(
        {
          actorUserId: actor?.sub,
          actorRole: actor?.role,
          action: 'staff_role.deleted',
          subjectType: 'staff_role',
          subjectId: id,
          before: { name: role.name },
        },
        tx as unknown as Database,
      );
    });

    return this.list();
  }

  private async liveRole(id: string) {
    const found = await this.db.execute<{
      name: string;
      permissions: string[];
      is_system: boolean;
      members: string;
    }>(sql`
      SELECT r.name, r.permissions, r.is_system,
             (
               SELECT count(*) FROM users u
               WHERE u.staff_role_id = r.id AND u.deleted_at IS NULL
             )::text AS members
      FROM staff_roles r
      WHERE r.id = ${id}::uuid AND r.deleted_at IS NULL
      LIMIT 1
    `);

    const role = found.rows[0];

    if (!role) throw notFound(ERROR.STAFF_ROLE_NOT_FOUND);

    return role;
  }

  /** One live role per name, case-insensitively — two «مشرف حجوزات» are a mistake, not a choice. */
  private async refuseNameClash(name: string, exceptId?: string): Promise<void> {
    const clash = await this.db.execute<{ id: string }>(sql`
      SELECT id FROM staff_roles
      WHERE lower(name) = lower(${name}) AND deleted_at IS NULL
        ${exceptId ? sql`AND id <> ${exceptId}::uuid` : sql``}
      LIMIT 1
    `);

    if (clash.rows[0]) throw conflict(ERROR.STAFF_ROLE_NAME_TAKEN);
  }
}
