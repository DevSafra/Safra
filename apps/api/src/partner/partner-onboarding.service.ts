import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import {
  ERROR,
  type PartnerOnboardInput,
  type PartnerOnboardResult,
} from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { badRequest, conflict, notFound } from '../common/errors/app-error.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { PartnerInvitationService } from './partner-invitation.service.js';

/**
 * The account this onboarding will attach a partner to — found, or still to be created.
 *
 * A DISCRIMINATED union rather than `{ userId, existed }`, because in the second case there is no
 * id yet and the honest way to say so is not to have the field. It was an empty string, and an
 * empty-string sentinel for "no id" is one reordering away from being written into `partners.user_id`
 * as a cast that fails at the database — or worse, not failing.
 *
 * `existed` is carried all the way out to the console rather than inferred there, because the two
 * cases need different words said out loud to the person in the room — see `PartnerOnboardResult`.
 */
type TargetAccount =
  { readonly existed: true; readonly userId: string } | { readonly existed: false };

/**
 * تسجيل شريك جديد — a super admin onboarding a partner they are sitting with
 * (Bashar, 2026-08-23).
 *
 * ## The case this serves
 *
 * The super admin and the partner are in the same room and have already had the conversation that
 * «انضم كشريك» spreads over a week. The documents are on the table, the contract is about to be
 * signed on paper by both of them, and there is no reason for the platform to learn any of it via
 * an inbox. This writes the record and the account in one call so the remaining steps — documents,
 * contract, screening, approval — can all be done before anybody stands up.
 *
 * ## Why it is not `PartnerApplicationService.accept` with a flag
 *
 * Because of what the two actions TRUST. Accepting a request acts on an account that proved it
 * holds its mailbox by signing in and filing the request; the reviewer never names it, and the
 * schema for accepting deliberately has no field in which they could. This acts on an address a
 * super admin typed.
 *
 * That is a real difference in power and it has to be visible. It gets its own permission
 * (`PARTNER_ONBOARD`, super admin only), its own audit action (`partner.onboarded_in_person`), and
 * its own timeline event — so "how did this partner get here" can never come back with an answer
 * that fits both paths.
 *
 * ## What stops it being a way in
 *
 * Three things, and they are the whole security argument for the feature:
 *
 * 1. **No password is set, by anybody.** The account is created exactly as `staff.invited` leaves
 *    one — `password_hash` null — and `AuthService.login` refuses a null hash. The super admin has
 *    no way to express a password here and no way to read one.
 * 2. **The role does not change.** An adopted customer account stays `customer` until the
 *    invitation is redeemed FROM THE MAILBOX. `token.service.ts` only attaches `partnerId` to a
 *    token whose user is already `partner`, and permissions come from the role — so the
 *    `partners` row this writes grants the named account nothing at all in the meantime.
 * 3. **The same two accounts are refused as by «انضم كشريك»**: a staff account, and one that is
 *    already a partner. Onboarding must not be a route to demoting a colleague by mistyping their
 *    address.
 *
 * What a super admin CAN do with this is create a partner record bound to a stranger's account,
 * which would occupy `partners_user_unique` and put a name in the registry. That is a super admin
 * misusing a super-admin power in a fully audited way, and it is the same exposure every other
 * action on their console carries. It is not an escalation: nothing about it gets anybody a
 * session.
 *
 * ## No application row is written
 *
 * Deliberately (Bashar, 2026-08-23). Nobody filed a request, so «طلبات الشراكة» stays a true
 * record of requests people actually made. The origin lives where origins belong — one audit
 * entry and one timeline event, both naming the super admin and carrying their note.
 */
@Injectable()
export class PartnerOnboardingService {
  private readonly logger = new Logger(PartnerOnboardingService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly invitations: PartnerInvitationService,
  ) {}

