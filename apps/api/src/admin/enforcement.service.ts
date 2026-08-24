import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import {
  COUNT_CAP,
  ERROR,
  type FineWaiveInput,
  type PartnerSuspendInput,
  type ViolationFineInput,
  type ViolationRaiseInput,
  type OffsetPage,
  offsetPage,
  type ViolationWarnInput,
} from '@safra/contracts';

import { actorName } from '../common/actor-name.sql.js';
import { AuditService } from '../common/audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { FxRateService } from '../fx/fx-rate.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { ENV, type Env } from '../config/env.js';
import { MailService } from '../mail/mail.service.js';
import { badRequest, notFound } from '../common/errors/app-error.js';
import { partnerFineWaivedMail, partnerSuspendedMail } from '../mail/mail.templates.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * Enforcement against a partner: suspension, violations, and forgiving a fine.
 *
 * Bashar's policy of 2026-08-24, and the sentence that governs all three:
 *
 * > *"Never solve enforcement actions by deleting history. Use audit entries, ledger entries, state
 * > transitions, notifications, and append-only records. The system must always be able to answer
 * > what happened, who did it, when, why, and what financial impact occurred."*
 *
 * ## Nothing here is destructive, and that is a design constraint rather than a preference
 *
 * Unsuspending does not erase the suspension — it clears the live state and writes a second audit
 * row. Waiving does not edit the fine — it posts an opposite ledger entry. A violation's stage only
 * moves forward. Every one of those was the more expensive option and each was chosen for the same
 * reason: an enforcement record that can be tidied up is worthless in the argument it exists for.
 *
 * ## What suspension does NOT do
 *
 * It does not cancel a booking, disturb a guest, or lock the partner out. Those absences are the
 * policy, not an omission — see `SuspensionGuard` and `partnerSuspendSchema`. A suspended partner
 * signs in, reads why, and watches their own confirmed bookings proceed.
 */
@Injectable()
export class EnforcementService {
  private readonly logger = new Logger(EnforcementService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
    private readonly fx: FxRateService,
    private readonly mail: MailService,
  ) {}

  /**
   * Suspends a partner, and tells them why.
   *
   * The reason is REQUIRED by the schema and is the text the partner reads. `notes` never leaves
   * the console — it is the one field in this record with a different audience, and a field with
   * two audiences and one shape is how the `actor_name` leak happened this morning.
   *
   * ## `violationId` links the suspension to the violation that caused it
   *
   * Optional, and it is the only writer of `stage = 'suspension'` — see `escalate`. It stays on
   * THIS endpoint rather than becoming a `violations/:id/escalate` route of its own, because
   * `suspended_at` must have exactly one writer: two routes reaching one piece of state is how the
   * two diverge, and the second one is always the one that forgets the mail or the audit row.
   */
  async suspend(
    actor: AccessTokenClaims | undefined,
    reference: string,
    input: PartnerSuspendInput,
  ): Promise<void> {
    const partner = await this.livePartner(reference);

    if (partner.suspended_at !== null) throw badRequest(ERROR.PARTNER_ALREADY_SUSPENDED);

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE partners
        SET suspended_at = now(), suspended_reason = ${input.reason},
            suspended_notes = ${input.notes ?? null},
            suspended_by_user_id = ${actor?.sub}::uuid, updated_at = now()
        WHERE id = ${partner.id}::uuid
      `);

      await this.audit.record(
        {
          actorUserId: actor?.sub,
          actorRole: actor?.role,
          action: 'partner.suspended',
          subjectType: 'partner',
          subjectId: partner.id,
          before: { suspended: false },
          after: { suspended: true, notes: input.notes ?? null },
          reason: input.reason,
        },
        tx as unknown as Database,
      );

      if (input.violationId !== undefined) {
        await this.escalate(tx as unknown as Database, actor, partner.id, input);
      }
    });

    /*
      Told, and outside the transaction. Mail is I/O to somebody else's system: inside, it would
      hold a row lock for an SMTP round trip, and a delivery failure would roll back a suspension
      that had already been decided. A partner still trading because a mail server was slow is the
      wrong direction for this particular failure — the same reasoning as the staff suspension
      notice, and the same swallow-and-log on the way out.
    */
    await this.mail
      .send(
        partnerSuspendedMail({
          to: partner.email,
          locale: partner.preferred_locale,
          reason: input.reason,
          url: `${this.env.PARTNER_URL}/`,
        }),
      )
      .catch((error: unknown) => {
        this.logger.error(
          `Could not send the suspension notice for partner ${partner.id}.`,
          error instanceof Error ? error.stack : undefined,
        );
      });

    this.logger.log(`Partner ${reference} suspended by ${actor?.sub}.`);
  }

  /**
   * Lifts a suspension.
   *
   * The columns are cleared and NOTHING is deleted: `partner.suspended` and `partner.unsuspended`
   * both sit in the audit log with their reasons, so "was this partner ever suspended, and why"
   * survives the lifting. The live columns answer "is it in force now", which is a different
   * question and the only one the running system needs.
   */
  async unsuspend(
    actor: AccessTokenClaims | undefined,
    reference: string,
    input: PartnerSuspendInput,
  ): Promise<void> {
    const partner = await this.livePartner(reference);

    if (partner.suspended_at === null) throw badRequest(ERROR.PARTNER_NOT_SUSPENDED);

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE partners
        SET suspended_at = NULL, suspended_reason = NULL, suspended_notes = NULL,
            suspended_by_user_id = NULL, updated_at = now()
        WHERE id = ${partner.id}::uuid
      `);

