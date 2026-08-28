import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import type { Database } from '@safra/db';
import {
  COUNT_CAP,
  ERROR,
  WALLET_NOTE,
  type OffsetPage,
  offsetPage,
} from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import { AuditService } from '../common/audit/audit.service.js';
import { DisputeNotifier } from './dispute-notifier.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { assertCanWrite, scopeFilter } from '../rbac/scope.sql.js';
import { badRequest, conflict, notFound } from '../common/errors/app-error.js';
import { WalletService, type WalletMovementResult } from '../wallet/wallet.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { FxRateService } from '../fx/fx-rate.service.js';
import { canTransition, type BookingStatus } from '../bookings/booking-state.js';
import { redactIncomingMessage } from '../messaging/redaction.js';

export const closeDisputeSchema = z
  .object({
    /** `resolved` when SAFRA upheld the complaint, `rejected` when it did not. */
    outcome: z.enum(['resolved', 'rejected']),
    /**
     * Required, and stored.
     *
     * A database CHECK enforces the same thing, deliberately: this is the record a customer, a
     * partner or an insurer asks to see, and "closed" with no stated reason answers none of
     * their questions. Belt and braces because the API is not the only writer.
     */
    resolution: z.string().min(10).max(2000),
    /**
     * Compensation credited to the customer's wallet, if any.
     *
     * A string, not a number: money is `numeric(14,2)` and passing it through a JavaScript
     * float is how a 0.1 + 0.2 rounding error reaches somebody's balance.
     */
    compensationAmount: z
      .string()
      .regex(/^\d{1,10}(\.\d{1,2})?$/, 'Compensation must be a decimal amount.')
      .optional(),
    compensationCurrency: z.string().length(3).optional(),
  })
  .strict()
  /*
    An amount without a currency is not money — 10 SYP and 10 USD differ by four orders of
    magnitude, and the wallet credit that follows would be wrong by that factor. Checked here as
    well as by the database constraint so the caller gets a 400 that names the problem.
  */
  .refine(
    (input) =>
      (input.compensationAmount === undefined) ===
      (input.compensationCurrency === undefined),
    { message: 'Compensation needs both an amount and a currency.' },
  );

export type CloseDisputeInput = z.infer<typeof closeDisputeSchema>;

export interface DisputeRow {
  readonly reference: string;
  readonly kind: string;
  readonly status: string;
  readonly title: string;
  /**
   * What the person actually said, and the reason this field is here at all.
   *
   * `disputes.description` is written on both routes — the customer's own words through the app,
   * and the account a staff member takes down over the phone — redacted on the way in like every
   * stored message. Until 2026-08-27 no staff surface SELECTED it: the queue showed a 120-character
   * title, the booking screen showed a count, and that was everything an operator had.
   *
   * Which means the decision to uphold a complaint, release a frozen payout and credit somebody's
   * wallet was taken from a headline. Measured that day: 22 of 22 open disputes carried a
   * description and not one of them was on a screen. «الغرفة لم تطابق الوصف المنشور» is the title;
   * that the room faced the car park instead of the garden is in the description.
   */
  readonly description: string | null;
  readonly bookingReference: string | null;
  readonly partner: string | null;
  readonly customer: string | null;
  readonly evidenceCount: number;
  readonly compensationAmount: string | null;
  readonly compensationCurrency: string | null;
  readonly resolution: string | null;
  /** Whole hours since it was opened — the design's "22h" column. */
  readonly ageHours: number;
  readonly openedAt: string;
  readonly closedAt: string | null;
  /** True while this dispute is holding the partner's payout for its booking. */
  readonly freezesPayout: boolean;
}

export interface DisputeCounters {
  readonly open: number;
  readonly investigating: number;
  readonly resolvedThisMonth: number;
  /** Hours since the oldest unresolved dispute was opened. Null when none are open. */
  readonly oldestOpenHours: number | null;
  readonly frozenPayouts: number;
}

/** The two states in which a dispute still holds the partner's money. */
const UNRESOLVED = sql`('open', 'investigating')`;