  async onboard(
    claims: AccessTokenClaims | undefined,
    input: PartnerOnboardInput,
  ): Promise<PartnerOnboardResult> {
    /*
      Resolved BEFORE anything is written, and both by CODE rather than by id.

      A caller who could send a `partner_type_id` could send any uuid in the table; a code is
      matched against the active rows and nothing else. `citySlug` is the same argument, and it is
      also what makes the console's select honest — it offers what the catalogue offers.
    */
    const [partnerType, city] = await Promise.all([
      this.lookupPartnerType(input.partnerTypeCode),
      this.lookupCity(input.citySlug),
    ]);

    /*
      An open «انضم كشريك» request from this address is refused rather than absorbed.

      Onboarding around it would leave a request nobody will ever answer sitting in the queue
      against a partner who already exists — and the reviewer working that queue would telephone
      somebody who was onboarded a week ago. Accepting the request is the correct action there, and
      it is one screen away.
    */
    const open = await this.db.execute<{ reference: string }>(sql`
      SELECT reference FROM partner_applications
      WHERE lower(email) = lower(${input.email})
        AND status IN ('submitted', 'contacted')
        AND deleted_at IS NULL
      LIMIT 1
    `);

    if (open.rows[0]) throw conflict(ERROR.PARTNER_ONBOARDING_APPLICATION_OPEN);

    const account = await this.resolveAccount(input);

    /*
      One transaction: the account, the partner, and the timeline entry.

      A partner row without its account, or an account left behind by a partner insert that failed
      the unique index, would both be wreckage somebody has to clean up by hand before the address
      can be onboarded again — during a meeting, with the partner watching.
    */
    const created = await this.db.transaction(async (tx) => {
      const userId = account.existed
        ? account.userId
        : await this.createAccount(tx as unknown as Database, input);

      /*
        `verification` is left to its column default of `pending`.

        Written here it would be one more place a partner could arrive approved without a reviewer,
        and the default is what P-002 actually depends on. Approval is a separate call, behind a
        separate permission, from a screen that shows the documents.
      */
      const partnerRows = await tx.execute<{ id: string; reference: string }>(sql`
        INSERT INTO partners
          (user_id, partner_type_id, legal_name, display_name, city_id, address, phone, email)
        VALUES (${userId}::uuid, ${partnerType.id}::uuid, ${input.legalName},
                ${input.displayName}, ${city.id}::uuid, ${input.address}, ${input.phone},
                ${input.email})
        RETURNING id, reference
      `);

      const partner = partnerRows.rows[0];

      if (!partner) throw new Error('Partner record was not created.');

      await tx.execute(sql`
        INSERT INTO timeline_events (subject_type, subject_id, event_type, actor_type,
                                     actor_user_id, payload)
        VALUES ('partner', ${partner.id}, 'partner.onboarded_in_person', 'staff',
                ${claims?.sub ?? null},
                ${JSON.stringify({ notes: input.notes, accountExisted: account.existed })}::jsonb)
      `);

      return { userId, id: partner.id, reference: partner.reference };
    });

    await this.audit.record({
      actorUserId: claims?.sub,
      actorRole: claims?.role,
      action: 'partner.onboarded_in_person',
      subjectType: 'partner',
      subjectId: created.id,
      /*
        The business and the shape of the action — never the contact's name, phone or address.

        Those are on the partner record, which is behind `PARTNER_READ`; a second copy in a table
        staff can EXPORT is a PII duplicate nobody asked for. `email` is the exception and it earns
        its place: which mailbox a super admin attached a partner to is the single fact this entry
        exists to be able to answer.
      */
      after: {
        reference: created.reference,
        legalName: input.legalName,
        email: input.email,
        city: input.citySlug,
        accountExisted: account.existed,
      },
      reason: input.notes,
    });

    /*
      The invitation goes out AFTER the transaction commits, and its failure cannot fail the call.

      Inside the transaction, a rollback would leave somebody holding a live link to an account
      that does not exist. And a partner standing at the desk must not be told their registration
      failed because an SMTP server was down — the record is correct, the remaining steps are all
      available, and the link is re-sendable.
    */
    await this.invitations
      .send({
        userId: created.userId,
        to: input.email,
        partnerReference: created.reference,
        locale: input.preferredLocale,
      })
      .catch((error: unknown) => {
        this.logger.error(
          `Partner ${created.reference} was onboarded but the invitation did not send: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      });

    this.logger.log(
      `Partner ${created.reference} onboarded in person by ${claims?.sub ?? 'unknown'}.`,
    );

    return { reference: created.reference, accountExisted: account.existed };
  }

  /**
   * Sends the invitation again, for a partner onboarded in person (Bashar, 2026-08-23).
   *
   * ## Why this exists at all — it was an asserted capability that did not exist
   *
   * `O-partner-10` said the invitation "is re-sendable from the screen". It was not.
   * `PartnerApplicationService.resendInvitation` is keyed on an APPLICATION reference and refuses
   * anything without one, and an onboarded partner deliberately has no application row — so the
   * one flow that most needs a second link was the one flow that could not get one.
   *
   * It surfaced the way these things do: a partner was onboarded, approved, and could not sign in,
   * and the operator had no remedy on the screen that had just told them the job was finished.
   *
   * ## It refuses an account that has already taken possession
   *
   * Once the role is `partner` the invitation has been redeemed and the account has a password its
   * owner chose. Issuing another link would supersede nothing useful and would mail a live
   * credential to an address for an account that is already in use — so it is a conflict, not a
   * no-op. Losing a password is what password RESET is for.
   */
  async resendInvitation(
    claims: AccessTokenClaims | undefined,
    reference: string,
  ): Promise<{ reference: string }> {
    const rows = await this.db.execute<{
      user_id: string;
      email: string;
      locale: string;
      role: string;
    }>(sql`
      SELECT p.user_id, p.email, u.preferred_locale AS locale, u.role::text AS role
      FROM partners p
      JOIN users u ON u.id = p.user_id
      WHERE p.reference = ${reference}
        AND p.deleted_at IS NULL AND u.deleted_at IS NULL
      LIMIT 1
    `);

    const row = rows.rows[0];

    if (!row) throw notFound(ERROR.PARTNER_NOT_FOUND);

    if (row.role === 'partner') {
      throw conflict(ERROR.PARTNER_ONBOARDING_ALREADY_ACTIVATED);
    }

    /*
      The address on the PARTNER record, which is the one the operator typed and read back to the
      person in the room. `users.email` can since have moved; where SAFRA wrote about this
      partnership is the fact worth repeating.
    */
    await this.invitations.send({
      userId: row.user_id,
      to: row.email,
      partnerReference: reference,
      locale: row.locale,
    });

    await this.audit.record({
      actorUserId: claims?.sub,
      actorRole: claims?.role,
      action: 'partner.invitation_resent',
      subjectType: 'partner',
      subjectId: row.user_id,
      after: { reference, email: row.email },
    });

    this.logger.log(`Partner invitation for ${reference} re-sent.`);

    return { reference };
  }

  /**
   * The account this partner will hang off — found, or about to be made.
   *
   * The two refusals are the ones «انضم كشريك» makes at acceptance, and they are checked here
   * against the ADDRESS rather than a session, because that is the whole difference between the
   * two flows. `accept` can trust `submitted_by_user_id`; this can only trust what it reads.
   *
   * Not a transaction, and it does not need to be: `users_email_unique` and `partners_user_unique`
   * are the actual guarantees. Two operators onboarding the same address in the same second both
   * pass this check and exactly one insert survives — which is why the insert is where the refusal
   * has to be enforceable, and this is only where the MESSAGE comes from.
   */
  private async resolveAccount(input: PartnerOnboardInput): Promise<TargetAccount> {
    const rows = await this.db.execute<{
      id: string;
      role: string;
      is_partner: boolean;
    }>(sql`
      SELECT u.id, u.role::text AS role,
             EXISTS (SELECT 1 FROM partners p
                     WHERE p.user_id = u.id AND p.deleted_at IS NULL) AS is_partner
      FROM users u
      WHERE lower(u.email) = lower(${input.email}) AND u.deleted_at IS NULL
      LIMIT 1
    `);

    const row = rows.rows[0];

    /* No account at all — the ordinary in-person case. One is created inside the transaction. */
    if (!row) return { existed: false };

    if (row.role !== 'customer' && row.role !== 'partner') {
      throw badRequest(ERROR.PARTNER_ONBOARDING_EMAIL_IS_STAFF);
    }

    if (row.is_partner) throw badRequest(ERROR.PARTNER_ONBOARDING_EMAIL_IS_PARTNER);

    return { existed: true, userId: row.id };
  }

  /**
   * A new account, with no way to sign into it.
   *
   * `password_hash` is left null — the same state `staff.invited` leaves an account in — and
   * `email_verified_at` is left null too, because nobody has proved they hold this mailbox yet.
   * Redeeming the invitation sets both, and that ordering is what makes the address a claim until
   * somebody answers it.
   *
   * The role is `customer`, not `partner`. `acceptInvitation` requires a convertible role and
   * flips it on redemption; creating the account as `partner` outright would hand partner
   * permissions to whoever holds that mailbox the moment they set a password by any other route.
   */
  private async createAccount(tx: Database, input: PartnerOnboardInput): Promise<string> {
    const rows = await tx.execute<{ id: string }>(sql`
      INSERT INTO users (email, role, status, preferred_locale)
      VALUES (${input.email}, 'customer'::user_role, 'active', ${input.preferredLocale})
      RETURNING id
    `);

    const row = rows.rows[0];

    if (!row) throw new Error('Partner account was not created.');

    return row.id;
  }

  /** Active types only. An inactive kind is not on offer, so naming one is not a valid request. */
  private async lookupPartnerType(code: string): Promise<{ id: string }> {
    const rows = await this.db.execute<{ id: string }>(sql`
      SELECT id FROM partner_types WHERE code = ${code} AND is_active = true
        AND deleted_at IS NULL LIMIT 1
    `);

    const row = rows.rows[0];

    if (!row) throw badRequest(ERROR.PARTNER_TYPE_UNKNOWN);

    return row;
  }

  private async lookupCity(slug: string): Promise<{ id: string }> {
    const rows = await this.db.execute<{ id: string }>(sql`
      SELECT id FROM cities WHERE slug = ${slug} AND is_active = true
        AND deleted_at IS NULL LIMIT 1
    `);

    const row = rows.rows[0];

    if (!row) throw badRequest(ERROR.GEO_CITY_UNKNOWN);

    return row;
  }
}
