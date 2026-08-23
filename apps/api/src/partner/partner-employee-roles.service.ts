import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import {
  employeePermissions,
  ERROR,
  PARTNER_EMPLOYEE_PERMISSIONS,
  type EmployeeRoleCreateInput,
} from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { badRequest, conflict, notFound } from '../common/errors/app-error.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * A `text[]` literal whose elements are still BOUND PARAMETERS.
 *
 * A JS array interpolated straight into a drizzle `sql` template expands to a TUPLE — `($1,$2,$3)`,
 * a `record` — and Postgres refuses it against a `text[]` column with
 * «column "permissions" is of type text[] but expression is of type record». Both writes here had
 * it, so `POST` and `PUT /admin/employee-roles` answered 500 on every call.
 *
 * `sql.join` keeps each element its own placeholder, so nothing is concatenated and the array is
 * still a parameter rather than text built into the statement.
 *
 * The trap is documented in this project's notes next to "backticks terminate sql`` templates",
 * and it was still missed — which is the argument for the integration tests beside this file
 * rather than for remembering harder.
 */
function textArray(values: readonly string[]) {
  return sql`ARRAY[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )}]::text[]`;
}

export type EmployeeRoleRow = {
  id: string;
  name: string;
  permissions: string[];
  employeeCount: number;
  createdAt: string;
};

/**
 * The roles a PARTNER names for their own employees (Bashar, 2026-08-23).
 *
 * ## Owned by the partner, not by SAFRA
 *
 * This was a single global catalogue defined by the super admin and merely assigned by partners.
 * That was a misreading of the requirement, corrected before it shipped: *"the partner also should
 * have an own page to define his employees roles"*. SAFRA's own staff roles are a separate system
 * — see `staff_roles` — and the two never mix.
 *
 * A partner names the jobs in their own business. «استقبال» means something different in a hotel
 * and a car-hire firm, and neither is SAFRA's to name.
 *
 * ## Every query carries the partner id, and that is the tenancy boundary
 *
 * Not only the reads. The name-collision pre-checks and all three writes filter on it too, because
 * a global uniqueness check across partners would leak: partner A types «مشرف فرع دمشق», is told
 * the name is taken, and has learned that a competitor has a Damascus branch. Role names are
 * business-chosen and descriptive, so the namespace is enumerable one guess at a time through an
 * ordinary form — and whoever created a name first would take it from everybody else permanently.
 * The unique index is `(partner_id, lower(name))` for the same reason.
 *
 * ## The permission set is bounded, and the bound is enforced twice
 *
 * `employeeRoleCreateSchema` refuses anything outside `PARTNER_EMPLOYEE_PERMISSIONS` at the
 * boundary, and `employeePermissions()` narrows again on every read. The second pass is not
 * belt-and-braces: it is what makes shrinking the allow-list REVOKE from roles already stored,
 * rather than merely stopping new ones. A super admin holds every permission on the platform, so
 * "name a role and tick some boxes" would otherwise be a route to giving somebody else's
 * receptionist `PAYOUT_EXECUTE`.
 *
 * ## Deletion is soft, and refused while anybody holds the role
 *
 * P-003 forbids hard deletes, and an employee pointing at a vanished role would resolve to no
 * permissions — an account that silently stops working for a reason nothing on screen explains.
 * So the role is withdrawn only once it is unused, and the refusal says how many hold it.
 */
