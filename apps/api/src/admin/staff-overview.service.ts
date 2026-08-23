import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  STAFF_ROLES,
  type Permission,
} from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';

export interface StaffCounters {
  readonly total: number;
  readonly active: number;
  readonly suspended: number;
  readonly invited: number;
  readonly signedInToday: number;
  readonly rolesDefined: number;
  readonly twoFactorMissing: number;
}

export interface PermissionMatrix {
  /** Staff roles, in escalating order of privilege. */
  readonly roles: readonly string[];
  readonly rows: readonly {
    readonly permission: Permission;
    /** One entry per role, aligned with `roles`. */
    readonly granted: readonly boolean[];
  }[];
}

export interface StaffActivityRow {
  readonly actor: string | null;
  readonly action: string;
  readonly subjectType: string;
  readonly at: string;
}

/**
 * The الموظفون overview: counters, the permission matrix and recent staff activity
 * (design handoff §8.2).
 *
 * ## The matrix is the real thing, not a picture of one
 *
 * The handoff shows an 11 × 5 grid of ✓ / ○ / — and §14 requires that it be "enforced
 * server-side, not just rendered". So it is derived from `ROLE_PERMISSIONS` — the exact
 * constant `PermissionsGuard` checks on every request — rather than transcribed into the UI.
 * A permission added to a role appears here without anybody editing a table.
 *
 * ## The guarantee is CONSISTENCY, and it stopped being structural (2026-08-23)
 *
 * This paragraph used to end "the matrix cannot drift from what the server actually allows,
 * because there is only one source" — and while roles were four compile-time constants that was
 * true BY CONSTRUCTION: one constant, read twice, so a disagreement was not expressible.
 *
 * Staff roles are rows now (`staff_roles`, migration 0042). The matrix reads them and the guard
 * reads them, so the two still agree — but they agree because two readers happen to read one
 * table, not because there is nothing else to read. That is a weaker claim and this docblock is
 * not going to keep making the stronger one: a comment asserting a guarantee the code no longer
 * provides is worse than no comment, because the next person trusts it instead of checking.
 *
 * What would break it: any path that resolves a staff member's permissions from something other
 * than their role row — `ROLE_PERMISSIONS[users.role]`, for instance, which is still how the
 * SEEDED roles work. Where both exist, they must not be merged.
 *
 * The design's middle state ○ ("بموافقة مدير", requires manager approval) has **no
 * equivalent in the model**: a permission is granted or it is not. Rendering ○ would claim an
 * approval workflow exists. So the matrix is two-state, and the gap is documented rather than
 * mocked — see `docs/design-gap-report.md`.
 *
 * ## Only staff roles
 *
 * `customer` and `partner` are omitted. They are roles in the same enum but they are not staff,
 * and showing them in a console matrix invites somebody to grant a customer `payout.execute`.
 */
@Injectable()
export class StaffOverviewService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async counters(): Promise<StaffCounters> {
    const result = await this.db.execute<{
      total: string;
      active: string;
      suspended: string;
      invited: string;
      signed_in_today: string;
      two_factor_missing: string;
    }>(sql`
      SELECT count(*)::text AS total,
             count(*) FILTER (WHERE u.status = 'active' AND u.password_hash IS NOT NULL)::text
               AS active,
             count(*) FILTER (WHERE u.status = 'suspended')::text AS suspended,
             /*
               An invitation is an account with no password yet — AuthService.login rejects
               those — so "invited" is derived from the absence of a hash rather than from a
               separate status the two could disagree about.
             */
             count(*) FILTER (WHERE u.password_hash IS NULL)::text AS invited,
             count(*) FILTER (WHERE u.last_login_at >= current_date)::text AS signed_in_today,
             count(*) FILTER (WHERE u.totp_enabled_at IS NULL
                                AND u.password_hash IS NOT NULL)::text AS two_factor_missing
      FROM users u
      WHERE u.deleted_at IS NULL
        AND u.role IN ('support_agent','finance_officer','operations_manager','super_admin')
    `);

    const row = result.rows[0];

    return {
      total: Number(row?.total ?? 0),
      active: Number(row?.active ?? 0),
      suspended: Number(row?.suspended ?? 0),
      invited: Number(row?.invited ?? 0),
      signedInToday: Number(row?.signed_in_today ?? 0),
      rolesDefined: STAFF_ROLES.length,
      twoFactorMissing: Number(row?.two_factor_missing ?? 0),
    };
  }

  /**
   * The permission matrix, straight from the guard's own constant.
   *
   * Ordered by how many roles hold each permission, descending: the broadly-granted rows
   * (reading a booking) sit at the top and the narrow ones (executing a payout, activating
   * emergency mode) at the bottom, so the shape of the grid itself shows where privilege
   * concentrates. Alphabetical order would scatter that.
   */
  matrix(): PermissionMatrix {
    const roles = STAFF_ROLES;
    const permissions = Object.values(PERMISSIONS);

    const rows = permissions
      .map((permission) => ({
        permission,
        granted: roles.map((role) =>
          (ROLE_PERMISSIONS[role] as readonly Permission[]).includes(permission),
        ),
      }))
      /*
        Every permission is listed, and nothing is filtered out.

        An earlier version dropped rows "no staff role holds", on the assumption that the
        customer/partner permissions (`booking.read_own`, `property.manage_own`) would fall away.
        They do not: `SUPER_ADMIN` is `Object.values(PERMISSIONS)`, so super_admin holds the entire
        catalogue and the filter could never fire. It was dead code asserting a false belief about
        the role map — a unit test found it. Showing the full catalogue is also the more useful
        answer, because the rows that matter most are the ones only super_admin holds.
      */
      .sort((a, b) => {
        const spread =
          b.granted.filter(Boolean).length - a.granted.filter(Boolean).length;

        return spread !== 0 ? spread : a.permission.localeCompare(b.permission);
      });

    return { roles, rows };
  }

  /**
   * Recent staff actions, from the audit log.
   *
   * The audit log, not a separate feed: there is exactly one record of what staff did, it is
   * append-only by trigger, and a second store would be a second version of the truth. Filtered
   * to staff actors so a customer's own password reset does not appear as staff activity.
   */
  async activity(limit = 8): Promise<StaffActivityRow[]> {
    const result = await this.db.execute<{
      actor: string | null;
      action: string;
      subject_type: string;
      at: string;
    }>(sql`
      SELECT u.email AS actor, a.action, a.subject_type,
             to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at
      FROM audit_log a
      JOIN users u ON u.id = a.actor_user_id
      WHERE a.actor_role IN
        ('support_agent','finance_officer','operations_manager','super_admin')
      ORDER BY a.created_at DESC
      LIMIT ${limit}
    `);

    return result.rows.map((row) => ({
      actor: row.actor,
      action: row.action,
      subjectType: row.subject_type,
      at: row.at,
    }));
  }
}
