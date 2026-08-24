import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';

import type { Database } from '@safra/db';
import {
  COUNT_CAP,
  ERROR,
  isStaffRole,
  STAFF_ROLES,
  type Role,
  type OffsetPage,
  offsetPage,
} from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { AuthTokenService } from '../auth/auth-token.service.js';
import { DATABASE } from '../database/database.module.js';
import { ENV, type Env } from '../config/env.js';
import { MailService } from '../mail/mail.service.js';
import {
  staffInvitationMail,
  staffReinstatedMail,
  staffSuspendedMail,
} from '../mail/mail.templates.js';
import { PasswordService } from '../common/crypto/password.service.js';
import { TokenService } from '../auth/token.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { badRequest, forbidden, notFound } from '../common/errors/app-error.js';

/**
 * An invitation is valid for 48 hours.
 *
 * Longer than a password reset (minutes) because an invitation is expected rather
 * than urgent — it may arrive outside working hours, or while the recipient is
 * travelling. Short enough that a forgotten invitation to a privileged console does
 * not sit redeemable for weeks.
 */
const INVITATION_TTL_MS = 48 * 60 * 60 * 1000;

/**
 * One staff account, for the detail screen «رجوع» comes back from.
 *
 * Everything the list carries, plus the three things that only make sense for ONE person: the
 * capabilities they actually hold, the cities they are scoped to, and the state of an outstanding
 * invitation. Those lived on the LIST as a permissions matrix and a paged scope table — a screen
 * that answered "who can do what" by making the reader scan twenty rows to learn about one.
 *
 * `lastLoginAt`, not `lastSignInAt`. The list already calls it that and the console reads both on
 * the same screen; two names for one idea across two endpoints is the `memberCount` versus
 * `employeeCount` mistake, which cost a crash and a wrong button in one afternoon.
 */
export interface StaffDetail extends StaffMember {
  readonly staffRoleId: string | null;
  readonly staffRoleName: string | null;
  /** Exactly what the guard will compare against — see `TokenService.staffPermissions`. */
  readonly permissions: readonly string[];
  /**
   * The cities this account may work in — SLUG and name, never the id.
   *
   * The name because somebody deciding whether a colleague can work in a city cannot read a uuid,
   * and resolving names console-side would be a fetch of the whole geography per page view for data
   * this query has already joined.
   *
   * The SLUG because it is what `setStaffScopeSchema` accepts — "a slug is stable, readable in an
   * audit entry, and not enumerable". A read that hands back an identifier the matching write will
   * not take makes the pair unusable as a round trip, which is what a detail screen with an editor
   * on it needs. The id is on neither side and is therefore not here.
   */
  readonly scopeCities: readonly { readonly slug: string; readonly name: string }[];
  /**
   * `all_cities` or `cities` — and this is NOT derivable from the list above.
   *
   * An empty `scopeCities` was enough while the screen only displayed a scope: no cities means no
   * restriction to show. It is not enough to EDIT one, because `cities` with an empty list is a
   * real and deliberate state — `setStaffScopeSchema` accepts it as how an administrator starts
   * building a scope — and a picker cannot arrive with the right choice selected if the two
   * collapse to the same value.
   *
   * Maps to `kind` on the write. Named `scopeKind` here because `kind` alone is ambiguous in a
   * payload about a person; the write's whole object IS a scope, so there it is not.
   */
  readonly scopeKind: 'all_cities' | 'cities';
  /**
   * What this account may do OUTSIDE its scope. Maps to `outside` on the write.
   *
   * Present because the write is a whole-object `PUT`: an editor that submitted without it would
   * silently reset the value to whatever it defaulted to. Only meaningful while `scopeKind` is
   * `cities`, and the schema's `.refine` refuses the contradictory combination rather than
   * quietly ignoring half of it.
   */
  readonly outsideScopeAccess: 'none' | 'read_only';
  /** Null unless an invitation is outstanding — redeemed and expired ones are not "sent". */
  readonly invitationSentAt: string | null;
  readonly invitationExpiresAt: string | null;
}

