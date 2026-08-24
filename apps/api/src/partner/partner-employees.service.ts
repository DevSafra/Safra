import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import {
  decodeCursor,
  employeePermissions,
  encodeCursor,
  ERROR,
  type CursorQuery,
  type EmployeeInviteInput,
  type EmployeeUpdateInput,
} from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { AuthTokenService } from '../auth/auth-token.service.js';
import { DATABASE } from '../database/database.module.js';
import { ENV, type Env } from '../config/env.js';
import { MailService } from '../mail/mail.service.js';
import { TokenService } from '../auth/token.service.js';
import { badRequest, conflict, notFound } from '../common/errors/app-error.js';
import { findLiveEmployment } from './live-employment.js';
import { partnerEmployeeInvitationMail } from '../mail/mail.templates.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/** How long an employee has to accept. The same 72 hours a partner's own invitation lasts. */
const INVITATION_TTL_HOURS = 72;

/** One page of employees, in the shape every cursor-paginated list in this platform returns. */
export type EmployeePage = {
  items: EmployeeRow[];
  nextCursor: string | null;
};

export type EmployeeRow = {
  id: string;
  fullName: string;
  email: string;
  roleId: string;
  roleName: string;
  permissions: string[];
  status: string;
  activated: boolean;
  invitationPending: boolean;
  createdAt: string;
};

/**
 * A partner's own staff (Bashar, 2026-08-23).
 *
 * ## Everything here is scoped by the caller's own partner id
 *
 * `partnerId` comes from the verified token and is never taken from a request. "Manage somebody
 * else's employees" is therefore not a question this service can be asked — the same construction
 * the partner contract and document readers use, and for the same reason.
 *
 * ## An employee is a real account, invited
 *
 * Not a sub-login and not a shared password: a `users` row with its own credentials, so every
 * booking a receptionist takes is attributable to that person. The account is created without a
 * password and activated by an emailed link, exactly as a partner's own account is — which means
 * the partner never handles a password on somebody else's behalf.
 *
 * ## Two switches, two owners
 *
 * `partner_employees.status` belongs to the PARTNER; `users.status` belongs to the platform. A
 * partner suspending a receptionist must not touch the platform-level account, and a platform
 * suspension must not be undoable by the partner. Sign-in requires both to be open.
 */