@Injectable()
export class PartnerEmployeeRolesService {
  private readonly logger = new Logger(PartnerEmployeeRolesService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /** Every live role, with how many employees hold it. Not paginated: this list is small by design. */
  async list(partnerId: string): Promise<EmployeeRoleRow[]> {
    const rows = await this.db.execute<{
      id: string;
      name: string;
      permissions: string[];
      employee_count: string;
      created_at: string;
    }>(sql`
      SELECT r.id, r.name, r.permissions,
             to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS created_at,
             (
               SELECT count(*) FROM partner_employees e
               WHERE e.role_id = r.id AND e.deleted_at IS NULL
             )::text AS employee_count
      FROM partner_employee_roles r
      WHERE r.partner_id = ${partnerId}::uuid AND r.deleted_at IS NULL
      ORDER BY r.name
    `);

    return rows.rows.map((row) => ({
      id: row.id,
      name: row.name,
      /* Narrowed on the way out — see the class docblock. A stored row is not authoritative. */
      permissions: employeePermissions(row.permissions),
      employeeCount: Number(row.employee_count),
      createdAt: row.created_at,
    }));
  }

  /** What a role MAY carry, for the screen that builds the checkboxes. */
  assignablePermissions(): readonly string[] {
    return PARTNER_EMPLOYEE_PERMISSIONS;
  }

  async create(
    actor: AccessTokenClaims | undefined,
    partnerId: string,
    input: EmployeeRoleCreateInput,
  ): Promise<EmployeeRoleRow[]> {
    /*
      The name is unique among LIVE roles, case-insensitively, and the collision is answered with a
      code rather than a database error. Two roles called «استقبال» are a mistake somebody makes
      within a week, and the partner assigning them cannot tell which is which.
    */
    const clash = await this.db.execute<{ id: string }>(sql`
      SELECT id FROM partner_employee_roles
      WHERE partner_id = ${partnerId}::uuid
        AND lower(name) = lower(${input.name}) AND deleted_at IS NULL
      LIMIT 1
    `);

    if (clash.rows[0]) throw conflict(ERROR.EMPLOYEE_ROLE_NAME_TAKEN);

    const created = await this.db.transaction(async (tx) => {
      const rows = await tx.execute<{ id: string }>(sql`
        INSERT INTO partner_employee_roles
          (partner_id, name, permissions, created_by_user_id)
        VALUES (${partnerId}::uuid, ${input.name}, ${textArray(input.permissions)},
                ${actor?.sub}::uuid)
        RETURNING id
      `);

      const id = rows.rows[0]?.id;

      await this.audit.record(
        {
          actorUserId: actor?.sub,
          actorRole: actor?.role,
          action: 'partner_employee_role.created',
          subjectType: 'partner_employee_role',
          subjectId: id,
          after: { name: input.name, permissions: input.permissions },
        },
        tx as unknown as Database,
      );

      return id;
    });

    this.logger.log(`Employee role ${created} created: ${input.name}.`);

    return this.list(partnerId);
  }

  async update(
    actor: AccessTokenClaims | undefined,
    partnerId: string,
    id: string,
    input: EmployeeRoleCreateInput,
  ): Promise<EmployeeRoleRow[]> {
    const found = await this.db.execute<{ name: string; permissions: string[] }>(sql`
      SELECT name, permissions FROM partner_employee_roles
      WHERE id = ${id}::uuid AND partner_id = ${partnerId}::uuid AND deleted_at IS NULL
      LIMIT 1
    `);

    const before = found.rows[0];

    if (!before) throw notFound(ERROR.EMPLOYEE_ROLE_NOT_FOUND);

    const clash = await this.db.execute<{ id: string }>(sql`
      SELECT id FROM partner_employee_roles
      WHERE partner_id = ${partnerId}::uuid
        AND lower(name) = lower(${input.name}) AND id <> ${id}::uuid AND deleted_at IS NULL
      LIMIT 1
    `);

    if (clash.rows[0]) throw conflict(ERROR.EMPLOYEE_ROLE_NAME_TAKEN);

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE partner_employee_roles
        SET name = ${input.name}, permissions = ${textArray(input.permissions)},
            updated_at = now()
        WHERE id = ${id}::uuid AND partner_id = ${partnerId}::uuid
      `);

      await this.audit.record(
        {
          actorUserId: actor?.sub,
          actorRole: actor?.role,
          action: 'partner_employee_role.updated',
          subjectType: 'partner_employee_role',
          subjectId: id,
          /* Both sets, because "what changed" is the question asked of this row later. */
          before: { name: before.name, permissions: before.permissions },
          after: { name: input.name, permissions: input.permissions },
        },
        tx as unknown as Database,
      );
    });

    /*
      Sessions are NOT revoked here, and that is a decision rather than an omission.

      An employee's permissions are resolved when their token is minted, so a narrowed role keeps
      working until their access token expires. Revoking every holder's session on a rename would
      sign out a shift of receptionists because somebody fixed a typo. The access token is short and
      the refresh path re-reads the role, so the narrowing lands within minutes without that.

      There is NO immediate withdrawal here, and this docblock previously claimed there was — it
      offered "suspend the employment" as the emergency lever. Suspension takes effect on the next
      token build, which is the same window it was being offered as the remedy for, so the promise
      was false in exactly the situation somebody would rely on it.

      The suspend endpoint revokes the employee's sessions, which is what makes it immediate.
      `staff.service.ts` sets that precedent and states the reason: a demotion that takes fifteen
      minutes to apply is not a demotion. A role EDIT deliberately does not revoke, because it is
      routine; a suspension does, because it is not.
    */
    return this.list(partnerId);
  }

  /** Withdraws a role. Soft, and refused while anybody still holds it. */
  async remove(
    actor: AccessTokenClaims | undefined,
    partnerId: string,
    id: string,
  ): Promise<EmployeeRoleRow[]> {
    const found = await this.db.execute<{ name: string; holders: string }>(sql`
      SELECT r.name,
             (
               SELECT count(*) FROM partner_employees e
               WHERE e.role_id = r.id AND e.deleted_at IS NULL
             )::text AS holders
      FROM partner_employee_roles r
      WHERE r.id = ${id}::uuid AND r.partner_id = ${partnerId}::uuid AND r.deleted_at IS NULL
      LIMIT 1
    `);

    const role = found.rows[0];

    if (!role) throw notFound(ERROR.EMPLOYEE_ROLE_NOT_FOUND);

    /*
      Refused rather than cascaded. An employee whose role vanished resolves to NO permissions —
      an account that still signs in and can do nothing, for a reason no screen explains. Moving
      those people to another role is a decision, and it belongs to whoever is deleting.
    */
    if (Number(role.holders) > 0) {
      throw badRequest(ERROR.EMPLOYEE_ROLE_IN_USE);
    }

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE partner_employee_roles SET deleted_at = now(), updated_at = now()
        WHERE id = ${id}::uuid AND partner_id = ${partnerId}::uuid
      `);

      await this.audit.record(
        {
          actorUserId: actor?.sub,
          actorRole: actor?.role,
          action: 'partner_employee_role.deleted',
          subjectType: 'partner_employee_role',
          subjectId: id,
          before: { name: role.name },
        },
        tx as unknown as Database,
      );
    });

    return this.list(partnerId);
  }
}
