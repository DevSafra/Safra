import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';

import type { Database } from '@safra/db';
import {
  COUNT_CAP,
  ERROR,
  isStaffRole,
  type Role,
  type OffsetPage,
  offsetPage,
} from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { AuthTokenService } from '../auth/auth-token.service.js';
import { DATABASE } from '../database/database.module.js';
import { ENV, type Env } from '../config/env.js';
import { MailService } from '../mail/mail.service.js';
import { staffInvitationMail } from '../mail/mail.templates.js';
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

export interface StaffMember {
  readonly id: string;
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
      WHERE u.role <> 'customer' AND u.role <> 'partner' AND u.deleted_at IS NULL`;

    const [rows, total] = await Promise.all([
      this.db.execute<{
        id: string;
        email: string;
        role: Role;
        status: string;
        totp_enabled_at: string | null;
        password_hash: string | null;
        last_login_at: string | null;
        created_at: string;
      }>(sql`
      SELECT u.id, u.email, u.role::text AS role, u.status::text AS status,
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
      email: row.email,
      role: row.role,
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
  async invite(
    actor: AccessTokenClaims | undefined,
    input: { email: string; role: Role; locale?: string | undefined },
  ): Promise<{ id: string; email: string; role: Role }> {
    const email = input.email.trim().toLowerCase();

    if (!isStaffRole(input.role)) {
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
      INSERT INTO users (email, role, status, preferred_locale, email_verified_at)
      VALUES (${email}, ${input.role}::user_role, 'active',
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
      after: { email, role: input.role },
    });

    await this.sendInvitation(user.id, email, input.role, input.locale ?? 'en');

    this.logger.log(`Staff ${email} invited as ${input.role} by ${actor?.sub}.`);

    return { id: user.id, email, role: input.role };
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
  async changeRole(
    actor: AccessTokenClaims | undefined,
    userId: string,
    role: Role,
  ): Promise<void> {
    const target = await this.staffById(userId);

    if (!isStaffRole(role)) {
      throw badRequest(ERROR.STAFF_ROLE_INVALID);
    }

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

    await this.assertNotLastSuperAdmin(target, role === 'super_admin');

    await this.db.execute(sql`
      UPDATE users SET role = ${role}::user_role, updated_at = now()
      WHERE id = ${userId}
    `);

    await this.audit.record({
      actorUserId: actor?.sub,
      actorRole: actor?.role,
      action: 'staff.role_changed',
      subjectType: 'user',
      subjectId: userId,
      before: { role: target.role },
      after: { role },
    });

    await this.tokens.revokeAllForUser(userId);

    /*
      The user ID, not the email address.

      Rule 1: never log full PII. Every other line in this codebase logs `user.id` and this one
      logged an address — which puts a staff member's email into log aggregation, backups and
      whatever ships them onward, for no operational gain. The id answers "who" for anybody who can
      already query the table, and tells a log reader nothing about a person.
    */
    this.logger.log(`Staff ${userId}: ${target.role} → ${role} by ${actor?.sub}.`);
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
        roleLabel: role.replace(/_/g, ' '),
        locale,
        expiresInHours: INVITATION_TTL_MS / 3_600_000,
      }),
    );
  }

  private async staffById(userId: string) {
    const rows = await this.db.execute<{
      id: string;
      email: string;
      role: Role;
      status: string;
      password_hash: string | null;
      preferred_locale: string;
    }>(sql`
      SELECT id, email, role::text AS role, status::text AS status,
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

    if (Number(others.rows[0]?.count ?? 0) === 0) {
      throw new BadRequestException(
        'This is the last active super admin. Promote another one first, or the ' +
          'platform cannot be administered.',
      );
    }
  }
}
