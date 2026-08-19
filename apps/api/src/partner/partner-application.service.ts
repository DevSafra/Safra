import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';

import type { Database } from '@safra/db';
import {
  COUNT_CAP,
  ERROR,
  offsetPage,
  type PartnerApplicationInput,
  type PartnerApplicationListQuery,
} from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { AuthTokenService } from '../auth/auth-token.service.js';
import { DATABASE } from '../database/database.module.js';
import { ENV, type Env } from '../config/env.js';
import { MailService } from '../mail/mail.service.js';
import { PasswordService } from '../common/crypto/password.service.js';
import { TokenService } from '../auth/token.service.js';
import {
  partnerApplicationReceivedMail,
  partnerApplicationRejectedMail,
  partnerInvitationMail,
} from '../mail/mail.templates.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { badRequest, conflict, notFound } from '../common/errors/app-error.js';

/**
 * How long an invitation link lives.
 *
 * Seventy-two hours: an invitation is EXPECTED, unlike a password reset, and the recipient has
 * just been telephoned — but it is also the only thing standing between an inbox and a partner
 * account, so it does not live for a week.
 */
const INVITATION_TTL_MS = 72 * 60 * 60 * 1000;

/** `PRQ-000031`. Bounded before it reaches a query; the lookup is parameterised regardless. */
const REFERENCE_PATTERN = /^PRQ-\d{1,12}$/;

type ApplicationRow = {
  /** The uuid. Never leaves the service — `audit_log.subject_id` is a uuid column. */
  id: string;
  /** The account that filed it. The ONLY account acceptance may convert. Never leaves the service. */
  submitted_by_user_id: string | null;
  reference: string;
  status: string;
  contact_name: string;
  email: string;
  phone: string;
  legal_name: string;
  display_name: string;
  partner_type: string;
  partner_type_ar: string;
  city: string;
  city_ar: string;
  address: string;
  property_count: number | null;
  website: string | null;
  message: string | null;
  preferred_locale: string;
  contacted_at: string | null;
  contacted_by_email: string | null;
  contact_notes: string | null;
  decided_at: string | null;
  decided_by_email: string | null;
  decision_notes: string | null;
  partner_reference: string | null;
  partner_verification: string | null;
  created_at: string;
};

/**
 * «انضم كشريك» — the request to become a partner, and what SAFRA does with it.
 *
 * ## The seven steps this implements
 *
 * Bashar, 2026-08-19: a public page with information and a form; the request reaches the super
 * admin; the super admin telephones the applicant; accepts; the partner receives the contract and
 * their account; the account stays PENDING while documents are checked; and only a verified
 * partner may set prices, dates and images.
 *
 * Steps 1–4 live here. Step 5 is `partners.verification` defaulting to `pending`, step 6 is the
 * existing verification endpoint, and step 7 is the guard in `RequireVerifiedPartner`.
 *
 * ## Why an application is not a partner in an early status
 *
 * See the table docblock in `packages/db/src/schema/partner.ts`. The short version: every query
 * that means "our partners" would otherwise have to remember to exclude people who merely filled
 * in a form, and the one that forgot would be the bug.
 *
 * ## Only a signed-in customer may apply (Bashar, 2026-08-19)
 *
 * The endpoint is authenticated and the request records the ACCOUNT that filed it. Nothing about
 * the applicant's identity is typed: the address, and the account acceptance converts, are both
 * read from the verified token.
 *
 * That is a simplification with teeth. An earlier version accepted an anonymous form carrying a
 * typed email — a CLAIM about a mailbox nobody had checked — and every later step had to be built
 * so that a forged claim cost the real owner nothing. Requiring a session deletes the class of
 * problem instead of defending against it: "apply as somebody else" is now unexpressible.
 *
 * ## The role still changes at REDEMPTION, not at acceptance
 *
 * Kept, for two reasons that survive the session requirement. A partner account is a privileged
 * one, so its password is re-established rather than inherited from whatever the customer account
 * had; and a live mailbox is confirmed before somebody is handed a business relationship. What is
 * gone is the third reason — defending a stranger's account — because there is no stranger any
 * more.
 *
 * Two accounts are refused rather than invited: a STAFF account, because an "acceptance" that
 * demotes an operations manager is an escalation path wearing an innocent label, and one that is
 * already a partner, because there is nothing to create. Both are checked when the request is
 * FILED as well as when it is accepted, so an ineligible account is told immediately instead of
 * after a phone call.
 */
