import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { ERROR, PERMISSIONS as P } from '@safra/contracts';
import { REDACTION_MARKERS } from '@safra/i18n';

import { AuditService } from '../common/audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { badRequest, notFound } from '../common/errors/app-error.js';
import { redactContactDetails } from '../messaging/redaction.js';
import { requirePartnerId } from '../rbac/ownership.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * The partner's side of a dispute — reading it, and answering it.
 *
 * ## Why this exists
 *
 * Bashar, 2026-09-08: *«I want SAFRA to function as an adjudicator that hears both sides while
 * still protecting customer privacy… I do not want SAFRA deciding disputes while only one side is
 * able to participate in the process.»*
 *
 * Before this, a guest complained, the partner's payable froze, SAFRA decided, and the partner was
 * told only when it was over. They could see a held amount on مستحقاتي and nothing else: no
 * notification when it opened, no view of the allegation, and nowhere to put their account of the
 * night. `dispute_evidence` was written by the customer or by staff; the partner could file
 * nothing.
 *
 * ## What the partner may see, and what they may not
 *
 * His list, and the reasoning for each line:
 *
 * - **reference, kind, status, opened date** — they are already told a dispute exists by the held
 *   amount; withholding its name and state only makes that useless.
 * - **title and description** — the customer's own account of THEIR property on THEIR night. It is
 *   the allegation, and without it there is nothing to answer. It carries no contact, payment or
 *   wallet data, and it is stored REDACTED, so a phone number the guest typed is already gone.
 * - **the affected booking and the frozen amount** — their money. The amount is withheld from an
 *   EMPLOYEE on `PAYOUT_READ_OWN`, exactly as the dashboard withholds earnings: the account of the
 *   night is the business's to give, the money is the owner's.
 * - **the resolution** — *«the final decision and the reasoning that can be shared with them»*.
 *
 * And deliberately NOT:
 *
 * - **the customer's evidence files** — *«If staff determine that a customer image or file is
 *   necessary for a fair resolution, then that should be an explicit staff decision and not the
 *   default behaviour.»* So a customer file appears only once `shared_with_partner` is set, which
 *   is an audited act. The partner is told HOW MANY items exist either way, because «there is
 *   evidence you have not seen» is itself a fact they need in order to ask for it.
 * - **the compensation amount** — a credit to the customer's wallet, not a charge to the partner.
 *   What is charged to them arrives as a fine or a recovery, both of which they already see.
 * - **customer contact details, payment or wallet information, internal staff notes** — none of it
 *   is selected here. `booking_internal_notes` is not joined at all, which is the only way to be
 *   sure of that.
 */