@Injectable()
export class PartnerEmployeesService {
  private readonly logger = new Logger(PartnerEmployeesService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly authTokens: AuthTokenService,
    private readonly tokens: TokenService,
    private readonly mail: MailService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * This partner's employees, KEYSET-paginated (Bashar's rule 2; argued by the security session).
   *
   * It returned everything unpaged, on the reasoning that a partner has tens of staff rather than
   * thousands. That reasoning was wrong in a specific way worth recording, because it is the same
   * reasoning the geography screens are exempted on and the exemption does not transfer:
   *
   * - Countries and cities grow when WE add one. A bounds test fires in our CI at the moment we
   *   are about to break the assumption — the alarm precedes the harm, and the person who trips it
   *   is the person who can act on it.
   * - Employees grow when a PARTNER hires somebody. A bounds test would fire AFTER that partner's
   *   screen had already stopped working, in our CI, about somebody else's organisation, for a
   *   reason they caused and we cannot undo. The alarm follows the harm.
   *
   * And the assumption itself is weaker: "SAFRA operates in three countries" is a fact about our
   * roadmap; "a partner has tens, not thousands" is a guess about a stranger's business. A hotel
   * group onboarding with three hundred staff is an ordinary customer, not an edge case.
   *
   * CURSOR rather than page numbers, because this is a partner-facing list rather than one of the
   * console's registries — the standing instruction reserves `OFFSET` and a page NUMBER for those.
   */
  async list(
    partnerId: string,
    query: CursorQuery = { limit: 20 },
  ): Promise<EmployeePage> {
    let after: { sortKey: string; id: string } | null = null;

    if (query.cursor !== undefined) {
      const decoded = decodeCursor(query.cursor);

      /* A forged cursor shifts the window and never widens it — the partner id is not in it. */
      if (!decoded) throw badRequest(ERROR.REQUEST_CURSOR_INVALID);

      after = { sortKey: decoded.sortKey, id: decoded.id };
    }

    const keyset = after
      ? sql`AND (e.created_at, e.id) < (${after.sortKey}::timestamptz, ${after.id}::uuid)`
      : sql``;

    const rows = await this.db.execute<{
      id: string;
      sort_key: string;
      full_name: string;
      email: string;
      role_id: string;
      role_name: string;
      permissions: string[];
      status: string;
      activated: boolean;
      invitation_pending: boolean;
      created_at: string;
    }>(sql`
      SELECT e.id, e.created_at::text AS sort_key, e.full_name, u.email,
             r.id AS role_id, r.name AS role_name,
             r.permissions, e.status::text AS status,
             (u.role = 'partner_employee') AS activated,
             EXISTS (
               SELECT 1 FROM auth_tokens t
               WHERE t.user_id = u.id
                 AND t.purpose = 'partner_employee_invitation'
                 AND t.consumed_at IS NULL
                 AND t.expires_at > now()
             ) AS invitation_pending,
             to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS created_at
      FROM partner_employees e
      JOIN users u ON u.id = e.user_id
      JOIN partner_employee_roles r ON r.id = e.role_id
      WHERE e.partner_id = ${partnerId}::uuid AND e.deleted_at IS NULL
        ${keyset}
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT ${query.limit + 1}
    `);

    const page = rows.rows.slice(0, query.limit);
    const last = page.at(-1);

    return {
      items: page.map((row) => ({
        id: row.id,
        fullName: row.full_name,
        email: row.email,
        roleId: row.role_id,
        roleName: row.role_name,
        /* Narrowed on read — a stored role row is not authoritative. See `employeePermissions`. */
        permissions: employeePermissions(row.permissions),
        status: row.status,
        activated: row.activated,
        invitationPending: row.invitation_pending,
        createdAt: row.created_at,
      })),
      nextCursor:
        rows.rows.length > query.limit && last
          ? encodeCursor(last.sort_key, last.id)
          : null,
    };
  }

  /** The roles THIS partner has defined. Never another partner's — see `invite`. */
  async assignableRoles(
    partnerId: string,
  ): Promise<{ id: string; name: string; permissions: string[] }[]> {
    const rows = await this.db.execute<{
      id: string;
      name: string;
      permissions: string[];
    }>(sql`
      SELECT id, name, permissions FROM partner_employee_roles
      WHERE partner_id = ${partnerId}::uuid AND deleted_at IS NULL
      ORDER BY name
    `);

    return rows.rows.map((row) => ({
      id: row.id,
      name: row.name,
      permissions: employeePermissions(row.permissions),
    }));
  }

