import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { STAFF_ROLES } from '@safra/contracts';

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

export interface StaffActivityRow {
  readonly actor: string | null;
  readonly action: string;
  readonly subjectType: string;
  readonly at: string;
}

/**
 * The الموظفون overview: counters and recent staff activity.
 *
 * ## What this used to be, and why the rest went
 *
 * It also built مصفوفة الصلاحيات — a role-by-capability grid, derived from `ROLE_PERMISSIONS` and
 * from `staff_roles` rather than transcribed, precisely so it could not drift from what the guard
 * enforces. That was the right way to build it and it is gone anyway: Bashar asked for it off the
 * screen by name on 2026-08-23, because أدوار الموظفين answers "what does this role carry" from the
 * rows themselves. Two renderings of one fact is one more than can stay in step, and the correct
 * one to keep is the one you can edit.
 *
 * `staff-overview.matrix.test.ts` went with it. Its guarantee — that the rendered matrix matches
 * the enforced permissions — has nothing left to be true about once nothing renders a matrix, and a
 * test that cannot fail is worse than no test because it reads like cover.
 *
 * ## Who may read this
 *
 * `STAFF_MANAGE`. Recent activity names which colleague did what, and the counters say how many
 * accounts exist and how many are unprotected by 2FA. Both are reconnaissance for somebody deciding
 * which account to go after.
 *
 * ## Every "who is staff" question resolves from `STAFF_ROLES`
 *
 * There were three answers in this feature and they had drifted: `staffById` asked the allow-list,
 * the registry used a DENY-list, and the counters typed the four role names out. The deny-list is
 * the one that broke when `partner_employee` joined the enum — every partner's employee appeared in
 * SAFRA's own staff registry, under a counter that did not count them. Four literals that happen to
 * match the allow-list today are a copy of it, not agreement with it.
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
        /*
          The same allow-list the registry beneath these cards uses, from one source.

          This clause was right, and it was the THIRD hand-written answer to "who is staff" in the
          console's staff code — staffById asks isStaffRole, the registry had a deny-list, and these
          four values were typed out here. The deny-list is the one that drifted when
          partner_employee joined the enum, and the symptom was this card disagreeing with the table
          under it. Four literals that happen to match STAFF_ROLES today are a copy, not agreement.

          No backticks in this comment: it sits inside a sql template literal and a backtick ends
          it. That is how this edit failed the first time.
        */
        AND u.role::text IN (${sql.join(
          STAFF_ROLES.map((role) => sql`${role}`),
          sql`, `,
        )})
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
      /*
        STAFF_ROLES, not four literals — the same fix the counters above needed, in the last place
        in this file that still asked the question its own way. Four values that happen to match the
        allow-list today are a copy of it, not agreement with it, and the copy is what drifted when
        partner_employee joined the enum.

        No backticks in this comment: it sits inside a sql template literal and a backtick ends it.
      */
      WHERE a.actor_role::text IN (${sql.join(
        STAFF_ROLES.map((role) => sql`${role}`),
        sql`, `,
      )})
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