/**
 * النزاعات — disputes (SRS §10, design handoff §8).
 *
 * ## The payout freeze is derived, never stored
 *
 * The handoff's rule: "فتح النزاع يجمّد استحقاق تحويل الشريك للحجز المعني حتى الإغلاق". That is
 * expressed as a predicate over `disputes` — is there a row for this booking whose status is
 * `open` or `investigating` — rather than a `payout_frozen` flag on the booking.
 *
 * A flag would have exactly one failure mode and it is unacceptable here: the flag and the
 * disputes disagree, and money moves on the strength of the stale one. Deriving it costs an
 * indexed lookup and cannot be wrong.
 *
 * ## Staff open disputes too, since 2026-08-25
 *
 * This said "closing is the only write", on the reasoning that a dispute is raised where the
 * failure happens — a customer in the app, or the SLA job detecting EC-008. §9.4 disagrees and
 * always did: «فتح نزاع أو استرداد أو تعويض» is on its list of what the booking screen must do,
 * and the common case is a customer who telephones rather than opens the app. `openForBooking` is
 * that route.
 *
 * Closing remains the consequential action — it releases the partner's payout and may credit the
 * customer's wallet — and it now also lifts the `disputed` overlay from the booking.
 */
@Injectable()
export class DisputeService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly wallet: WalletService,
    private readonly ledger: LedgerService,
    private readonly fx: FxRateService,
    private readonly notifier: DisputeNotifier,
  ) {}

  /** A currency code the platform knows, or a refusal a person can read. */
  private async currencyIdOf(code: string): Promise<string> {
    const rows = await this.db.execute<{ id: string }>(sql`
      SELECT id FROM currencies WHERE code = ${code}
    `);

    const id = rows.rows[0]?.id;

    if (!id) throw badRequest(ERROR.GEO_CURRENCY_UNKNOWN);

    return id;
  }

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

  async counters(actor?: AccessTokenClaims): Promise<DisputeCounters> {
    const result = await this.db.execute<{
      open: string;
      investigating: string;
      resolved_this_month: string;
      oldest_open_hours: string | null;
      frozen_payouts: string;
    }>(sql`
      SELECT
        count(*) FILTER (WHERE d.status = 'open')::text          AS open,
        count(*) FILTER (WHERE d.status = 'investigating')::text  AS investigating,
        count(*) FILTER (WHERE d.status IN ('resolved','rejected')
                           AND d.closed_at >= date_trunc('month', current_date))::text
          AS resolved_this_month,
        floor(extract(epoch FROM (now() - min(d.created_at)
          FILTER (WHERE d.status IN ('open','investigating')))) / 3600)::text
          AS oldest_open_hours,
        count(DISTINCT d.booking_id) FILTER (WHERE d.status IN ('open','investigating'))::text
          AS frozen_payouts
      FROM disputes d
      LEFT JOIN bookings b ON b.id = d.booking_id
      WHERE d.deleted_at IS NULL AND ${scopeFilter(actor, 'b.city_id')}
    `);

    const row = result.rows[0];

    return {
      open: Number(row?.open ?? 0),
      investigating: Number(row?.investigating ?? 0),
      resolvedThisMonth: Number(row?.resolved_this_month ?? 0),
      oldestOpenHours:
        row?.oldest_open_hours === null || row?.oldest_open_hours === undefined
          ? null
          : Number(row.oldest_open_hours),
      frozenPayouts: Number(row?.frozen_payouts ?? 0),
    };
  }

  async list(query: {
    limit: number;
    page: number;
    q?: string | undefined;
    status?: string | undefined;
    actor?: AccessTokenClaims | undefined;
  }): Promise<OffsetPage<DisputeRow>> {
    /*
      A dispute has no city of its own; it inherits the booking's. Scoping through the join is
      correct rather than convenient — a dispute belongs to wherever the stay was.
    */
    const conditions: SQL[] = [
      sql`d.deleted_at IS NULL`,
      scopeFilter(query.actor, 'b.city_id'),
    ];

    if (query.status) {
      conditions.push(sql`d.status = ${query.status}::dispute_status`);
    }

    if (query.q) {
      const term = `%${query.q}%`;

      conditions.push(
        sql`(d.reference ILIKE ${query.q + '%'}
             OR b.reference ILIKE ${query.q + '%'}
             OR c.full_name ILIKE ${term}
             OR d.title ILIKE ${term})`,
      );
    }

    // One fragment, used by both queries below — see `countOf`.
    const fromWhere = sql`
      FROM disputes d
      LEFT JOIN bookings b          ON b.id = d.booking_id
      LEFT JOIN partners p          ON p.id = d.partner_id
      LEFT JOIN customer_profiles c ON c.id = d.customer_profile_id
      LEFT JOIN currencies cur      ON cur.id = d.compensation_currency_id
      LEFT JOIN (
      SELECT dispute_id, count(*) AS n FROM dispute_evidence GROUP BY dispute_id
      ) ev ON ev.dispute_id = d.id
      WHERE ${sql.join(conditions, sql` AND `)}`;

    const [result, total] = await Promise.all([
      this.db.execute<DisputeRowSql>(sql`
      SELECT d.id, d.reference,
             d.kind::text   AS kind,
             d.status::text AS status,
             d.title,
             -- The customer's OWN ACCOUNT. Stored since the first migration and read by nothing:
             -- see the row type's note.
             d.description,
             b.reference    AS booking_reference,
             p.display_name AS partner,
             c.full_name    AS customer,
             coalesce(ev.n, 0)::int         AS evidence_count,
             d.compensation_amount::text    AS compensation_amount,
             cur.code                       AS compensation_currency,
             d.resolution,
             floor(extract(epoch FROM (now() - d.created_at)) / 3600)::int AS age_hours,
             (d.status IN ('open','investigating')) AS freezes_payout,
             to_char(d.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS opened_at,
             to_char(d.closed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS closed_at,
             d.created_at
        ${fromWhere}
        -- ── النزاعات is a WORK QUEUE, not an activity feed (Bashar, 2026-08-24) ──
        --
        -- Unresolved first, and OLDEST first inside that group. An operator works down this screen
        -- from the top, and the item that has been waiting longest is the one that should be there.
        --
        -- ## The comment used to say this and the query did not
        --
        -- These three lines described exactly this ordering above a plain ORDER BY created_at DESC:
        -- newest first, no status grouping. So the screen returned a feed. An operator working
        -- top-down was reading the most recently OPENED disputes while the oldest backlog sank out
        -- of sight, which is the opposite of what the note promised. Recorded as O-cons-1 and decided
        -- by Bashar: a dispute FREEZES the partner's payout, so an unresolved one is money held and
        -- somebody waiting, and queue order outranks chronology.
        --
        -- ## Why closed disputes are newest-first underneath
        --
        -- Nothing is waiting on them, so "longest waiting" is meaningless there; what a reader wants
        -- from a closed dispute is the one just settled. Two orders for two questions, in one list,
        -- which is what the CASE expresses.
        ORDER BY (d.status IN ('open','investigating')) DESC,
                 CASE WHEN d.status IN ('open','investigating')
                      THEN d.created_at END ASC NULLS LAST,
                 d.created_at DESC,
                 d.id DESC
        LIMIT ${query.limit} ${this.pageOffset(query)}
      `),
      this.countOf(fromWhere),
    ]);

    return offsetPage(
      result.rows.map((row) => ({
        reference: row.reference,
        kind: row.kind,
        status: row.status,
        title: row.title,
        description: row.description,
        bookingReference: row.booking_reference,
        partner: row.partner,
        customer: row.customer,
        evidenceCount: row.evidence_count,
        compensationAmount: row.compensation_amount,
        compensationCurrency: row.compensation_currency,
        resolution: row.resolution,
        ageHours: row.age_hours,
        openedAt: row.opened_at,
        closedAt: row.closed_at,
        freezesPayout: row.freezes_payout,
      })),
      total,
      query,
    );
  }

  /**
   * Which bookings currently have their partner payout frozen.
   *
   * Exposed as its own method because the payout path must consult it, not the dispute screen.
   * Returns references rather than ids so a caller cannot accidentally use it as a join key and
   * couple a money decision to this service's internals.
   */
  async frozenBookingReferences(actor?: AccessTokenClaims): Promise<string[]> {
    const result = await this.db.execute<{ reference: string }>(sql`
      SELECT DISTINCT b.reference
      FROM disputes d
      JOIN bookings b ON b.id = d.booking_id
      WHERE d.status IN ${UNRESOLVED} AND d.deleted_at IS NULL
        AND ${scopeFilter(actor, 'b.city_id')}
      ORDER BY b.reference
    `);

    return result.rows.map((row) => row.reference);
  }

  /**
   * Closes a dispute, releasing the partner's payout.
   *
   * ## One transaction, and the wallet credit is part of it
   *
   * If compensation is agreed, the wallet transaction and the dispute's closure are written
   * together. Splitting them gives two failure modes that are both worse than an error: a
   * dispute closed with a promised credit that never arrived, or a credit with no record of why
   * it was given. The wallet is append-only by trigger, so a partial write cannot be tidied up
   * afterwards.
   */
  /**
   * «I have this» — the button Bashar asked for on 2026-08-27 to bring the badge down.
   *
   * ## Why this is a STATUS and not a "read" flag
   *
   * The ask was a control that decreases the sidebar count. The tempting shape — mark it seen and
   * stop counting it — hides a dispute that still FREEZES THE PARTNER'S PAYOUT: the queue would
   * report nobody waiting while the money stays held, which is the one thing this domain must
   * never do quietly.
   *
   * `investigating` already existed for this and had no writer at all (reported the same day as the
   * review's finding ①). It says what is true — somebody has picked this up and it is not settled —
   * and it changes nothing about the money: `UNRESOLVED` still contains it, so the payout stays
   * frozen, «مستحقات مجمّدة» still counts it, and the queue still sorts it to the top by age.
   *
   * What changes is only the BADGE, which now counts what nobody has taken. That is the honest
   * reading of a number whose job is to say «this needs somebody».
   *
   * ## It records WHO, because otherwise the state says nothing useful
   *
   * `assigned_to_user_id` is written in the same statement. Without it «قيد المراجعة» means an
   * anonymous somebody, and two operators can each mark the same dispute and each believe the other
   * has not — which is the coordination failure the button exists to prevent.
   *
   * ## Idempotent, and quiet about it
   *
   * Taking one that is already taken changes nothing and writes NO audit row. Closing is different
   * and stays different: that is a CONFLICT, because two people settling one complaint differently
   * is a race worth surfacing.
   */
  async acknowledge(
    actor: AccessTokenClaims | undefined,
    reference: string,
  ): Promise<{ acknowledged: boolean }> {
    const found = await this.db.execute<{
      id: string;
      status: string;
      city_id: string | null;
    }>(sql`
      SELECT d.id, d.status::text AS status, b.city_id
      FROM disputes d
      LEFT JOIN bookings b ON b.id = d.booking_id
      WHERE d.reference = ${reference} AND d.deleted_at IS NULL
        AND ${scopeFilter(actor, 'b.city_id')}
      LIMIT 1
    `);

    const dispute = found.rows[0];

    if (!dispute) throw notFound(ERROR.DISPUTE_NOT_FOUND);

    /* The write path is guarded on its own — the list is not the gate. */
    assertCanWrite(actor, dispute.city_id);

    if (dispute.status === 'resolved' || dispute.status === 'rejected') {
      throw conflict(ERROR.DISPUTE_ALREADY_CLOSED);
    }

    if (dispute.status === 'investigating') return { acknowledged: false };

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE disputes
        SET status = 'investigating'::dispute_status,
            assigned_to_user_id = ${actor?.sub}::uuid
        WHERE id = ${dispute.id}::uuid
      `);

      await this.audit.record(
        {
          actorUserId: actor?.sub,
          actorRole: actor?.role,
          action: 'dispute.acknowledged',
          subjectType: 'dispute',
          subjectId: dispute.id,
          before: { status: 'open' },
          after: { status: 'investigating', assignedTo: actor?.sub },
        },
        tx as unknown as Database,
      );
    });

    return { acknowledged: true };
  }

  async close(
    actor: AccessTokenClaims | undefined,
    reference: string,
    input: CloseDisputeInput,
  ): Promise<DisputeRow> {
    const found = await this.db.execute<{
      id: string;
      status: string;
      customer_profile_id: string;
      booking_id: string | null;
      city_id: string | null;
    }>(sql`
      SELECT d.id, d.status::text AS status, d.customer_profile_id, d.booking_id, b.city_id
      FROM disputes d
      LEFT JOIN bookings b ON b.id = d.booking_id
      WHERE d.reference = ${reference} AND d.deleted_at IS NULL
      LIMIT 1
    `);

    const dispute = found.rows[0];

    if (!dispute) throw notFound(ERROR.DISPUTE_NOT_FOUND);

    /*
      Geographic scope, checked on the WRITE path even though the list already filtered reads.
      A caller can name any reference; the list is not the gate. Refused in both modes — read_only
      widens reads only.
    */
    assertCanWrite(actor, dispute.city_id);

    /*
      Closing an already-closed dispute is a CONFLICT, not an idempotent no-op. Two staff
      members resolving the same complaint differently is exactly the race worth surfacing —
      silently keeping the first outcome would leave the second person believing theirs applied.
    */
    if (dispute.status === 'resolved' || dispute.status === 'rejected') {
      throw conflict(ERROR.DISPUTE_ALREADY_CLOSED);
    }

    /*
      Resolved BEFORE the transaction opens, so an unknown code is a translatable 400 rather than
      a database error.

      `disputes_compensation_needs_currency` already refuses the row, which is the right backstop
      and the wrong first line: the subselect yields NULL, the CHECK fires mid-statement, and the
      client gets the generic message every unhandled query error produces. A staff member who
      mistyped a currency deserves to be told that.
    */
    const currencyId = input.compensationCurrency
      ? await this.currencyIdOf(input.compensationCurrency)
      : null;

    /* What actually landed, for the audit row — see where it is recorded. */
    let credited: WalletMovementResult | null = null;

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE disputes
        SET status = ${input.outcome}::dispute_status,
            resolution = ${input.resolution},
            closed_at = now(),
            closed_by_user_id = ${actor?.sub}::uuid,
            compensation_amount = ${input.compensationAmount ?? null},
            compensation_currency_id = ${currencyId}::uuid
        WHERE id = ${dispute.id}::uuid
      `);

      if (input.compensationAmount && currencyId) {
        /*
          Through `WalletService`, which is the ONLY thing that may move a balance.

          This used to be a hand-written INSERT beside a `balance = balance + amount`, and it was
          the ADR's second defect back in the codebase: a wallet holds ONE currency forever, this
          path let a staff member name a different one, and adding the two produces a figure in a
          currency that does not exist. 512 of the 11,801 wallets on 2026-08-26 are EUR while the
          console's close-dispute form posts a hardcoded `'USD'`, so every compensation paid to
          one of those customers would have corrupted the balance — silently, because nothing
          compared the two codes. No row had drifted yet; the path had simply not been walked.

          `credit()` converts through SYP, takes the `FOR UPDATE` lock, computes `balance_after`
          in integer minor units, and refuses what it cannot express. Called with the dispute's
          own `tx`, so it nests as a SAVEPOINT and the credit still commits or rolls back with the
          resolution.
        */
        credited = await this.wallet.credit(tx as unknown as Database, {
          customerProfileId: dispute.customer_profile_id,
          amount: input.compensationAmount,
          currencyId,
          reason: 'sla_compensation',
          note: WALLET_NOTE.DISPUTE_RESOLVED,
          createdByUserId: actor?.sub,
        });

        /*
          And the books balance — a wallet credit with no matching debit is money appearing from
          nowhere.

          This path posted NOTHING, which made a dispute resolution the one compensation outside
          the accounting model. The SLA sweep has always posted `partner_fine` ↔ `wallet_credit`
          through `postPartnerFine`, because there the PARTNER funds it. Here nobody is fined:
          SAFRA has decided to pay, so SAFRA's own account is the debit.

          `wallet_compensation` rather than `wallet_adjustment` — that one is a finance CORRECTION,
          and «what did compensation cost us this month» should not require grepping descriptions.

          Posted at the APPLIED amount in the WALLET's currency, not the requested one: if a staff
          member awards 10 USD to a EUR wallet, what SAFRA owes is the 9.29 that landed. Booking the
          request would leave the ledger disagreeing with the balance it exists to explain.
        */
        await this.ledger.post(
          tx as unknown as Database,
          [
            {
              account: 'wallet_compensation',
              direction: 'debit',
              amount: credited.appliedAmount,
              description: `Compensation for dispute ${reference}`,
            },
            {
              account: 'wallet_credit',
              direction: 'credit',
              amount: credited.appliedAmount,
              description: `Compensation credited for dispute ${reference}`,
            },
          ],
          {
            currencyId: credited.currencyId,
            fxRateToSyp: await this.fx.rateToSyp(credited.currencyCode),
            bookingId: dispute.booking_id ?? undefined,
            customerProfileId: dispute.customer_profile_id,
            createdByUserId: actor?.sub,
          },
        );
      }

      await this.audit.record(
        {
          actorUserId: actor?.sub,
          actorRole: actor?.role,
          action: `dispute.${input.outcome}`,
          subjectType: 'dispute',
          subjectId: dispute.id,
          before: { status: dispute.status },
          after: {
            status: input.outcome,
            compensationAmount: input.compensationAmount ?? null,
            compensationCurrency: input.compensationCurrency ?? null,
            /*
              What the wallet actually took, beside what was decided.

              They differ whenever the customer's wallet is denominated in another currency —
              10.00 USD becomes 9.29 EUR — and a record holding only the decision cannot answer
              the question a customer asks, which is why their balance moved by that number. The
              same pairing `sla.service.ts` writes on the timeline, for the same reason.
            */
            creditedAmount: credited?.appliedAmount ?? null,
            creditedCurrency: credited?.currencyCode ?? null,
          },
          reason: input.resolution,
        },
        tx as unknown as Database,
      );

      /*
        The overlay lifts, IN THE SAME TRANSACTION as the closure.

        §6.2 defines `Disputed` as «يوجد نزاع مفتوح على الحجز» — a booking that HAS an open
        dispute. Closing the last one makes that untrue, so the booking must stop saying it. A
        separate write would give two failure modes, and one of them is permanent: a dispute closed
        with the booking left `disputed` is a booking that no payout accrual will ever pick up,
        silently, for ever.
      */
      await this.restoreBookingStatus(tx as unknown as Database, dispute.id, actor);
    });

    /*
      AFTER the commit, and it cannot fail the closure.

      Both people this concerns are told: the customer what was decided, the partner that the hold
      on their money is lifted. Neither was told anything until 2026-08-28 — they found out by
      looking. `DisputeNotifier` swallows its own errors and audits what actually happened, so a mail
      server being down cannot make a settled dispute look unsettled.
    */
    await this.notifier.closed(actor, dispute.id, input.outcome);

    /*
      Re-read WITHOUT the actor's scope filter. The write was already authorised above, and a member
      whose `none` scope excludes this row would otherwise close it successfully and receive a 404 —
      correct authorisation, nonsensical response.
    */
    const reread = await this.list({ limit: 1, page: 1, q: reference });
    const view = reread.items[0];

    if (!view) throw notFound(ERROR.DISPUTE_NOT_FOUND);

    return view;
  }

  /**
   * Staff open a dispute on a booking, from §9.4's own list of what that screen must do.
   *
   * ## Not the customer's route with a different guard
   *
   * `DisputeRequestService.open` scopes the booking to the CALLER's profile — a customer disputing
   * their own stay. Staff have no profile and are not the aggrieved party: they are recording a
   * complaint somebody made by telephone. So the booking is found by reference alone, the
   * customer is taken FROM the booking, and `opened_by_user_id` carries the staff member — which
   * is the column's stated meaning, and the only thing that later distinguishes a complaint SAFRA
   * recorded from one the customer filed themselves.
   *
   * ## It moves the booking, and that is the point
   *
   * §6.2 lists `Disputed` with «سفرة» in the "who changes it" column, and it has never had a
   * writer. Bashar's instruction (2026-08-25): the lifecycle shown on the booking must match
   * reality. So the dispute row and the status move are one transaction — a dispute that exists
   * against a booking still claiming to be `confirmed` is precisely the mismatch this closes.
   *
   * A booking whose state does not permit the move gets the dispute anyway. `pending_payment` and
   * `pending_confirmation` are not disputable states in §6.2 and the guard below refuses them
   * outright; `cancelled` is not either. What remains is the case where the move is refused for a
   * reason the table knows and this method does not — and refusing to RECORD a complaint because
   * of a state machine would be the wrong way round.
   */
  async openForBooking(
    actor: AccessTokenClaims | undefined,
    input: {
      bookingReference: string;
      kind: string;
      title: string;
      description: string;
    },
  ): Promise<DisputeRow> {
    const found = await this.db.execute<{
      id: string;
      partner_id: string;
      customer_profile_id: string;
      status: BookingStatus;
      city_id: string | null;
      paid: boolean;
    }>(sql`
      SELECT b.id, b.partner_id, b.customer_profile_id, b.status::text AS status, b.city_id,
             (b.paid_at IS NOT NULL) AS paid
      FROM bookings b
      WHERE b.reference = ${input.bookingReference} AND b.deleted_at IS NULL
      LIMIT 1
    `);

    const booking = found.rows[0];

    if (!booking) throw notFound(ERROR.BOOKING_NOT_FOUND);

    /* Geographic scope on the WRITE path — a caller can name any reference; the list is not the gate. */
    assertCanWrite(actor, booking.city_id);

    /*
      Nothing to dispute before money has moved, exactly as the customer's route decides it. A
      booking still in its payment window has no stay, no charge and nothing to complain about —
      and §6.2 gives `Disputed` no edge from either pending state.
    */
    /*
      Already `disputed` counts as disputable, and missing that was a bug the test found.

      The schema allows a booking two disputes of different kinds, and the second one arrives when
      the booking is already carrying the first — at which point `canTransition('disputed',
      'disputed', …)` is false, because a state never transitions to itself. Asking only the
      transition therefore refused exactly the case the "one live dispute per KIND" rule exists to
      permit. There is simply nothing to move.
    */
    const alreadyDisputed = booking.status === 'disputed';

    if (
      !booking.paid ||
      !(alreadyDisputed || canTransition(booking.status, 'disputed', 'staff'))
    ) {
      throw badRequest(ERROR.DISPUTE_BOOKING_NOT_DISPUTABLE);
    }

    /* One live dispute per booking per KIND — the same rule the customer's route enforces. */
    const existing = await this.db.execute<{ reference: string }>(sql`
      SELECT reference FROM disputes
      WHERE booking_id = ${booking.id}::uuid
        AND kind = ${input.kind}::dispute_kind
        AND status IN ${UNRESOLVED}
      LIMIT 1
    `);

    if (existing.rows[0]) throw conflict(ERROR.DISPUTE_ALREADY_OPEN);

    /* Both prose fields masked, as every stored message is. The originals are not kept. */
    const title = redactIncomingMessage(input.title);
    const description = redactIncomingMessage(input.description);

    const reference = await this.db.transaction(async (tx) => {
      const created = await tx.execute<{ id: string; reference: string }>(sql`
        INSERT INTO disputes
          (booking_id, partner_id, customer_profile_id, kind, status, title, description,
           opened_by_user_id)
        VALUES (${booking.id}::uuid, ${booking.partner_id}::uuid,
                ${booking.customer_profile_id}::uuid, ${input.kind}::dispute_kind,
                'open'::dispute_status, ${title.body}, ${description.body},
                ${actor?.sub ?? null})
        RETURNING id, reference
      `);

      const row = created.rows[0];

      if (!row) throw notFound(ERROR.DISPUTE_NOT_FOUND);

      /*
        The status carries the FROM state in its predicate, so two staff opening disputes at once
        cannot both move it — the second matches nothing and leaves the first's move standing. It
        is not an error: the second dispute is legitimately recorded, and the booking is already
        where it needs to be.
      */
      await tx.execute(sql`
        UPDATE bookings SET status = 'disputed', updated_at = now()
        WHERE id = ${booking.id}::uuid AND status = ${booking.status}::booking_status
      `);

      await tx.execute(sql`
        INSERT INTO timeline_events (subject_type, subject_id, event_type, actor_type, actor_user_id, payload)
        VALUES ('booking', ${booking.id}::uuid, 'booking.disputed', 'staff',
                ${actor?.sub ?? null}, ${JSON.stringify({ dispute: row.reference, kind: input.kind })}::jsonb)
      `);

      await this.audit.record(
        {
          actorUserId: actor?.sub,
          actorRole: actor?.role,
          action: 'dispute.opened_by_staff',
          subjectType: 'dispute',
          subjectId: row.id,
          before: { status: booking.status },
          after: { status: 'disputed', kind: input.kind },
        },
        tx as unknown as Database,
      );

      return row.reference;
    });

    const reread = await this.list({ limit: 1, page: 1, q: reference });
    const view = reread.items[0];

    if (!view) throw notFound(ERROR.DISPUTE_NOT_FOUND);

    return view;
  }

  /**
   * Puts a booking back where it was once its last open dispute closes.
   *
   * ## Derived from the booking's own stamps, never remembered in a column
   *
   * `completed_at` → the stay finished; `checked_in_at` → the guest had arrived; otherwise
   * `confirmed`. Those three columns already record where the booking got to, and they cannot
   * drift from themselves. A `status_before_dispute` column would be a second thing to keep true,
   * and the first time it disagreed nobody would know which one was the booking.
   *
   * ## Only when the LAST one closes
   *
   * A booking may carry more than one dispute — the schema says so and both open routes allow a
   * second of a different kind. Lifting the overlay while another complaint is still open would
   * put the booking back in the payout accrual with a live dispute against it. The accrual's own
   * `NOT EXISTS` clause would still catch it, but relying on the second guard to cover the first
   * one being wrong is how both end up wrong.
   *
   * ## A cancelled booking is left alone
   *
   * `cancelled` is terminal and `disputed → cancelled` is a decision somebody made deliberately.
   * If the booking is not `disputed` when this runs there is nothing to lift, and saying so by
   * matching on the status in the predicate is cheaper than asking first.
   */
  private async restoreBookingStatus(
    tx: Database,
    disputeId: string,
    actor: AccessTokenClaims | undefined,
  ): Promise<void> {
    const rows = await tx.execute<{ id: string; restored: BookingStatus }>(sql`
      UPDATE bookings b
      SET status = CASE
            WHEN b.completed_at  IS NOT NULL THEN 'completed'::booking_status
            WHEN b.checked_in_at IS NOT NULL THEN 'checked_in'::booking_status
            ELSE 'confirmed'::booking_status
          END,
          updated_at = now()
      FROM disputes d
      WHERE d.id = ${disputeId}::uuid
        AND b.id = d.booking_id
        AND b.status = 'disputed'
        AND NOT EXISTS (
          SELECT 1 FROM disputes other
          WHERE other.booking_id = b.id
            AND other.id <> d.id
            AND other.status IN ${UNRESOLVED}
            AND other.deleted_at IS NULL
        )
      RETURNING b.id, b.status::text AS restored
    `);

    const booking = rows.rows[0];

    /* Nothing moved: another dispute is still open, or the booking was cancelled out of it. */
    if (!booking) return;

    await tx.execute(sql`
      INSERT INTO timeline_events (subject_type, subject_id, event_type, actor_type, actor_user_id, payload)
      VALUES ('booking', ${booking.id}::uuid, 'booking.dispute_closed', 'staff',
              ${actor?.sub ?? null}, ${JSON.stringify({ status: booking.restored })}::jsonb)
    `);

    await this.audit.record(
      {
        actorUserId: actor?.sub,
        actorRole: actor?.role,
        action: 'booking.dispute_closed',
        subjectType: 'booking',
        subjectId: booking.id,
        before: { status: 'disputed' },
        after: { status: booking.restored },
      },
      tx,
    );
  }
}

interface DisputeRowSql extends Record<string, unknown> {
  id: string;
  reference: string;
  kind: string;
  status: string;
  title: string;
  description: string | null;
  booking_reference: string | null;
  partner: string | null;
  customer: string | null;
  evidence_count: number;
  compensation_amount: string | null;
  compensation_currency: string | null;
  resolution: string | null;
  age_hours: number;
  freezes_payout: boolean;
  opened_at: string;
  closed_at: string | null;
  created_at: string;
}