  /**
   * Invites somebody to work for this partner.
   *
   * ## What the address is checked against, and why each one
   *
   * - A STAFF account is refused: a SAFRA employee is not a partner's employee, and converting one
   *   would demote a colleague's account through a form a partner controls.
   * - The partner's OWN account is refused: an owner is not their own employee, and the conversion
   *   would replace `role = 'partner'` with `partner_employee` — taking the business's own access
   *   away through its own screen.
   * - Somebody already employed is refused, including by this same partner. The unique index says
   *   one live employment per account; answering with a code is better than a constraint error.
   *
   * A plain CUSTOMER account is adopted rather than refused, which is the same choice partner
   * onboarding makes: the person exists, and refusing them would mean asking somebody to abandon
   * an address they already use.
   */
  async invite(
    actor: AccessTokenClaims | undefined,
    partnerId: string,
    input: EmployeeInviteInput,
  ): Promise<EmployeePage> {
    const role = await this.db.execute<{ id: string }>(sql`
      SELECT id FROM partner_employee_roles
      WHERE id = ${input.roleId}::uuid AND deleted_at IS NULL LIMIT 1
    `);

    if (!role.rows[0]) throw notFound(ERROR.EMPLOYEE_ROLE_NOT_FOUND);

    const existing = await this.db.execute<{
      id: string;
      role: string;
      owns_partner: boolean;
      employed: boolean;
    }>(sql`
      SELECT u.id, u.role::text AS role,
             EXISTS (
               SELECT 1 FROM partners p
               WHERE p.user_id = u.id AND p.deleted_at IS NULL
             ) AS owns_partner,
             EXISTS (
               SELECT 1 FROM partner_employees e
               WHERE e.user_id = u.id AND e.deleted_at IS NULL
             ) AS employed
      FROM users u
      WHERE lower(u.email) = lower(${input.email}) AND u.deleted_at IS NULL
      LIMIT 1
    `);

    const account = existing.rows[0];

    if (account) {
      if (account.employed) throw conflict(ERROR.EMPLOYEE_ALREADY_EMPLOYED);
      if (account.owns_partner || account.role === 'partner') {
        throw conflict(ERROR.EMPLOYEE_EMAIL_IS_OWNER);
      }
      if (account.role !== 'customer') throw conflict(ERROR.EMPLOYEE_EMAIL_IS_STAFF);
    }

    const userId = await this.db.transaction(async (tx) => {
      let id = account?.id;

      if (!id) {
        /*
          Created with NO password. The invitation link is the only way in, so a window between
          creation and acceptance cannot be a window in which the account is guessable.
        */
        const created = await tx.execute<{ id: string }>(sql`
          INSERT INTO users (email, role, status)
          VALUES (lower(${input.email}), 'customer'::user_role, 'active')
          RETURNING id
        `);

        id = created.rows[0]?.id;
      }

      await tx.execute(sql`
        INSERT INTO partner_employees
          (partner_id, user_id, role_id, full_name, invited_by_user_id)
        VALUES (${partnerId}::uuid, ${id}::uuid, ${input.roleId}::uuid, ${input.fullName},
                ${actor?.sub}::uuid)
      `);

      await this.audit.record(
        {
          actorUserId: actor?.sub,
          actorRole: actor?.role,
          action: 'partner_employee.invited',
          subjectType: 'partner_employee',
          subjectId: id,
          /* The role and whether an account was adopted. Never the address — see the audit rules. */
          after: { roleId: input.roleId, accountExisted: account !== undefined },
        },
        tx as unknown as Database,
      );

      return id;
    });

    if (userId) await this.sendInvitation(userId, input.email, partnerId);

    return this.list(partnerId);
  }

  /**
   * Changes an employee's role, or suspends and restores them.
   *
   * ## Suspension revokes every session, immediately
   *
   * This is the emergency lever — the thing a partner reaches for when somebody has just left, or
   * should not be taking bookings right now. An access token already issued would otherwise keep
   * working until it expired, so the suspension would take effect minutes after it was applied.
   * `staff.service.ts` states the same rule for a demotion: one that takes fifteen minutes to
   * apply is not a demotion.
   *
   * A ROLE change deliberately does not revoke. It is routine, and signing somebody out mid-shift
   * because their title changed is a worse outcome than a few minutes of the old permission set.
   */
  async update(
    actor: AccessTokenClaims | undefined,
    partnerId: string,
    employeeId: string,
    input: EmployeeUpdateInput,
  ): Promise<EmployeePage> {
    const found = await this.db.execute<{
      user_id: string;
      role_id: string;
      status: string;
    }>(sql`
      SELECT user_id, role_id, status::text AS status FROM partner_employees
      WHERE id = ${employeeId}::uuid AND partner_id = ${partnerId}::uuid AND deleted_at IS NULL
      LIMIT 1
    `);

    const employee = found.rows[0];

    /* Somebody else's employee answers exactly as one that does not exist. */
    if (!employee) throw notFound(ERROR.EMPLOYEE_NOT_FOUND);

    if (input.roleId) {
      const role = await this.db.execute<{ id: string }>(sql`
        SELECT id FROM partner_employee_roles
        WHERE id = ${input.roleId}::uuid AND deleted_at IS NULL LIMIT 1
      `);

      if (!role.rows[0]) throw notFound(ERROR.EMPLOYEE_ROLE_NOT_FOUND);
    }

    if (input.roleId === undefined && input.status === undefined) {
      throw badRequest(ERROR.REQUEST_VALIDATION_FAILED);
    }

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE partner_employees
        SET role_id = COALESCE(${input.roleId ?? null}::uuid, role_id),
            status = COALESCE(
              ${input.status ?? null}::partner_employee_status, status
            ),
            updated_at = now()
        WHERE id = ${employeeId}::uuid AND partner_id = ${partnerId}::uuid
      `);

      await this.audit.record(
        {
          actorUserId: actor?.sub,
          actorRole: actor?.role,
          action: 'partner_employee.updated',
          subjectType: 'partner_employee',
          subjectId: employeeId,
          before: { roleId: employee.role_id, status: employee.status },
          after: {
            roleId: input.roleId ?? employee.role_id,
            status: input.status ?? employee.status,
          },
        },
        tx as unknown as Database,
      );
    });

    if (input.status === 'suspended') {
      await this.revoke(employee.user_id, 'suspended');
    }

    return this.list(partnerId);
  }

  /** Removes somebody from the partner's staff. Soft, and their sessions end immediately. */
  async remove(
    actor: AccessTokenClaims | undefined,
    partnerId: string,
    employeeId: string,
  ): Promise<EmployeePage> {
    const found = await this.db.execute<{ user_id: string }>(sql`
      SELECT user_id FROM partner_employees
      WHERE id = ${employeeId}::uuid AND partner_id = ${partnerId}::uuid AND deleted_at IS NULL
      LIMIT 1
    `);

    const employee = found.rows[0];

    if (!employee) throw notFound(ERROR.EMPLOYEE_NOT_FOUND);

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE partner_employees SET deleted_at = now(), updated_at = now()
        WHERE id = ${employeeId}::uuid AND partner_id = ${partnerId}::uuid
      `);