@Injectable()
export class PartnerDisputesService {
  private readonly logger = new Logger(PartnerDisputesService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /**
   * Every dispute against this partner, newest first.
   *
   * Paged? No — and that is a decision rather than an omission. A partner with more than a screenful
   * of disputes has a problem no pager solves, and the enforcement ladder suspends a partner long
   * before the list could grow unbounded. `LIMIT 100` is the bound, and if one is ever reached the
   * useful response is a phone call.
   */
  async list(claims: AccessTokenClaims | undefined) {
    const partnerId = requirePartnerId(claims, P.DISPUTE_RESPOND_OWN);
    const money = (claims?.permissions ?? []).includes(P.PAYOUT_READ_OWN);

    const rows = await this.db.execute<{
      reference: string;
      kind: string;
      status: string;
      title: string;
      created_at: string;
      closed_at: string | null;
      booking_reference: string;
      frozen_amount: string | null;
      currency_code: string | null;
      responses: number;
    }>(sql`
      SELECT d.reference,
             d.kind::text   AS kind,
             d.status::text AS status,
             d.title,
             d.created_at::text,
             d.closed_at::text,
             b.reference AS booking_reference,
             -- The held amount, and only for a reader whose permission covers money.
             CASE WHEN ${money} THEN b.partner_payable_amount::text END AS frozen_amount,
             CASE WHEN ${money} THEN c.code END AS currency_code,
             (SELECT count(*)::int FROM dispute_responses r WHERE r.dispute_id = d.id) AS responses
        FROM disputes d
        JOIN bookings b ON b.id = d.booking_id
        LEFT JOIN currencies c ON c.id = b.currency_id
       WHERE d.partner_id = ${partnerId}
         AND d.deleted_at IS NULL
       ORDER BY d.created_at DESC
       LIMIT 100
    `);

    return {
      disputes: rows.rows.map((row) => ({
        reference: row.reference,
        kind: row.kind,
        status: row.status,
        title: row.title,
        openedAt: row.created_at,
        closedAt: row.closed_at,
        bookingReference: row.booking_reference,
        frozenAmount: row.frozen_amount,
        currencyCode: row.currency_code,
        responseCount: row.responses,
      })),
    };
  }

  /**
   * One dispute, with the partner's own responses and whatever evidence they may see.
   *
   * `notFound` for a dispute belonging to another partner — «not yours» answers the same as «not
   * there», so the reference sequence cannot be walked one 404 at a time.
   */
  async detail(reference: string, claims: AccessTokenClaims | undefined) {
    const partnerId = requirePartnerId(claims, P.DISPUTE_RESPOND_OWN);
    const money = (claims?.permissions ?? []).includes(P.PAYOUT_READ_OWN);

    const found = await this.db.execute<{
      id: string;
      reference: string;
      kind: string;
      status: string;
      title: string;
      description: string | null;
      resolution: string | null;
      created_at: string;
      closed_at: string | null;
      booking_reference: string;
      check_in: string;
      check_out: string;
      unit_name: string | null;
      frozen_amount: string | null;
      currency_code: string | null;
    }>(sql`
      SELECT d.id::text, d.reference,
             d.kind::text   AS kind,
             d.status::text AS status,
             d.title, d.description, d.resolution,
             d.created_at::text, d.closed_at::text,
             b.reference AS booking_reference,
             b.check_in::text, b.check_out::text,
             coalesce(u.name_ar, u.name_en) AS unit_name,
             CASE WHEN ${money} THEN b.partner_payable_amount::text END AS frozen_amount,
             CASE WHEN ${money} THEN c.code END AS currency_code
        FROM disputes d
        JOIN bookings b ON b.id = d.booking_id
        LEFT JOIN currencies c ON c.id = b.currency_id
        LEFT JOIN booking_units bu ON bu.booking_id = b.id
        LEFT JOIN units u ON u.id = bu.unit_id
       WHERE d.reference = ${reference}
         AND d.partner_id = ${partnerId}
         AND d.deleted_at IS NULL
       LIMIT 1
    `);

    const dispute = found.rows[0];

    if (!dispute) throw notFound(ERROR.DISPUTE_NOT_FOUND);

    const responses = await this.db.execute<{
      body: string;
      created_at: string;
      author: string | null;
    }>(sql`
      SELECT r.body, r.created_at::text, u.email AS author
        FROM dispute_responses r
        LEFT JOIN users u ON u.id = r.submitted_by_user_id
       WHERE r.dispute_id = ${dispute.id}
       ORDER BY r.created_at
    `);

    /*
      Evidence, split by what this reader may actually open.

      `mine` is what the partner filed — they may always see their own. `shared` is a customer or
      staff file an operator has deliberately released to them. `withheldCount` is everything else,
      shown as a NUMBER and never as a list: «there are two items you have not seen» is a fact they
      need in order to ask, and a filename can carry as much as a photograph.
    */
    const evidence = await this.db.execute<{
      id: string;
      file_name: string;
      kind: string;
      created_at: string;
      mine: boolean;
      shared: boolean;
    }>(sql`
      SELECT e.id::text, e.file_name, e.kind, e.created_at::text,
             (u.role = 'partner') AS mine,
             e.shared_with_partner AS shared
        FROM dispute_evidence e
        LEFT JOIN users u ON u.id = e.uploaded_by_user_id
       WHERE e.dispute_id = ${dispute.id}
         AND e.deleted_at IS NULL
       ORDER BY e.created_at
    `);

    const visible = evidence.rows.filter((row) => row.mine || row.shared);

    return {
      reference: dispute.reference,
      kind: dispute.kind,
      status: dispute.status,
      title: dispute.title,
      description: dispute.description,
      resolution: dispute.resolution,
      openedAt: dispute.created_at,
      closedAt: dispute.closed_at,
      booking: {
        reference: dispute.booking_reference,
        checkIn: dispute.check_in,
        checkOut: dispute.check_out,
        unitName: dispute.unit_name,
      },
      frozenAmount: dispute.frozen_amount,
      currencyCode: dispute.currency_code,
      responses: responses.rows.map((row) => ({
        body: row.body,
        submittedAt: row.created_at,
      })),
      evidence: visible.map((row) => ({
        id: row.id,
        fileName: row.file_name,
        kind: row.kind,
        uploadedAt: row.created_at,
        mine: row.mine,
      })),
      withheldEvidenceCount: evidence.rows.length - visible.length,
    };
  }

  /**
   * The partner's account of what happened, added to the case file.
   *
   * ## A closed dispute takes no responses
   *
   * The same rule `dispute_evidence` follows: *«a closed dispute takes no removals, for the same
   * reason it takes no additions — the resolution must stay readable against what was in front of
   * the person who wrote it.»* A partner who disagrees with a decision has support, not a text box
   * that silently edits the record the decision was made against.
   *
   * ## Stored REDACTED
   *
   * `redactContactDetails` before the insert, exactly as every message body is: a partner pasting
   * the guest's number into their account of the night must not create a copy of it. The original
   * is not kept anywhere.
   */
  async respond(reference: string, body: string, claims: AccessTokenClaims | undefined) {
    const partnerId = requirePartnerId(claims, P.DISPUTE_RESPOND_OWN);

    const found = await this.db.execute<{ id: string; status: string }>(sql`
      SELECT id::text, status::text AS status
        FROM disputes
       WHERE reference = ${reference}
         AND partner_id = ${partnerId}
         AND deleted_at IS NULL
       LIMIT 1
    `);

    const dispute = found.rows[0];

    if (!dispute) throw notFound(ERROR.DISPUTE_NOT_FOUND);
    if (dispute.status === 'resolved' || dispute.status === 'rejected') {
      throw badRequest(ERROR.DISPUTE_ALREADY_CLOSED);
    }

    const redacted = redactContactDetails(body);

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO dispute_responses (dispute_id, body, submitted_by_user_id)
        VALUES (${dispute.id}::uuid, ${redacted.body}, ${claims?.sub ?? null}::uuid)
      `);

      /*
        Audited on the DISPUTE, so the case file and the audit trail answer the same question.

        The body is NOT copied into the audit payload: it is already stored, append-only, one row
        away — and duplicating a redacted account of somebody's night into a log that a different
        set of people read is a second copy nobody asked for. The count of removed spans travels
        instead, because «this response had a contact detail taken out of it» is worth knowing.
      */
      await this.audit.record(
        {
          actorUserId: claims?.sub,
          actorRole: claims?.role,
          action: 'dispute.partner_responded',
          subjectType: 'dispute',
          subjectId: dispute.id,
          after: { reference, redactedCount: redacted.redactedCount },
        },
        tx as unknown as Database,
      );
    });

    this.logger.log(
      `Partner ${partnerId} responded to ${reference} ` +
        `(${redacted.redactedCount} contact detail(s) removed).`,
    );

    return { reference, redactedCount: redacted.redactedCount };
  }

  /** Whether a stored body still carries a redaction marker — used by the tests, not by a screen. */
  static hasRedaction(body: string): boolean {
    return REDACTION_MARKERS.some((marker: string) => body.includes(marker));
  }
}