export interface StaffMember {
  readonly id: string;
  /**
   * The person's name, or NULL for an account created before names existed (Bashar, 2026-08-23).
   *
   * Null rather than a derived stand-in: `staff12@safra.test` yields `staff12`, and a fabricated
   * name rendered as fact on a colleague's record is worse than an honest address. 165 accounts
   * predate the column and there is nothing true to backfill them with, so every surface falls
   * back to the email until somebody types the real one. New accounts cannot be nameless —
   * `staffInviteSchema` requires it.
   */
  readonly fullName: string | null;
  readonly email: string;
  readonly role: Role;
  readonly status: string;
  readonly twoFactorEnabled: boolean;
  readonly invitationPending: boolean;
  readonly lastLoginAt: string | null;
  readonly createdAt: string;
}

/**
 * Creating and managing staff accounts (M-5, SRS §4).
 *
 * Until now the only way to create a staff account was an INSERT against the
 * database. Bootstrapping production therefore meant a human with a psql session on
 * the production instance — the exact access pattern the audit log exists to make
 * unnecessary, and one that leaves no record of who granted whom access.
 *
 * ## An invitation, not a password
 *
 * The inviter never sets or sees a password. The account is created with
 * `password_hash IS NULL`, which `AuthService.login` already rejects, and a
 * single-use `staff_invitation` token is emailed. So a password for a privileged
 * account is known only to its owner, and an administrator cannot quietly use a
 * colleague's account.
 *
 * The invitation purpose is distinct from `password_reset` deliberately: an
 * invitation is the only token that turns a passwordless account into a usable one,
 * and the two must not be interchangeable.
 *
 * ## What this service refuses to do
 *
 * Three refusals, each closing a way an administrator could lock the platform out of
 * itself or quietly widen their own access. They are enforced here rather than in the
 * console because the console is not the security boundary.
 */
/**
 * Who counts as staff, as an ALLOW-LIST.
 *
 * ## The bug this replaced, 2026-08-23
 *
 * It was written as a DENY-list — "not a customer and not a partner" — and that was correct while
 * those were the only two non-staff roles in the enum. `partner_employee` was added the same day,
 * so every partner receptionist and housekeeper immediately appeared in SAFRA's own staff registry,
 * was counted in its KPI cards, and could be opened, re-roled and suspended from الموظفون.
 *
 * ## What it did and did NOT reach
 *
 * The two READ queries only — the registry and the record. `changeRole` and `setStatus` were never
 * exposed: both go through `staffById`, which asks `isStaffRole`, the allow-list, and refuses. That
 * is worth stating precisely rather than leaving as "a permissions bug", because the difference
 * between reading a row and re-roling somebody else's employee is the whole severity.
 *
 * It also put the registry out of step with its own counters, which have always used an allow-list
 * (`staff-overview.service.ts`): the KPI card counted SAFRA's staff while the table beneath it
 * listed partner employees too. A count that disagrees with the list it describes is the failure
 * "Tables and pagination" exists to prevent.
 *
 * ## Why an allow-list rather than one more exclusion
 *
 * Adding `AND u.role <> 'partner_employee'` fixes today and fails again the next time the enum
 * grows — silently, and in the permissive direction, which is the direction rule 1 forbids
 * ("deny by default").
 *
 * The deeper point is that this file ALREADY had the right answer. `staffById` asks `isStaffRole`
 * three hundred lines below; these two queries asked a hand-written predicate. Two answers to "who
 * is staff" in one service, and the copy is the one that drifted — which is exactly what the note
 * on `STAFF_ROLES` in `permissions.ts` warns about. All three readers now resolve from it.
 *
 * Interpolated per value through `sql.join` rather than as a bare array: an array binds as a single
 * parameter and a tuple is what `IN` wants, so the explicit join is the form that cannot be read
 * two ways.
 */