      /*
        The ROLE goes back to `customer`, and this is not tidying — without it, ending a job ends
        the ACCOUNT (Bashar, 2026-08-23; found by the security session).

        An activated employee is `partner_employee`. Remove the employment and the employee lookup
        finds nothing, so they get no partner and no permissions — and the role no longer says
        `customer` either. The result was an account that could still sign in and do nothing at
        all, with no endpoint anywhere that reversed it.

        Only an activated employee is touched: somebody who never opened their invitation is still
        `customer` and must stay that way.
      */
      await tx.execute(sql`
        UPDATE users SET role = 'customer'::user_role, updated_at = now()
        WHERE id = ${employee.user_id}::uuid AND role = 'partner_employee'::user_role
      `);

      await this.audit.record(
        {
          actorUserId: actor?.sub,
          actorRole: actor?.role,
          action: 'partner_employee.removed',
          subjectType: 'partner_employee',
          subjectId: employeeId,
        },
        tx as unknown as Database,
      );
    });

    /*
      The ACCOUNT is left alone — only the employment ends.

      The person may be a customer of the platform in their own right, and removing them from a
      hotel's staff is not grounds to take their own bookings away. Their role reverts on the next
      token build because the employment lookup finds nothing; the session revocation is what makes
      that immediate rather than eventual.
    */
    await this.revoke(employee.user_id, 'removed');

    return this.list(partnerId);
  }

  /**
   * An invited employee sets their password and activates the account.
   *
   * ## The employment is re-checked at redemption, not only when the link was sent
   *
   * The same reasoning `acceptInvitation` gives for a partner: the check is days old by the time
   * somebody clicks. An employment that has since been removed, suspended, or whose partner has
   * been deleted or suspended, redeems into nothing rather than activating an account nobody
   * expects. Without this, removing an employee before they ever accepted would leave a live link
   * that still worked.
   *
   * ## One code for every failure
   *
   * Expired, already used, never existed, employment withdrawn — all `EMPLOYEE_INVITATION_INVALID`.
   * Distinguishing them tells somebody probing links which guesses were close.
   */
  async acceptInvitation(token: string, hash: string): Promise<void> {
    const redeemed = await this.authTokens.redeem(token, 'partner_employee_invitation');

    if (!redeemed) throw badRequest(ERROR.EMPLOYEE_INVITATION_INVALID);

    const rows = await this.db.execute<{ role: string }>(sql`
      SELECT u.role::text AS role FROM users u
      WHERE u.id = ${redeemed.userId}::uuid AND u.deleted_at IS NULL
    `);

    const account = rows.rows[0];

    /*
      The SAME definition the token builder uses — see `findLiveEmployment`.

      This used to carry its own copy of the predicate and it was missing one condition: it checked
      the employer's deletion and suspension but not whether the ROLE had been withdrawn. So a
      withdrawn role still activated, and the person landed on an account with no partner and no
      permissions — a flow reporting success while the account could not be used. Two predicates
      that agree by luck drift; one function cannot.
    */
    const employed = (await findLiveEmployment(this.db, redeemed.userId)) !== null;

    /*
      Only a CUSTOMER may be converted. An account that has become staff, or a partner owner, in
      the days since the invitation was sent is not demoted by a link somebody still holds.
    */
    if (!account || !employed || account.role !== 'customer') {
      throw badRequest(ERROR.EMPLOYEE_INVITATION_INVALID);
    }

    /*
      A SUSPENDED employer cannot activate new staff, and this check is now explicit.

      It used to be a side effect: `findLiveEmployment` filtered `partners.suspended_at`, so an
      employment at a suspended business simply did not resolve. That filter came out on
      2026-08-24, because Bashar's policy is that a suspended partner and their staff may still
      sign in and read the account — so the token had to stop stripping their scope.

      The refusal it was quietly providing is a real one and it is kept, here, where a reader can
      see it. Activating an account is onboarding somebody into a business that is on hold, and it
      is a WRITE. It is refused as an invalid invitation rather than with the suspension code
      because this route is `@Public()` — the caller holds a link and no session, and telling an
      anonymous holder of a token that a named business is suspended is a disclosure the enforcement
      never intended.
    */
    const employer = await this.db.execute<{ suspended: boolean }>(sql`
      SELECT (p.suspended_at IS NOT NULL) AS suspended
      FROM partner_employees e
      JOIN partners p ON p.id = e.partner_id
      WHERE e.user_id = ${redeemed.userId}::uuid AND e.deleted_at IS NULL
      LIMIT 1
    `);

    if (employer.rows[0]?.suspended) {
      throw badRequest(ERROR.EMPLOYEE_INVITATION_INVALID);
    }

    await this.db.execute(sql`
      UPDATE users
      SET password_hash = ${hash}, role = 'partner_employee'::user_role,
          email_verified_at = now(), updated_at = now()
      WHERE id = ${redeemed.userId}::uuid
    `);

    await this.audit.record({
      actorUserId: redeemed.userId,
      actorRole: 'partner_employee',
      action: 'partner_employee.activated',
      subjectType: 'user',
      subjectId: redeemed.userId,
    });

    /*
      Every prior session goes. If this was a customer account, the sessions it already had were
      issued to a customer — a role change that takes fifteen minutes to apply is not a role change.
    */
    await this.revoke(redeemed.userId, 'activated');

    this.logger.log(`A partner employee activated their account.`);
  }

  /** Ends every session an account holds, so a change of authority applies now rather than soon. */
  private async revoke(userId: string, why: string): Promise<void> {
    await this.tokens.revokeAllForUser(userId).catch((error: unknown) => {
      this.logger.error(
        `Could not revoke sessions for a ${why} employee: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  private async sendInvitation(
    userId: string,
    to: string,
    partnerId: string,
  ): Promise<void> {
    const partner = await this.db.execute<{ display_name: string }>(sql`
      SELECT display_name FROM partners WHERE id = ${partnerId}::uuid LIMIT 1
    `);

    const { token } = await this.authTokens.issue(
      userId,
      'partner_employee_invitation',
      INVITATION_TTL_HOURS * 60,
    );

    await this.mail
      .send(
        partnerEmployeeInvitationMail({
          to,
          partnerName: partner.rows[0]?.display_name ?? '',
          url: new URL(`/employee-invitation/${token}`, this.env.PARTNER_URL).toString(),
          hours: INVITATION_TTL_HOURS,
          locale: 'ar',
        }),
      )
      .catch((error: unknown) => {
        this.logger.error(
          `Could not send an employee invitation: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }
}