@Injectable()
export class PartnerApplicationService {
  private readonly logger = new Logger(PartnerApplicationService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly authTokens: AuthTokenService,
    private readonly mail: MailService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Step 1 — a signed-in customer asks to join.
   *
   * `userId` comes from the verified token and is required. Everything about WHO is applying is
   * derived from it: the address the acknowledgement goes to, the account acceptance will convert,
   * and the eligibility check. The body supplies only facts about the BUSINESS.
   */
  async submit(
    input: PartnerApplicationInput,
    context: {
      userId: string;
      ipAddress?: string | undefined;
      userAgent?: string | undefined;
    },
  ): Promise<{ reference: string }> {
    /*
      Checked here, before anything is written, and again at acceptance.

      Telling somebody «هذا البريد شريك بالفعل» when they press send is a far better answer than
      accepting the request, telephoning them, and discovering it at the decision.
    */
    const account = await this.accountOf(context.userId);

    const [partnerType, city] = await Promise.all([
      this.lookupPartnerType(input.partnerTypeCode),
      this.lookupCity(input.citySlug),
    ]);

    /*
      Checked here AND enforced by a partial unique index.

      The check is for the message — «لدينا طلب مفتوح من هذا البريد» is a useful answer and a
      unique-violation stack trace is not. The index is for the truth: two forms submitted in the
      same second would both pass this check, and only one can win at the database.
    */
    const open = await this.db.execute<{ reference: string }>(sql`
      SELECT reference FROM partner_applications
      WHERE lower(email) = lower(${account.email})
        AND status IN ('submitted', 'contacted')
        AND deleted_at IS NULL
      LIMIT 1
    `);

    if (open.rows[0]) throw conflict(ERROR.PARTNER_APPLICATION_ALREADY_OPEN);

    const created = await this.db.execute<{ id: string; reference: string }>(sql`
      INSERT INTO partner_applications
        (submitted_by_user_id, contact_name, email, phone, legal_name, display_name,
         partner_type_id, city_id, address, property_count, website, message, preferred_locale)
      VALUES (${context.userId}, ${input.contactName}, ${account.email}, ${input.phone},
              ${input.legalName}, ${input.displayName}, ${partnerType.id}, ${city.id},
              ${input.address}, ${input.propertyCount ?? null}, ${input.website ?? null},
              ${input.message ?? null}, ${input.preferredLocale})
      RETURNING id, reference
    `);

    const row = created.rows[0];

    if (!row) throw badRequest(ERROR.REQUEST_VALIDATION_FAILED);

    await this.audit.record({
      actorUserId: context.userId,
      actorRole: 'customer',
      action: 'partner_application.submitted',
      subjectType: 'partner_application',
      subjectId: row.id,
      /*
        The business, not the person. `legalName` and the city are what a reviewer needs to
        recognise the row later; the applicant's name, phone and address are on the record itself
        and do not need a second copy in a table staff can export.
      */
      after: {
        reference: row.reference,
        legalName: input.legalName,
        city: input.citySlug,
      },
      ...(context.ipAddress === undefined ? {} : { ipAddress: context.ipAddress }),
      ...(context.userAgent === undefined ? {} : { userAgent: context.userAgent }),
    });

    /* After the row exists. An acknowledgement for a request we failed to store would be a lie. */
    await this.mail.send(
      partnerApplicationReceivedMail({
        to: account.email,
        reference: row.reference,
        url: this.joinUrl(input.preferredLocale),
        locale: input.preferredLocale,
      }),
    );

    this.logger.log(
      `Partnership request ${row.reference} submitted from ${input.citySlug}.`,
    );

    /*
      The reference, and nothing else.

      Not the row, not its status, not its id. The applicant needs a number to quote; anything
      more is the review queue answering questions the public form was never asked.
    */
    return { reference: row.reference };
  }

  /** The console's queue. Paged by NUMBER, like every other staff registry. */
  async list(query: PartnerApplicationListQuery) {
    const search = query.q ? `%${query.q}%` : null;

    /*
      One `FROM … WHERE`, shared by the page and the count — the house rule for every paginated
      list. A count built from a separately written predicate drifts from the list it describes.
    */
    const fromWhere = sql`
      FROM partner_applications a
      JOIN partner_types pt ON pt.id = a.partner_type_id
      JOIN cities c ON c.id = a.city_id
      LEFT JOIN users cb ON cb.id = a.contacted_by_user_id
      LEFT JOIN users db ON db.id = a.decided_by_user_id
      LEFT JOIN partners p ON p.id = a.partner_id
      WHERE a.deleted_at IS NULL
        ${query.status ? sql`AND a.status = ${query.status}::partner_application_status` : sql``}
        ${
          search
            ? sql`AND (a.reference ILIKE ${search} OR a.display_name ILIKE ${search}
                       OR a.legal_name ILIKE ${search} OR a.email ILIKE ${search})`
            : sql``
        }
    `;

    const rows = await this.db.execute<ApplicationRow>(sql`
      SELECT a.id, a.submitted_by_user_id, a.reference, a.status::text AS status,
             a.contact_name, a.email, a.phone,
             a.legal_name, a.display_name, pt.code AS partner_type, pt.name_ar AS partner_type_ar,
             c.slug AS city, c.name_ar AS city_ar, a.address, a.property_count, a.website,
             a.message, a.preferred_locale,
             a.contacted_at::text, cb.email AS contacted_by_email, a.contact_notes,
             a.decided_at::text, db.email AS decided_by_email, a.decision_notes,
             p.reference AS partner_reference, p.verification::text AS partner_verification,
             a.created_at::text
      ${fromWhere}
      ORDER BY a.created_at DESC, a.reference DESC
      LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}
    `);

    return offsetPage(
      rows.rows.map((row) => this.viewOf(row)),
      await this.countOf(fromWhere),
      query,
    );
  }

  /** How many requests nobody has decided yet. Drives the sidebar badge. */
  async openCount(): Promise<number> {
    const rows = await this.db.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n FROM (
        SELECT 1 FROM partner_applications
        WHERE status IN ('submitted', 'contacted') AND deleted_at IS NULL
        LIMIT ${COUNT_CAP + 1}
      ) capped
    `);

    return Number(rows.rows[0]?.n ?? 0);
  }

  async detail(reference: string) {
    const row = await this.rowOf(reference);

    return this.viewOf(row);
  }

  /** Step 2 — the super admin telephoned them, and says so on the record. */
  async markContacted(
    claims: AccessTokenClaims | undefined,
    reference: string,
    notes: string,
  ) {
    const row = await this.rowOf(reference);

    if (row.status !== 'submitted' && row.status !== 'contacted') {
      throw badRequest(ERROR.PARTNER_APPLICATION_ALREADY_DECIDED);
    }

    await this.db.execute(sql`
      UPDATE partner_applications
      SET status = 'contacted'::partner_application_status,
          contacted_at = now(), contacted_by_user_id = ${claims?.sub ?? null},
          contact_notes = ${notes}, updated_at = now()
      WHERE reference = ${reference}
    `);

    await this.audit.record({
      actorUserId: claims?.sub,
      actorRole: claims?.role,
      action: 'partner_application.contacted',
      subjectType: 'partner_application',
      subjectId: row.id,
      before: { status: row.status },
      after: { status: 'contacted' },
    });

    return this.detail(reference);
  }

  /**
   * Steps 3 and 4 — accepted, and the partner record and invitation created.
   *
   * The account is the one that FILED the request, recorded from its session. No account is
   * created here and none is looked up by address, so acceptance cannot reach an account the
   * applicant did not prove they hold.
   *
   * `accountOf` is asked again rather than trusted from submission time, because days pass in
   * between and eligibility can change. Everything else here is bookkeeping.
   */
  async accept(claims: AccessTokenClaims | undefined, reference: string, notes?: string) {
    const row = await this.rowOf(reference);

    if (row.status === 'accepted' || row.status === 'rejected') {
      throw badRequest(ERROR.PARTNER_APPLICATION_ALREADY_DECIDED);
    }

    /* Not-null since the session requirement; older rows predate it and cannot be accepted. */
    if (!row.submitted_by_user_id) {
      throw badRequest(ERROR.PARTNER_APPLICATION_NO_ACCOUNT);
    }

    const userId = row.submitted_by_user_id;

    await this.accountOf(userId);

    const created = await this.db.transaction(async (tx) => {
      /*
        `verification` is left to its column default of `pending` — step 5.

        Written here it would be one more place an accepted application could accidentally set
        `approved`, and the default is the thing §8.1 actually depends on.
      */
      const partnerRows = await tx.execute<{ id: string; reference: string }>(sql`
        INSERT INTO partners
          (user_id, partner_type_id, legal_name, display_name, city_id, address, phone, email)
        SELECT ${userId}::uuid, a.partner_type_id, a.legal_name, a.display_name, a.city_id,
               a.address, a.phone, a.email
        FROM partner_applications a
        WHERE a.reference = ${reference}
        RETURNING id, reference
      `);

      const partner = partnerRows.rows[0];

      if (!partner) throw new Error('Partner record was not created.');

      await tx.execute(sql`
        UPDATE partner_applications
        SET status = 'accepted'::partner_application_status,
            decided_at = now(), decided_by_user_id = ${claims?.sub ?? null},
            decision_notes = ${notes ?? null}, partner_id = ${partner.id}::uuid,
            updated_at = now()
        WHERE reference = ${reference}
      `);

      await tx.execute(sql`
        INSERT INTO timeline_events (subject_type, subject_id, event_type, actor_type, payload)
        VALUES ('partner', ${partner.id}, 'partner.application_accepted', 'staff',
                ${JSON.stringify({ application: reference })}::jsonb)
      `);

      return { partnerId: partner.id, partnerReference: partner.reference, userId };
    });

    await this.audit.record({
      actorUserId: claims?.sub,
      actorRole: claims?.role,
      action: 'partner_application.accepted',
      subjectType: 'partner_application',
      subjectId: row.id,
      before: { status: row.status },
      after: { status: 'accepted', partner: created.partnerReference },
    });

    /*
      The invitation goes out AFTER the transaction commits.

      Inside it, a rollback would leave somebody holding a live link to an account that does not
      exist. The order costs nothing: a mail that fails to send is re-sendable from the screen,
      and the partner record is already correct.
    */
    await this.sendInvitation(created.userId, row, created.partnerReference);

    this.logger.log(
      `Partnership request ${reference} accepted; partner ${created.partnerReference} invited.`,
    );

    return this.detail(reference);
  }

  /** Rejected, with the reason mailed to the applicant. */
  async reject(claims: AccessTokenClaims | undefined, reference: string, notes: string) {
    const row = await this.rowOf(reference);

    if (row.status === 'accepted' || row.status === 'rejected') {
      throw badRequest(ERROR.PARTNER_APPLICATION_ALREADY_DECIDED);
    }

    await this.db.execute(sql`
      UPDATE partner_applications
      SET status = 'rejected'::partner_application_status,
          decided_at = now(), decided_by_user_id = ${claims?.sub ?? null},
          decision_notes = ${notes}, updated_at = now()
      WHERE reference = ${reference}
    `);

    await this.audit.record({
      actorUserId: claims?.sub,
      actorRole: claims?.role,
      action: 'partner_application.rejected',
      subjectType: 'partner_application',
      subjectId: row.id,
      before: { status: row.status },
      after: { status: 'rejected' },
    });

    await this.mail.send(
      partnerApplicationRejectedMail({
        to: row.email,
        reference,
        reason: notes,
        url: this.joinUrl(row.preferred_locale),
        locale: row.preferred_locale,
      }),
    );

    return this.detail(reference);
  }

  /** Re-sends the invitation, for one that expired or never arrived. */
  async resendInvitation(claims: AccessTokenClaims | undefined, reference: string) {
    const row = await this.rowOf(reference);

    if (row.status !== 'accepted' || !row.partner_reference) {
      throw badRequest(ERROR.PARTNER_APPLICATION_ALREADY_DECIDED);
    }

    if (!row.submitted_by_user_id) {
      throw badRequest(ERROR.PARTNER_APPLICATION_NO_ACCOUNT);
    }

    await this.audit.record({
      actorUserId: claims?.sub,
      actorRole: claims?.role,
      action: 'partner_application.invitation_resent',
      subjectType: 'partner_application',
      subjectId: row.id,
    });

    await this.sendInvitation(row.submitted_by_user_id, row, row.partner_reference);

    return this.detail(reference);
  }

  /**
   * Redeeming the invitation — the moment an account becomes a PARTNER account.
   *
   * Public: the recipient has no session yet. The token IS the authentication, which is why it is
   * 256 bits of randomness, single-use, and expires in three days. `redeem` consumes it with an
   * UPDATE whose WHERE clause carries `consumed_at IS NULL`, so two clicks on the same link
   * produce exactly one success rather than two different passwords.
   *
   * ## Three things happen here and nowhere else
   *
   * 1. The first password is set. Accepting an application never sets one, so until this call the
   *    account cannot be signed into — `AuthService.login` refuses a null hash.
   * 2. The ROLE changes to `partner`. This is the whole reason acceptance leaves the account
   *    alone: an application is a typed email address, and only somebody holding that mailbox can
   *    get here. Applying as `victim@example.com` therefore costs the victim nothing.
   * 3. Every existing session is revoked. If this was a customer account, the sessions it already
   *    had were issued to a customer; a role change that takes fifteen minutes to apply is not a
   *    role change.
   *
   * Two-factor enrolment is NOT done here. Partner 2FA is mandatory and `TwoFactorGuard` holds an
   * unenrolled partner at enrolment on their first sign-in — one gate, already built and already
   * tested, rather than a second one here that could disagree with it.
   */
  async acceptInvitation(token: string, password: string): Promise<void> {
    const redeemed = await this.authTokens.redeem(token, 'partner_invitation');

    /*
      Deliberately one code for every failure. Distinguishing "expired" from "already used" from
      "never existed" tells somebody probing invitation links which guesses were close.
    */
    if (!redeemed) throw badRequest(ERROR.PARTNER_INVITATION_INVALID);

    /*
      The account must still be one this invitation may convert, checked AGAIN at redemption.

      `accountOf` checked it when the application was accepted, and that check is now days
      old: an address that was a customer on Monday can be a staff account by Thursday. A token
      that outlived its premise redeems into nothing rather than demoting somebody.
    */
    const rows = await this.db.execute<{ role: string; partner_id: string | null }>(sql`
      SELECT u.role::text AS role,
             (SELECT p.id FROM partners p
              WHERE p.user_id = u.id AND p.deleted_at IS NULL LIMIT 1) AS partner_id
      FROM users u
      WHERE u.id = ${redeemed.userId}::uuid AND u.deleted_at IS NULL
    `);

    const account = rows.rows[0];
    const convertible = account?.role === 'customer' || account?.role === 'partner';

    if (!account || !convertible || !account.partner_id) {
      throw badRequest(ERROR.PARTNER_INVITATION_INVALID);
    }

    const hash = await this.passwords.hash(password);

    await this.db.execute(sql`
      UPDATE users
      SET password_hash = ${hash}, role = 'partner'::user_role,
          email_verified_at = now(), updated_at = now()
      WHERE id = ${redeemed.userId}::uuid
    `);

    await this.audit.record({
      actorUserId: redeemed.userId,
      actorRole: 'partner',
      action: 'partner.invitation_accepted',
      subjectType: 'partner',
      subjectId: account.partner_id,
      before: { role: account.role },
      after: { role: 'partner' },
    });

    await this.tokens.revokeAllForUser(redeemed.userId);

    this.logger.log(`Partner invitation accepted for partner ${account.partner_id}.`);
  }

  /**
   * The account behind a request, and whether it may become a partner at all.
   *
   * Keyed on the USER ID from the verified token — never on an address from a request body. That
   * is the whole reason this feature stopped needing to defend a stranger's account: there is no
   * step at which anybody names whose account is involved.
   *
   * Two refusals, and they are the point:
   *
   * - **A staff account.** Accepting would demote an operations manager to a partner, through a
   *   screen whose audit entry reads «قُبل الطلب».
   * - **An account that is already a partner.** There is nothing to create, and
   *   `partners_user_unique` would refuse it a moment later anyway with a stack trace.
   *
   * Called when a request is FILED and again when it is ACCEPTED. The second call is not
   * redundant: days pass in between, and an account that was an ordinary customer on Monday can
   * be staff by Thursday.
   */
  private async accountOf(userId: string): Promise<{ email: string; locale: string }> {
    const rows = await this.db.execute<{
      email: string;
      locale: string;
      role: string;
      is_partner: boolean;
    }>(sql`
      SELECT u.email, u.preferred_locale AS locale, u.role::text AS role,
             EXISTS (SELECT 1 FROM partners p
                     WHERE p.user_id = u.id AND p.deleted_at IS NULL) AS is_partner
      FROM users u
      WHERE u.id = ${userId}::uuid AND u.deleted_at IS NULL
      LIMIT 1
    `);

    const row = rows.rows[0];

    /* A token for an account that no longer exists. Refused, never assumed. */
    if (!row) throw notFound(ERROR.PARTNER_APPLICATION_NOT_FOUND);

    if (row.role !== 'customer' && row.role !== 'partner') {
      throw badRequest(ERROR.PARTNER_APPLICATION_EMAIL_IS_STAFF);
    }

    if (row.is_partner) throw badRequest(ERROR.PARTNER_APPLICATION_EMAIL_IS_PARTNER);

    return { email: row.email, locale: row.locale };
  }

  private async sendInvitation(
    userId: string,
    row: Pick<ApplicationRow, 'email' | 'preferred_locale'>,
    partnerReference: string,
  ): Promise<void> {
    const { token } = await this.authTokens.issue(
      userId,
      'partner_invitation',
      INVITATION_TTL_MS,
    );

    await this.mail.send(
      partnerInvitationMail({
        to: row.email,
        reference: partnerReference,
        url: new URL(`/invitation/${token}`, this.env.PARTNER_URL).toString(),
        locale: row.preferred_locale,
        expiresInHours: INVITATION_TTL_MS / 3_600_000,
      }),
    );
  }

  /** Built from the configured `APP_URL`, never from a request — the same rule as every other mail. */
  private joinUrl(locale: string): string {
    return new URL(`/${locale}/partners/join`, this.env.APP_URL).toString();
  }

  private async rowOf(reference: string): Promise<ApplicationRow> {
    if (!REFERENCE_PATTERN.test(reference)) {
      throw notFound(ERROR.PARTNER_APPLICATION_NOT_FOUND);
    }

    const rows = await this.db.execute<ApplicationRow>(sql`
      SELECT a.id, a.submitted_by_user_id, a.reference, a.status::text AS status,
             a.contact_name, a.email, a.phone,
             a.legal_name, a.display_name, pt.code AS partner_type, pt.name_ar AS partner_type_ar,
             c.slug AS city, c.name_ar AS city_ar, a.address, a.property_count, a.website,
             a.message, a.preferred_locale,
             a.contacted_at::text, cb.email AS contacted_by_email, a.contact_notes,
             a.decided_at::text, db.email AS decided_by_email, a.decision_notes,
             p.reference AS partner_reference, p.verification::text AS partner_verification,
             a.created_at::text
      FROM partner_applications a
      JOIN partner_types pt ON pt.id = a.partner_type_id
      JOIN cities c ON c.id = a.city_id
      LEFT JOIN users cb ON cb.id = a.contacted_by_user_id
      LEFT JOIN users db ON db.id = a.decided_by_user_id
      LEFT JOIN partners p ON p.id = a.partner_id
      WHERE a.reference = ${reference} AND a.deleted_at IS NULL
      LIMIT 1
    `);

    const row = rows.rows[0];

    if (!row) throw notFound(ERROR.PARTNER_APPLICATION_NOT_FOUND);

    return row;
  }

  private async countOf(fromWhere: SQL): Promise<number> {
    const result = await this.db.execute<{ n: string }>(
      sql`SELECT count(*)::text AS n FROM (SELECT 1 ${fromWhere} LIMIT ${COUNT_CAP + 1}) capped`,
    );

    return Number(result.rows[0]?.n ?? 0);
  }

  private viewOf(row: ApplicationRow) {
    return {
      reference: row.reference,
      status: row.status,
      contactName: row.contact_name,
      email: row.email,
      phone: row.phone,
      legalName: row.legal_name,
      displayName: row.display_name,
      partnerType: row.partner_type,
      partnerTypeAr: row.partner_type_ar,
      city: row.city,
      cityAr: row.city_ar,
      address: row.address,
      propertyCount: row.property_count,
      website: row.website,
      message: row.message,
      preferredLocale: row.preferred_locale,
      contactedAt: row.contacted_at,
      contactedByEmail: row.contacted_by_email,
      contactNotes: row.contact_notes,
      decidedAt: row.decided_at,
      decidedByEmail: row.decided_by_email,
      decisionNotes: row.decision_notes,
      partnerReference: row.partner_reference,
      partnerVerification: row.partner_verification,
      createdAt: row.created_at,
    };
  }

  private async lookupPartnerType(code: string): Promise<{ id: string }> {
    const rows = await this.db.execute<{ id: string }>(sql`
      SELECT id FROM partner_types WHERE code = ${code} AND is_active = true
    `);

    const row = rows.rows[0];

    if (!row) throw badRequest(ERROR.PARTNER_TYPE_UNKNOWN);

    return row;
  }

  private async lookupCity(slug: string): Promise<{ id: string }> {
    const rows = await this.db.execute<{ id: string }>(sql`
      SELECT id FROM cities WHERE slug = ${slug} AND is_active = true AND deleted_at IS NULL
    `);

    const row = rows.rows[0];

    if (!row) throw badRequest(ERROR.GEO_CITY_UNKNOWN);

    return row;
  }
}