      await this.audit.record(
        {
          actorUserId: actor?.sub,
          actorRole: actor?.role,
          action: 'partner.unsuspended',
          subjectType: 'partner',
          subjectId: partner.id,
          before: { suspended: true, reason: partner.suspended_reason },
          after: { suspended: false, notes: input.notes ?? null },
          reason: input.reason,
        },
        tx as unknown as Database,
      );
    });

    this.logger.log(`Partner ${reference} unsuspended by ${actor?.sub}.`);
  }

  /** Records a violation at stage `recorded` — nobody has been told anything yet. */
  async raise(
    actor: AccessTokenClaims | undefined,
    reference: string,
    input: ViolationRaiseInput,
  ): Promise<{ id: string }> {
    const partner = await this.livePartner(reference);

    const priors = await this.db.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n FROM partner_violations
      WHERE partner_id = ${partner.id}::uuid AND kind = ${input.kind}::violation_kind
        AND deleted_at IS NULL
    `);

    const rows = await this.db.transaction(async (tx) => {
      const made = await tx.execute<{ id: string }>(sql`
        INSERT INTO partner_violations (partner_id, kind, occurrence_number, stage, description)
        VALUES (${partner.id}::uuid, ${input.kind}::violation_kind,
                ${Number(priors.rows[0]?.n ?? 0) + 1}, 'recorded', ${input.reason})
        RETURNING id
      `);

      await this.audit.record(
        {
          actorUserId: actor?.sub,
          actorRole: actor?.role,
          action: 'violation.recorded',
          subjectType: 'partner',
          subjectId: partner.id,
          after: { kind: input.kind, stage: 'recorded' },
          reason: input.reason,
        },
        tx as unknown as Database,
      );

      return made.rows[0];
    });

    /*
      No ranking effect, and this is the load-bearing absence in the whole file (Bashar,
      2026-08-24): *"creating a violation must not automatically modify ranking."* There is
      deliberately no `partners.score` write here, and `violation-ranking.integration.test.ts`
      fails if one appears anywhere in the API.
    */
    this.logger.log(`Violation ${input.kind} recorded against ${reference}.`);

    return { id: rows?.id ?? '' };
  }

  /**
   * `recorded → warned`. The first step the partner hears about, which is why it is its own step.
   *
   * The reasons on this ladder are STORED as well as audited, since 2026-08-24. They were audited
   * only, and `audit_log.subject_id` is the PARTNER rather than the violation — so the words an
   * operator wrote for a partner to read were not reachable from the violation they described, on
   * any screen, by anyone.
   */
  async warn(
    actor: AccessTokenClaims | undefined,
    violationId: string,
    input: ViolationWarnInput,
  ): Promise<void> {
    const violation = await this.liveViolation(violationId);

    if (violation.stage !== 'recorded') throw badRequest(ERROR.VIOLATION_STAGE_INVALID);

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE partner_violations
        SET stage = 'warned', warned_at = now(), warning_note = ${input.note},
            updated_at = now()
        WHERE id = ${violationId}::uuid
      `);

      await this.audit.record(
        {
          actorUserId: actor?.sub,
          actorRole: actor?.role,
          action: 'violation.warned',
          subjectType: 'partner',
          subjectId: violation.partner_id,
          before: { stage: violation.stage },
          after: { stage: 'warned' },
          reason: input.note,
        },
        tx as unknown as Database,
      );
    });
  }

  /**
   * `warned → fined`, or `recorded → fined`. The fine is optional in the progression, so it is a
   * step somebody takes rather than a field somebody fills.
   */
  async fine(
    actor: AccessTokenClaims | undefined,
    violationId: string,
    input: ViolationFineInput,
  ): Promise<void> {
    const violation = await this.liveViolation(violationId);

    if (violation.stage === 'fined' || violation.waived_at !== null) {
      throw badRequest(ERROR.VIOLATION_STAGE_INVALID);
    }

    const currency = await this.db.execute<{ id: string }>(sql`
      SELECT id FROM currencies WHERE code = ${input.currencyCode.toUpperCase()} LIMIT 1
    `);

    if (!currency.rows[0]) throw badRequest(ERROR.VALIDATION_REQUIRED);

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE partner_violations
        SET stage = 'fined', fine_amount = ${input.amount},
            fine_currency_id = ${currency.rows[0]?.id}::uuid,
            customer_compensation_amount = ${input.customerCompensation ?? null},
            fine_reason = ${input.reason},
            updated_at = now()
        WHERE id = ${violationId}::uuid
      `);

      await this.audit.record(
        {
          actorUserId: actor?.sub,
          actorRole: actor?.role,
          action: 'violation.fined',
          subjectType: 'partner',
          subjectId: violation.partner_id,
          before: { stage: violation.stage },
          after: { stage: 'fined', amount: input.amount, currency: input.currencyCode },
          reason: input.reason,
        },
        tx as unknown as Database,
      );
    });
  }

  /**
   * Forgives a fine — by ADDING an opposite ledger entry, never by editing the original.
   *
   * > Bashar, 2026-08-24: *"A waived fine must never delete or rewrite history. The original fine
   * > entry must remain permanently visible. Fine −50, Waiver +50. The net effect becomes zero, but
   * > history remains complete."*
   *
   * So: `fine_amount` is untouched, `stage` STAYS `fined`, and what changes is that `waived_at`,
   * `waived_reason` and `waiver_ledger_group_id` become set. Winding the stage back to `warned`
   * would make "was this partner ever fined" unanswerable, which is the question an appeal turns
   * on — and it is the same deletion the rule forbids, wearing a state machine's clothes.
   *
   * The amount comes from the STORED fine, never from the caller: `fineWaiveSchema` takes none, so
   * the two entries cannot disagree. Reconciling a ledger where a pair that was meant to cancel
   * does not is the worst hour anybody spends.
   */
  async waive(
    actor: AccessTokenClaims | undefined,
    violationId: string,
    input: FineWaiveInput,
  ): Promise<void> {
    const violation = await this.liveViolation(violationId);

    if (violation.fine_amount === null || violation.fine_currency_id === null) {
      throw badRequest(ERROR.VIOLATION_NOT_FINED);
    }

    if (violation.waived_at !== null) throw badRequest(ERROR.VIOLATION_ALREADY_WAIVED);

    const partner = await this.db.execute<{
      email: string;
      preferred_locale: string;
      code: string;
    }>(sql`
      SELECT p.email, u.preferred_locale, c.code
      FROM partners p
      JOIN users u ON u.id = p.user_id
      JOIN currencies c ON c.id = ${violation.fine_currency_id}::uuid
      WHERE p.id = ${violation.partner_id}::uuid
      LIMIT 1
    `);

    const found = partner.rows[0];

    if (!found) throw notFound(ERROR.PARTNER_NOT_FOUND);

    const fxRateToSyp = await this.fx.rateToSyp(found.code);

    await this.db.transaction(async (tx) => {
      const { entryGroupId } = await this.ledger.postFineWaiver(
        tx as unknown as Database,
        {
          ...(violation.booking_id ? { bookingId: violation.booking_id } : {}),
          partnerId: violation.partner_id,
          currencyId: violation.fine_currency_id ?? '',
          fxRateToSyp,
          amount: violation.fine_amount ?? '0',
          reference: violationId,
        },
      );

      await tx.execute(sql`
        UPDATE partner_violations
        SET waived_at = now(), waived_by_user_id = ${actor?.sub}::uuid,
            waived_reason = ${input.reason},
            waiver_ledger_group_id = ${entryGroupId}::uuid,
            updated_at = now()
        WHERE id = ${violationId}::uuid
      `);

      await this.audit.record(
        {
          actorUserId: actor?.sub,
          actorRole: actor?.role,
          action: 'fine.waived',
          subjectType: 'partner',
          subjectId: violation.partner_id,
          before: { fineAmount: violation.fine_amount, waived: false },
          after: { waived: true, ledgerGroupId: entryGroupId },
          reason: input.reason,
        },
        tx as unknown as Database,
      );
    });

    /*
      *"The affected partner must be notified that the fine was waived."* Outside the transaction
      and swallowed on failure, for the reason every notice in this codebase is: the decision is
      made and correct, and a mail server being slow must not roll it back.
    */
    await this.mail
      .send(
        partnerFineWaivedMail({
          to: found.email,
          locale: found.preferred_locale,
          amount: `${violation.fine_amount ?? ''} ${found.code}`,
          reason: input.reason,
          url: `${this.env.PARTNER_URL}/violations`,
        }),
      )
      .catch((error: unknown) => {
        this.logger.error(
          `Could not send the waiver notice for violation ${violationId}.`,
          error instanceof Error ? error.stack : undefined,
        );
      });

    this.logger.log(`Fine on violation ${violationId} waived by ${actor?.sub}.`);
  }

  /**
   * One partner's violations, newest first, PAGED.
   *
   * Its own list rather than an array on the partner record: a partner with forty violations is an
   * ordinary partner after two years, and an unpaginated list on a screen is what the standing
   * instruction forbids. The record links here.
   *
   * The waiver travels as an OBJECT rather than as loose columns, because the console must render
   * the pair — the fine and its reversal, netting to zero — and a shape that scatters `waivedAt`,
   * `waivedReason` and the amount across the row invites a screen to show one and not the others.
   */
  async list(
    reference: string,
    query: { limit: number; page: number },
  ): Promise<OffsetPage<unknown>> {
    const partner = await this.livePartner(reference);

    const fromWhere = sql`
      FROM partner_violations v
      LEFT JOIN currencies c ON c.id = v.fine_currency_id
      LEFT JOIN bookings b ON b.id = v.booking_id
      LEFT JOIN users w ON w.id = v.waived_by_user_id
      WHERE v.partner_id = ${partner.id}::uuid AND v.deleted_at IS NULL`;

    const [rows, total] = await Promise.all([
      this.db.execute<Record<string, unknown>>(sql`
        SELECT v.id, v.kind::text AS kind, v.stage::text AS stage, v.occurrence_number,
               b.reference AS booking_reference,
               v.warned_at::text, v.warning_note,
               -- The operator's own words, which no screen could show until 2026-08-24.
               v.description, v.fine_reason,
               v.fine_amount::text, c.code AS fine_currency,
               v.customer_compensation_amount::text,
               v.waived_at::text, v.waived_reason, v.waiver_ledger_group_id::text,
               ${actorName(sql`w.email`, sql`w.role`)} AS waived_by,
               v.collected_at::text,
               to_char(v.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS created_at
        ${fromWhere}
        ORDER BY v.created_at DESC, v.id DESC
        LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}
      `),
      /*
        `COUNT_CAP`, not `10000`. The literal was the same shape as the `'super_admin'` copy in
        `actorName` and the twenty-character floor in the console's forms: a number that gets tuned,
        written in a second place that then does not get tuned. Found by project-e9.
      */
      this.db.execute<{ n: string }>(sql`
        SELECT count(*)::text AS n
        FROM (SELECT 1 ${fromWhere} LIMIT ${COUNT_CAP + 1}) capped
      `),
    ]);

    /*
      `offsetPage`, not a hand-built envelope — and dropping `capped` was a real defect rather than a
      missing field (project-e9, 2026-08-24).

      Every other paged endpoint returns `OffsetPage`, and the console's schema REQUIRES `capped`.
      Without it the parse failed, `staffFetch` answered `'failed'`, and the screen said «تعذّر
      تحميل هذه القائمة» while the API returned 200 — the whole list unreachable for a missing
      boolean.

      The parse failing is the rule working. `capped` is how the pagination bar knows the total is a
      CEILING; without it, past ten thousand violations the bar would print «١٠٠٠٠ نتيجة» as an
      exact figure, which the standing instruction forbids in those words. Three fields hand-
      maintained beside a helper that derives them is how the fourth one goes missing.
    */
    return offsetPage(
      rows.rows.map((row) => ({
        id: row['id'],
        kind: row['kind'],
        stage: row['stage'],
        occurrenceNumber: row['occurrence_number'],
        bookingReference: row['booking_reference'],
        warnedAt: row['warned_at'],
        warningNote: row['warning_note'],
        fineAmount: row['fine_amount'],
        fineCurrency: row['fine_currency'],
        customerCompensationAmount: row['customer_compensation_amount'],
        /*
          The waiver as one object, present or absent. A screen cannot render half of it by
          accident, and «أُلغيت» with no reason beside it is worse for the partner than no mark.
        */
        waiver: row['waived_at']
          ? {
              at: row['waived_at'],
              reason: row['waived_reason'],
              by: row['waived_by'],
              ledgerGroupId: row['waiver_ledger_group_id'],
              /* The balancing entry is the same magnitude by construction — see `postFineWaiver`. */
              amount: row['fine_amount'],
              currency: row['fine_currency'],
            }
          : null,
        collectedAt: row['collected_at'],
        createdAt: row['created_at'],
      })),
      Number(total.rows[0]?.n ?? 0),
      query,
    );
  }

  private async livePartner(reference: string) {
    const rows = await this.db.execute<{
      id: string;
      email: string;
      preferred_locale: string;
      suspended_at: string | null;
      suspended_reason: string | null;
    }>(sql`
      SELECT p.id, p.email, u.preferred_locale,
             p.suspended_at::text, p.suspended_reason
      FROM partners p
      JOIN users u ON u.id = p.user_id
      WHERE p.reference = ${reference} AND p.deleted_at IS NULL
      LIMIT 1
    `);

    const partner = rows.rows[0];

    if (!partner) throw notFound(ERROR.PARTNER_NOT_FOUND);

    return partner;
  }

  /**
   * The ladder's fourth rung: takes ONE violation to `suspension`, in the suspending transaction.
   *
   * ## Why the partner id is in the WHERE clause and not in an `if`
   *
   * `violationId` is supplied by the caller. Checked afterwards, a staff member with
   * `PARTNER_SUSPEND` could hand over ANY violation's id and mark another partner's record as
   * having led to a suspension it had nothing to do with — a write to a row they were never
   * authorised for, on an append-only history that exists to be trusted at an appeal. Scoped in the
   * predicate, the row is unreachable rather than merely unmodified, which is the difference the
   * standing rule asks for: "not yours" answers the same as "not there".
   *
   * ## Already at `suspension` is not an error
   *
   * `stage` is forward-only and `suspension` is terminal, so a violation can already be there —
   * escalated, the suspension later lifted, and the same violation cited again. Refusing would
   * block a legitimate suspension over a linkage that is already recorded, so the stage write is
   * skipped and no second audit row is written. Nothing is undone and nothing is duplicated.
   *
   * ## Its own audit row
   *
   * `partner.suspended` records that the business stopped trading. This records that a numbered
   * violation reached its last rung, which is the fact an appeal turns on — and it is the same
   * reason `violation.warned` and `violation.fined` are their own actions rather than fields on
   * something larger.
   */
  private async escalate(
    tx: Database,
    actor: AccessTokenClaims | undefined,
    partnerId: string,
    input: PartnerSuspendInput,
  ): Promise<void> {
    const rows = await tx.execute<{ stage: string }>(sql`
      SELECT stage::text AS stage
      FROM partner_violations
      WHERE id = ${input.violationId}::uuid
        AND partner_id = ${partnerId}::uuid
        AND deleted_at IS NULL
      LIMIT 1
      FOR UPDATE
    `);

    const violation = rows.rows[0];

    if (!violation) throw notFound(ERROR.VIOLATION_NOT_FOUND);

    if (violation.stage === 'suspension') return;

    await tx.execute(sql`
      UPDATE partner_violations
      SET stage = 'suspension', updated_at = now()
      WHERE id = ${input.violationId}::uuid AND partner_id = ${partnerId}::uuid
    `);

    await this.audit.record(
      {
        actorUserId: actor?.sub,
        actorRole: actor?.role,
        action: 'violation.escalated',
        subjectType: 'partner',
        subjectId: partnerId,
        before: { stage: violation.stage },
        after: { stage: 'suspension' },
        reason: input.reason,
      },
      tx,
    );
  }

  private async liveViolation(id: string) {
    const rows = await this.db.execute<{
      id: string;
      partner_id: string;
      stage: string;
      fine_amount: string | null;
      fine_currency_id: string | null;
      booking_id: string | null;
      waived_at: string | null;
    }>(sql`
      SELECT id, partner_id, stage::text AS stage, fine_amount, fine_currency_id,
             booking_id, waived_at::text
      FROM partner_violations
      WHERE id = ${id}::uuid AND deleted_at IS NULL
      LIMIT 1
    `);

    const violation = rows.rows[0];

    if (!violation) throw notFound(ERROR.VIOLATION_NOT_FOUND);

    return violation;
  }
}
