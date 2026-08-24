import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import type { Database } from '@safra/db';
import { COUNT_CAP, ERROR, type OffsetPage, offsetPage } from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import { AuditService } from '../common/audit/audit.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { assertCanWrite, scopeFilter } from '../rbac/scope.sql.js';
import { conflict, notFound } from '../common/errors/app-error.js';

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
 * ## Closing is the only write
 *
 * Opening a dispute happens where the failure happens — a customer raising it in the app, or the
 * SLA job detecting EC-008 — not from the console. What staff do here is investigate and close,
 * and closing is the consequential action: it releases the partner's payout and may credit the
 * customer's wallet.
 */
@Injectable()
export class DisputeService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
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
  async close(
    actor: AccessTokenClaims | undefined,
    reference: string,
    input: CloseDisputeInput,
  ): Promise<DisputeRow> {
    const found = await this.db.execute<{
      id: string;
      status: string;
      customer_profile_id: string;
      city_id: string | null;
    }>(sql`
      SELECT d.id, d.status::text AS status, d.customer_profile_id, b.city_id
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

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE disputes
        SET status = ${input.outcome}::dispute_status,
            resolution = ${input.resolution},
            closed_at = now(),
            closed_by_user_id = ${actor?.sub}::uuid,
            compensation_amount = ${input.compensationAmount ?? null},
            compensation_currency_id = ${
              input.compensationCurrency
                ? sql`(SELECT id FROM currencies WHERE code = ${input.compensationCurrency})`
                : sql`NULL`
            }
        WHERE id = ${dispute.id}::uuid
      `);

      if (input.compensationAmount && input.compensationCurrency) {
        /*
          The wallet is credited through the same table the customer app reads, and
          `balance_after` is computed from the wallet's own current balance inside the
          transaction — never from a value passed in, which could be stale by the time it
          lands. `FOR UPDATE` serialises concurrent credits to the same wallet.
        */
        await tx.execute(sql`
          WITH w AS (
            SELECT wa.id, wa.balance
            FROM wallets wa
            WHERE wa.customer_profile_id = ${dispute.customer_profile_id}::uuid
              AND wa.deleted_at IS NULL
            FOR UPDATE
          ), credited AS (
            UPDATE wallets SET balance = balance + ${input.compensationAmount}::numeric
            WHERE id = (SELECT id FROM w)
            RETURNING id, balance
          )
          INSERT INTO wallet_transactions
            (wallet_id, direction, reason, amount, currency_id, balance_after,
             created_by_user_id, note)
          SELECT credited.id, 'credit', 'sla_compensation',
                 ${input.compensationAmount}::numeric,
                 (SELECT id FROM currencies WHERE code = ${input.compensationCurrency}),
                 credited.balance,
                 ${actor?.sub}::uuid,
                 ${`Dispute ${reference}: ${input.resolution}`.slice(0, 500)}
          FROM credited
        `);
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
          },
          reason: input.resolution,
        },
        tx as unknown as Database,
      );
    });

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
}

interface DisputeRowSql extends Record<string, unknown> {
  id: string;
  reference: string;
  kind: string;
  status: string;
  title: string;
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