const IS_STAFF = sql`u.role::text IN (${sql.join(
  STAFF_ROLES.map((role) => sql`${role}`),
  sql`, `,
)})`;

@Injectable()
export class StaffService {
  private readonly logger = new Logger(StaffService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly audit: AuditService,
    private readonly authTokens: AuthTokenService,
    private readonly mail: MailService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  /** The row count for a page, capped, over the same `FROM … WHERE` the list uses. */
  private async countOf(fromWhere: SQL): Promise<number> {
    /*
      Counted over a LIMIT-ed subquery, so the database stops reading at COUNT_CAP + 1 rows
      instead of scanning the whole matching set. An uncapped count(*) is unbounded work on
      every page view of an ever-growing table — which rule 2 forbids — and nobody reading a
      console table needs to know the exact size of a set they will never page through.
    */
    const result = await this.db.execute<{ n: string }>(
      sql`SELECT count(*)::text AS n FROM (SELECT 1 ${fromWhere} LIMIT ${COUNT_CAP + 1}) capped`,
    );

    return Number(result.rows[0]?.n ?? 0);
  }

  /** `OFFSET` for a 1-based page. */
  private pageOffset(query: { page: number; limit: number }): SQL {
    return sql`OFFSET ${(query.page - 1) * query.limit}`;
  }

  /**
   * A page of staff accounts, for the console (§9.3). Never includes customers.
   *
   * ## Paginated as of 2026-08-05
   *
   * This returned EVERY row. Rule 2 has required pagination on every list endpoint since the
   * project started, and this endpoint was the exception nobody noticed because a staff list
   * sounds small — it is 165 rows on the development database and grows with the company, and
   * an unbounded list endpoint is a DoS vector regardless of how slowly it grows.
   *
   * Offset-paged, matching every other console registry: the reader picks a page number, so the
   * count and the page have to describe the same set — see `countOf`.
   */
  async list(query: { limit: number; page: number }): Promise<OffsetPage<StaffMember>> {
    // One fragment, used by both queries below — see `countOf`.
    const fromWhere = sql`
      FROM users u
      /*
        The role's NAME travels with the row, not just its id.

        Every screen that shows a person shows their role — the header renders on all twenty
        console sections — and a dynamic name cannot come from a compile-time catalogue. Resolving
        it per screen would mean fetching the role list on every page; joining it here costs one
        indexed lookup on a query that already runs.

        LEFT, because staff_role_id is null for every account seeded before named roles existed.
        Those still resolve through ROLE_PERMISSIONS and the console falls back to the enum label.

        No backticks in here — this comment is inside a sql template literal and a backtick ends it.
      */
      LEFT JOIN staff_roles r ON r.id = u.staff_role_id AND r.deleted_at IS NULL
      WHERE ${IS_STAFF} AND u.deleted_at IS NULL`;

    const [rows, total] = await Promise.all([
      this.db.execute<{
        id: string;
        full_name: string | null;
        email: string;
        role: Role;
        staff_role_id: string | null;
        staff_role_name: string | null;
        status: string;
        totp_enabled_at: string | null;
        password_hash: string | null;
        last_login_at: string | null;
        created_at: string;
      }>(sql`
      SELECT u.id, u.full_name, u.email, u.role::text AS role, u.status::text AS status,
             u.staff_role_id, r.name AS staff_role_name,
             u.totp_enabled_at::text, u.password_hash,
             u.last_login_at::text, u.created_at::text
      ${fromWhere}
      ORDER BY u.created_at DESC, u.id DESC
      LIMIT ${query.limit} ${this.pageOffset(query)}
      `),
      this.countOf(fromWhere),
    ]);

    const items = rows.rows.map((row) => ({
      id: row.id,
      fullName: row.full_name,
      email: row.email,
      role: row.role,
      staffRoleId: row.staff_role_id,
      staffRoleName: row.staff_role_name,
      status: row.status,
      twoFactorEnabled: row.totp_enabled_at !== null,
      /**
       * No password means the invitation has not been accepted. Surfaced because an
       * invitation that was never opened looks identical to an active account in a
       * plain list, and "why can't they log in" is the resulting support ticket.
       */
      invitationPending: row.password_hash === null,
      lastLoginAt: row.last_login_at,
      createdAt: row.created_at,
    }));

    return offsetPage(items, total, query);
  }

  /**
   * Invites a new staff member.
   *
   * The account exists immediately but cannot be used: no password, and
   * `TwoFactorGuard` will hold it at enrolment even once one is set.
   */
  /**
   * Invites somebody into a NAMED ROLE, in one step.
   *
   * It took an enum value until 2026-08-23, which meant inviting into a custom role was invite-then-
   * change — and between those two actions the account carried whatever `ROLE_PERMISSIONS` said
   * about the enum, because `staff_role_id` was still null. A narrow role's holder with the full
   * support-agent set, for as long as nobody took the second step.
   */
  async invite(
    actor: AccessTokenClaims | undefined,
    input: {
      fullName: string;
      email: string;
      staffRoleId: string;
      locale?: string | undefined;
    },
  ): Promise<{ id: string; email: string; role: Role }> {
    const email = input.email.trim().toLowerCase();

    const found = await this.db.execute<{ admits_as: Role }>(sql`
      SELECT admits_as FROM staff_roles
      WHERE id = ${input.staffRoleId}::uuid AND deleted_at IS NULL LIMIT 1
    `);

    const namedRole = found.rows[0];

    if (!namedRole) throw badRequest(ERROR.STAFF_ROLE_NOT_FOUND);

    /*
      The enum the role admits its holders as — written alongside `staff_role_id` so the two can
      never disagree, exactly as `changeRole` does.
    */
    const role = namedRole.admits_as;

    if (!isStaffRole(role)) {
      throw badRequest(ERROR.STAFF_ROLE_INVALID_CONSOLE);
    }

    const existing = await this.db.execute<{ id: string }>(
      sql`SELECT id FROM users WHERE email = ${email} AND deleted_at IS NULL`,
    );

    /**
     * Refused rather than upgraded. Turning an existing customer account into a
     * super_admin by inviting its address would be an escalation path that reads as
     * an ordinary invitation in the audit log.
     */
    if (existing.rows.length > 0) {
      throw badRequest(ERROR.STAFF_EMAIL_TAKEN);
    }

    const created = await this.db.execute<{ id: string }>(sql`
      INSERT INTO users (full_name, email, role, staff_role_id, status, preferred_locale,
                         email_verified_at)
      VALUES (${input.fullName}, ${email}, ${role}::user_role, ${input.staffRoleId}::uuid, 'active',
              ${input.locale ?? 'en'}, now())
      RETURNING id
    `);

    const user = created.rows[0];
    if (!user) throw new Error('Staff account was not created.');

    await this.audit.record({
      actorUserId: actor?.sub,
      actorRole: actor?.role,
      action: 'staff.invited',
      subjectType: 'user',
      subjectId: user.id,
      after: { fullName: input.fullName, email, role, staffRoleId: input.staffRoleId },
    });

    await this.sendInvitation(user.id, email, role, input.locale ?? 'en');

    this.logger.log(`Staff ${email} invited as ${role} by ${actor?.sub}.`);

    return { id: user.id, email, role };
  }

  /**
   * One staff account by id, or a 404.
   *
   * ## "Not staff" answers the same as "not there"
   *
   * The predicate excludes customers and partners, so passing a customer's user id — which a super
   * admin can read off الزبائن — returns a 404 rather than a partial staff record. No response
   * confirms that a uuid belongs to a real person on another registry.
   *
   * ## The permissions come from the GUARD's own resolution
   *
   * `TokenService.staffPermissions` is what mints the token the guard reads. Recomputing the same
   * thing here from `role` and `permission_overrides` would be a second implementation of the most
   * consequential rule in the platform, and it would be wrong the moment either changes — on a
   * screen whose entire purpose is to answer what this person can do.
   */
  async detail(userId: string): Promise<StaffDetail> {
    const rows = await this.db.execute<{
      id: string;
      full_name: string | null;
      email: string;
      role: Role;
      staff_role_id: string | null;
      staff_role_name: string | null;
      status: string;
      scope_kind: 'all_cities' | 'cities';
      outside_scope_access: 'none' | 'read_only';
      totp_enabled_at: string | null;
      password_hash: string | null;
      last_login_at: string | null;
      created_at: string;
    }>(sql`
      SELECT u.id, u.full_name, u.email, u.role::text AS role, u.status::text AS status,
             u.staff_role_id, r.name AS staff_role_name,
             u.scope_kind::text AS scope_kind,
             u.outside_scope_access::text AS outside_scope_access,
             u.totp_enabled_at::text, u.password_hash,
             u.last_login_at::text, u.created_at::text
      FROM users u
      LEFT JOIN staff_roles r ON r.id = u.staff_role_id AND r.deleted_at IS NULL
      WHERE u.id = ${userId}::uuid
        AND ${IS_STAFF} AND u.deleted_at IS NULL
      LIMIT 1
    `);

    const row = rows.rows[0];

    if (!row) throw notFound(ERROR.STAFF_NOT_FOUND);

    const [permissions, scopeCities, invitation] = await Promise.all([
      this.permissionsOf(userId),
      this.scopeCitiesOf(userId),
      this.outstandingInvitation(userId),
    ]);

    return {
      id: row.id,
      fullName: row.full_name,
      email: row.email,
      role: row.role,
      staffRoleId: row.staff_role_id,
      staffRoleName: row.staff_role_name,
      permissions,
      scopeCities,
      scopeKind: row.scope_kind,
      outsideScopeAccess: row.outside_scope_access,
      status: row.status,
      twoFactorEnabled: row.totp_enabled_at !== null,
      invitationPending: row.password_hash === null,
      invitationSentAt: invitation?.created_at ?? null,
      invitationExpiresAt: invitation?.expires_at ?? null,
      lastLoginAt: row.last_login_at,
      createdAt: row.created_at,
    };
  }

  /** Delegated to the token service, so the screen and the guard cannot disagree. */
  private async permissionsOf(userId: string): Promise<string[]> {
    const user = await this.db.query.users.findFirst({
      where: (table, { and, eq, isNull }) =>
        and(eq(table.id, userId), isNull(table.deletedAt)),
    });

    return user ? this.tokens.staffPermissions(user) : [];
  }

  /**
   * The cities on the account, in Arabic, or NONE when the account is unscoped.
   *
   * `scope_kind = 'all_cities'` short-circuits in the predicate: `staff_scope_cities` may still
   * hold rows from a previous scoping, and returning them for an account that is not scoped would
   * show a super admin a restriction that is not in force. `TokenService.resolveScope` ignores them
   * for the same reason, so this matches what actually gates the queries.
   */
  private async scopeCitiesOf(userId: string): Promise<{ slug: string; name: string }[]> {
    const rows = await this.db.execute<{ slug: string; name: string }>(sql`
      SELECT c.slug, c.name_ar AS name
      FROM staff_scope_cities s
      JOIN cities c ON c.id = s.city_id
      JOIN users u ON u.id = s.user_id
      WHERE s.user_id = ${userId}::uuid AND u.scope_kind = 'cities'
      ORDER BY c.name_ar
    `);

    return rows.rows;
  }

  /**
   * The invitation still standing, if there is one.
   *
   * Unconsumed AND unexpired. A redeemed invitation is not outstanding, and an expired one needs a
   * RESEND rather than a date the reader might wait on — "sent three weeks ago" and "still valid"
   * are different facts, and the screen shows the second.
   */
  private async outstandingInvitation(
    userId: string,
  ): Promise<{ created_at: string; expires_at: string } | undefined> {
    const rows = await this.db.execute<{ created_at: string; expires_at: string }>(sql`
      SELECT created_at::text, expires_at::text
      FROM auth_tokens
      WHERE user_id = ${userId}::uuid AND purpose = 'staff_invitation'
        AND consumed_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC
      LIMIT 1
    `);

    return rows.rows[0];
  }

  /**
   * Names an account — the only route by which the accounts predating `full_name` ever get one.
   *
   * ## Its own route rather than a field on the role or status patches
   *
   * Naming somebody is not changing their authority. Folded into `PATCH :userId/role`, fixing a
   * typo in a colleague's name would mean sending a role as well — so a slip in the role select
   * rides along with a correction to a spelling, and the audit trail records a role change that
   * nobody meant to make.
   *
   * ## No last-super-admin guard, deliberately
   *
   * That guard exists because demoting or suspending the last administrator locks the platform out
   * of itself. A name cannot do that. Guards that fire where they cannot help teach people to
   * expect refusals, and then the refusal that matters reads as noise.
   */
  async rename(
    actor: AccessTokenClaims | undefined,
    userId: string,
    fullName: string,
  ): Promise<void> {
    /* `staffById` is the ONE definition of "this id names a staff account", and it 404s otherwise. */
    const target = await this.staffById(userId);

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE users SET full_name = ${fullName}, updated_at = now()
        WHERE id = ${userId}::uuid
      `);

      /*
        The audit records that a name CHANGED and to what, and never the address. `full_name` is
        the thing being edited so it has to be in the record; the email is PII this file already
        refuses to log elsewhere for the same reason.
      */
      await this.audit.record(
        {
          actorUserId: actor?.sub,
          actorRole: actor?.role,
          action: 'staff.renamed',
          subjectType: 'user',
          subjectId: userId,
          before: { fullName: target.full_name },
          after: { fullName },
        },
        tx as unknown as Database,
      );
    });

    this.logger.log(`Staff ${userId} renamed by ${actor?.sub}.`);
  }

  /** Re-sends an invitation, for one that expired or never arrived. */
  async resendInvitation(
    actor: AccessTokenClaims | undefined,
    userId: string,
  ): Promise<void> {
    const target = await this.staffById(userId);

    if (target.password_hash !== null) {
      throw badRequest(ERROR.STAFF_ALREADY_ACTIVATED);
    }

    await this.audit.record({
      actorUserId: actor?.sub,
      actorRole: actor?.role,
      action: 'staff.invitation_resent',
      subjectType: 'user',
      subjectId: userId,
    });

    await this.sendInvitation(userId, target.email, target.role, target.preferred_locale);
  }

  /**
   * Changes a staff member's role.
   *
   * Sessions are revoked immediately rather than left to expire: a demotion that
   * takes fifteen minutes to apply is not a demotion, and the access-token lifetime
   * is exactly the window in which someone who has just been demoted would act.
   */
  /**
   * Moves a staff member to a NAMED ROLE (Bashar, 2026-08-23).
   *
   * Takes a `staffRoleId`, never an enum value, and never both — two ways to say the same thing is
   * how they come to disagree. The role row decides what the person may do; its `admits_as` decides
   * which enum value they hold, and therefore whether they may open the console and whether the
   * city-scope machinery applies. Both are written together so they cannot drift.
   *
   * A SYSTEM role is a legitimate target. «مدير عام» cannot be edited or withdrawn, but promoting
   * somebody INTO it is the ordinary path — and it is the only way to satisfy the last-super-admin
   * guard when the current holder is leaving.
   */
  async changeRole(
    actor: AccessTokenClaims | undefined,
    userId: string,
    staffRoleId: string,
  ): Promise<void> {
    const target = await this.staffById(userId);

    const found = await this.db.execute<{
      name: string;
      admits_as: Role;
      is_system: boolean;
    }>(sql`
      SELECT name, admits_as, is_system FROM staff_roles
      WHERE id = ${staffRoleId}::uuid AND deleted_at IS NULL LIMIT 1
    `);

    const role = found.rows[0];

    if (!role) throw badRequest(ERROR.STAFF_ROLE_NOT_FOUND);

    /**
     * Refusal 1: no changing your own role.
     *
     * Self-demotion locks you out of the console mid-session with no way back, and
     * self-promotion is the whole point of separation of duties. Either way it should
     * be another administrator's decision.
     */
    if (actor?.sub === userId) {
      throw forbidden(ERROR.STAFF_CANNOT_CHANGE_OWN_ROLE);
    }

    await this.assertNotLastSuperAdmin(target, role.is_system);

    await this.db.execute(sql`
      UPDATE users
      SET staff_role_id = ${staffRoleId}::uuid, role = ${role.admits_as}::user_role,
          updated_at = now()
      WHERE id = ${userId}
    `);

    await this.audit.record({
      actorUserId: actor?.sub,
      actorRole: actor?.role,
      action: 'staff.role_changed',
      subjectType: 'user',
      subjectId: userId,
      before: { role: target.role },
      after: { role: role.admits_as, staffRoleName: role.name },
    });

    await this.tokens.revokeAllForUser(userId);

    /*
      The user ID, not the email address.

      Rule 1: never log full PII. Every other line in this codebase logs `user.id` and this one
      logged an address — which puts a staff member's email into log aggregation, backups and
      whatever ships them onward, for no operational gain. The id answers "who" for anybody who can
      already query the table, and tells a log reader nothing about a person.
    */
    this.logger.log(`Staff ${userId}: ${target.role} → ${role.name} by ${actor?.sub}.`);
  }

  /** Suspends or reinstates an account. Suspension revokes sessions at once. */
  async setStatus(
    actor: AccessTokenClaims | undefined,
    userId: string,
    status: 'active' | 'suspended',
  ): Promise<void> {
    const target = await this.staffById(userId);

    /** Refusal 2: no suspending yourself — an instant, self-inflicted lockout. */
    if (actor?.sub === userId) {
      throw forbidden(ERROR.STAFF_CANNOT_SUSPEND_SELF);
    }

    if (status === 'suspended') {
      await this.assertNotLastSuperAdmin(target, false);
    }

    await this.db.execute(sql`
      UPDATE users SET status = ${status}::user_status, updated_at = now()
      WHERE id = ${userId}
    `);

    await this.audit.record({
      actorUserId: actor?.sub,
      actorRole: actor?.role,
      action: status === 'suspended' ? 'staff.suspended' : 'staff.reinstated',
      subjectType: 'user',
      subjectId: userId,
      before: { status: target.status },
      after: { status },
    });

    if (status === 'suspended') {
      // `AuthService.login` already refuses a non-active account; this closes the
      // window for sessions that are already open.
      await this.tokens.revokeAllForUser(userId);
    }

    /*
      The person is TOLD, and this is the only place they can be (Bashar, 2026-08-23).

      `AuthService.login` answers a suspended account exactly as it answers a wrong password —
      deliberately, so that a suspended address cannot be confirmed by probing. The consequence is
      that the sign-in screen can never explain, and somebody locked out learns nothing from the
      only surface they can still reach. The email goes to an address we already hold rather than
      revealing anything to whoever is typing.

      ## Sent AFTER the write and the revocation, and never inside a transaction

      Mail delivery is I/O to somebody else's system. Inside the transaction it would hold a row
      lock for the length of an SMTP round trip, and a delivery failure would roll back a
      suspension that had already been decided — the account would quietly stay ACTIVE because a
      mail server was slow, which is the wrong direction for this particular failure.

      A failure is logged and swallowed for the same reason: the suspension is done and correct,
      and throwing here would report it as failed to a super admin who would then try again.
    */
    await this.mail
      .send(
        status === 'suspended'
          ? staffSuspendedMail({ to: target.email, locale: target.preferred_locale })
          : staffReinstatedMail({
              to: target.email,
              locale: target.preferred_locale,
              url: `${this.env.ADMIN_URL}/login`,
            }),
      )
      .catch((error: unknown) => {
        /* The user ID, never the address — see `sendInvitation` for why this file logs neither. */
        this.logger.error(
          `Could not send the ${status} notice for staff ${userId}.`,
          error instanceof Error ? error.stack : undefined,
        );
      });
  }

  /**
   * Accepts an invitation: sets the first password and activates the account.
   *
   * Public — the recipient has no session yet. The token IS the authentication, which
   * is why it is 256 bits of randomness, single-use, and short-lived.
   */
  async acceptInvitation(token: string, password: string): Promise<void> {
    const redeemed = await this.authTokens.redeem(token, 'staff_invitation');

    /**
     * Deliberately generic. Distinguishing "expired" from "already used" from "never
     * existed" tells someone probing invitation links which guesses were close.
     */
    if (!redeemed) {
      throw badRequest(ERROR.STAFF_INVITATION_INVALID);
    }

    const hash = await this.passwords.hash(password);

    await this.db.execute(sql`
      UPDATE users
      SET password_hash = ${hash}, email_verified_at = now(), updated_at = now()
      WHERE id = ${redeemed.userId}
    `);

    await this.audit.record({
      actorUserId: redeemed.userId,
      action: 'staff.invitation_accepted',
      subjectType: 'user',
      subjectId: redeemed.userId,
    });

    /**
     * Any session opened before the password existed is revoked. There should be
     * none, but "should be none" is not a security property.
     */
    await this.tokens.revokeAllForUser(redeemed.userId);

    this.logger.log(`Staff invitation accepted for user ${redeemed.userId}.`);
  }

  private async sendInvitation(
    userId: string,
    email: string,
    role: Role,
    locale: string,
  ): Promise<void> {
    const { token } = await this.authTokens.issue(
      userId,
      'staff_invitation',
      INVITATION_TTL_MS,
    );

    await this.mail.send(
      staffInvitationMail({
        to: email,
        url: `${this.env.ADMIN_URL}/invitation/${token}`,
        role,
        locale,
        expiresInHours: INVITATION_TTL_MS / 3_600_000,
      }),
    );
  }

  private async staffById(userId: string) {
    const rows = await this.db.execute<{
      id: string;
      full_name: string | null;
      email: string;
      role: Role;
      status: string;
      password_hash: string | null;
      preferred_locale: string;
    }>(sql`
      SELECT id, full_name, email, role::text AS role, status::text AS status,
             password_hash, preferred_locale
      FROM users
      WHERE id = ${userId} AND deleted_at IS NULL
    `);

    const user = rows.rows[0];

    if (!user || !isStaffRole(user.role)) {
      throw notFound(ERROR.STAFF_NOT_FOUND);
    }

    return user;
  }

  /**
   * Refusal 3: the last active super admin cannot be demoted or suspended.
   *
   * Nothing else can grant `staff.manage`, so removing the only holder makes the
   * platform permanently unadministrable — no invitations, no role changes, no way
   * back except an INSERT against the production database, which is the very thing
   * this service exists to eliminate.
   */
  private async assertNotLastSuperAdmin(
    target: { id: string; role: Role },
    stayingSuperAdmin: boolean,
  ): Promise<void> {
    if (target.role !== 'super_admin' || stayingSuperAdmin) return;

    const others = await this.db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count FROM users
      WHERE role = 'super_admin' AND status = 'active'
        AND deleted_at IS NULL AND id <> ${target.id}
        AND password_hash IS NOT NULL
    `);

    /*
      Its OWN code, distinct from `staff_role.system` (2026-08-23).

      They are different sentences and the screen has to be able to say which: "this role cannot be
      edited" versus "this person cannot be moved off it, because they are the last one holding it".

      It also used to throw an English SENTENCE, which the project's own rule forbids — the API
      answers with a code and the reader's language resolves it. That was a real defect on the one
      refusal somebody meets in an emergency.
    */
    if (Number(others.rows[0]?.count ?? 0) === 0) {
      throw badRequest(ERROR.STAFF_LAST_SUPER_ADMIN);
    }
  }
}
