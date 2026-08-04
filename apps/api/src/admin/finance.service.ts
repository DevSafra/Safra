import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { type CursorPage, decodeCursor, encodeCursor } from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';

export interface FinanceRow {
  /** The human reference of the underlying operation. */
  readonly reference: string;
  /** What it is attached to — a booking reference or a partner reference. */
  readonly linkedTo: string | null;
  readonly method: string;
  /** `payment` | `refund` | `fine` — drives the design's coloured النوع column. */
  readonly kind: 'payment' | 'refund' | 'fine';
  readonly amount: string;
  readonly currency: string;
  readonly status: string;
  readonly at: string;
}

export interface FinanceCounters {
  readonly captured_today: string;
  readonly refunded_today: string;
  readonly fines_collected_month: string;
  readonly partner_payable_outstanding: string;
  readonly currency: string;
}

/**
 * الدفع والفواتير — the money movement log (design handoff §8, SRS §11).
 *
 * ## One table over three sources
 *
 * The design shows payments, refunds and partner fines in a single chronological table with a
 * coloured type column, and that is the right shape: the operational question is "what
 * happened to this booking's money", and answering it from three separate screens means
 * reconstructing a timeline by hand.
 *
 * A `UNION ALL` rather than a view, because each source contributes different columns and the
 * mapping is presentation, not schema. Each branch is bounded by the same keyset predicate
 * BEFORE the union, so Postgres can use each table's own `created_at` index instead of sorting
 * the whole union.
 *
 * ## What is missing, and is not faked
 *
 * The design's fourth row type is **تحويل شريك** (`TRF-…`, a scheduled partner payout). There
 * is no payouts table — `partner_payout_accounts` records where to send money, not that any
 * was sent — and payment rails are deferred by decision (2026-08-01). So payouts are absent
 * from this list rather than derived from `partner_payable_amount`, which would present an
 * accounting intention as a transaction that occurred.
 *
 * Refunds also have no human reference column, so they are keyed by the payment they reverse.
 * Both gaps are recorded in `docs/design-gap-report.md`.
 */
@Injectable()
export class FinanceService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * The four KPI cards.
   *
   * Amounts come from `ledger_entries`, not from `payments.amount`, because the ledger is the
   * balanced double-entry record and is immutable by trigger — a captured payment that was
   * later partially refunded shows correctly here and would be overstated if read from the
   * payment row. `partner_payable_outstanding` is what SAFRA owes and has not paid.
   */
  async counters(): Promise<FinanceCounters> {
    const result = await this.db.execute<{
      captured_today: string;
      refunded_today: string;
      fines_collected_month: string;
      partner_payable_outstanding: string;
      currency: string;
    }>(sql`
      WITH today AS (SELECT current_date AS d)
      SELECT
        coalesce((SELECT sum(l.amount) FROM ledger_entries l, today
                  WHERE l.account = 'customer_payment' AND l.direction = 'credit'
                    AND l.created_at >= today.d), 0)::text AS captured_today,
        coalesce((SELECT sum(l.amount) FROM ledger_entries l, today
                  WHERE l.account = 'refund' AND l.direction = 'debit'
                    AND l.created_at >= today.d), 0)::text AS refunded_today,
        coalesce((SELECT sum(v.fine_amount) FROM partner_violations v
                  WHERE v.collected_at IS NOT NULL
                    AND v.collected_at >= date_trunc('month', current_date)), 0)::text
          AS fines_collected_month,
        coalesce((SELECT sum(b.partner_payable_amount) FROM bookings b
                  WHERE b.status IN ('confirmed','checked_in','completed')), 0)::text
          AS partner_payable_outstanding,
        (SELECT code FROM currencies WHERE code = 'USD' LIMIT 1) AS currency
    `);

    const row = result.rows[0];

    /*
      A missing row would mean the CTE returned nothing, which cannot happen — but returning
      zeroes rather than throwing keeps one bad aggregate from blanking the whole screen, and
      the values are labelled, so a zero reads as "nothing today" not as "unknown".
    */
    return (
      row ?? {
        captured_today: '0',
        refunded_today: '0',
        fines_collected_month: '0',
        partner_payable_outstanding: '0',
        currency: 'USD',
      }
    );
  }

  async list(query: {
    limit: number;
    cursor?: string | undefined;
    q?: string | undefined;
  }): Promise<CursorPage<FinanceRow>> {
    const bound = this.bound(query.cursor);
    const term = query.q ? `%${query.q}%` : null;

    /*
      The search predicate is repeated per branch rather than applied to the union, so each
      branch stays index-eligible. `null` short-circuits to TRUE, which Postgres folds away.
    */
    const search = (columns: SQL): SQL =>
      term === null ? sql`TRUE` : sql`(${columns} ILIKE ${term})`;

    const result = await this.db.execute<{
      id: string;
      reference: string;
      linked_to: string | null;
      method: string;
      kind: 'payment' | 'refund' | 'fine';
      amount: string;
      currency: string;
      status: string;
      created_at: string;
      at: string;
    }>(sql`
      SELECT * FROM (
        SELECT pay.id, pay.reference,
               b.reference                AS linked_to,
               pay.method::text           AS method,
               'payment'                  AS kind,
               pay.amount::text           AS amount,
               cur.code                   AS currency,
               pay.status::text           AS status,
               pay.created_at,
               to_char(pay.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at
        FROM payments pay
        LEFT JOIN bookings b   ON b.id = pay.booking_id
        LEFT JOIN currencies cur ON cur.id = pay.currency_id
        WHERE ${bound('pay')} AND ${search(sql`pay.reference || ' ' || coalesce(b.reference,'')`)}

        UNION ALL

        SELECT r.id,
               coalesce(pay2.reference, '—') AS reference,
               b2.reference               AS linked_to,
               coalesce(pay2.method::text, '—') AS method,
               'refund'                   AS kind,
               r.amount::text             AS amount,
               cur2.code                  AS currency,
               r.status::text             AS status,
               r.created_at,
               to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at
        FROM refunds r
        LEFT JOIN payments pay2  ON pay2.id = r.payment_id
        LEFT JOIN bookings b2    ON b2.id = r.booking_id
        LEFT JOIN currencies cur2 ON cur2.id = r.currency_id
        WHERE ${bound('r')} AND ${search(sql`coalesce(pay2.reference,'') || ' ' || coalesce(b2.reference,'')`)}

        UNION ALL

        SELECT v.id,
               p.reference                AS reference,
               b3.reference               AS linked_to,
               v.kind::text               AS method,
               'fine'                     AS kind,
               v.fine_amount::text        AS amount,
               cur3.code                  AS currency,
               CASE WHEN v.waived_at IS NOT NULL THEN 'waived'
                    WHEN v.collected_at IS NOT NULL THEN 'collected'
                    ELSE 'pending' END    AS status,
               v.created_at,
               to_char(v.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at
        FROM partner_violations v
        LEFT JOIN partners p     ON p.id = v.partner_id
        LEFT JOIN bookings b3    ON b3.id = v.booking_id
        LEFT JOIN currencies cur3 ON cur3.id = v.fine_currency_id
        WHERE ${bound('v')} AND ${search(sql`coalesce(p.reference,'') || ' ' || coalesce(b3.reference,'')`)}
      ) rows
      ORDER BY rows.created_at DESC, rows.id DESC
      LIMIT ${query.limit + 1}
    `);

    const hasMore = result.rows.length > query.limit;
    const page = hasMore ? result.rows.slice(0, query.limit) : result.rows;
    const last = page.at(-1);

    return {
      items: page.map((row) => ({
        reference: row.reference,
        linkedTo: row.linked_to,
        method: row.method,
        kind: row.kind,
        amount: row.amount,
        currency: row.currency,
        status: row.status,
        at: row.at,
      })),
      nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null,
    };
  }

  /** The keyset bound, applied per union branch so each keeps its own index. */
  private bound(cursor: string | undefined): (alias: string) => SQL {
    if (cursor === undefined) return () => sql`TRUE`;

    const after = decodeCursor(cursor);

    if (!after) throw new BadRequestException('Malformed pagination cursor.');

    return (alias) =>
      sql`(${sql.raw(alias)}.created_at, ${sql.raw(alias)}.id) < (${after.sortKey}::timestamptz, ${after.id}::uuid)`;
  }

  // ── المحفظة ────────────────────────────────────────────────────────────────

  /**
   * The wallet ledger across all customers.
   *
   * Every row carries its REASON, which is the whole point of the screen: a wallet credit is
   * either a refund, an SLA compensation (P-007) or a manual adjustment, and only the last of
   * those is a judgement call somebody has to be accountable for. `balance_after` comes along
   * so a disputed balance can be reconstructed without replaying arithmetic.
   */
  async wallet(query: {
    limit: number;
    cursor?: string | undefined;
    q?: string | undefined;
  }): Promise<CursorPage<WalletRow>> {
    const conditions: SQL[] = [];

    if (query.q) {
      const term = `%${query.q}%`;

      conditions.push(sql`(c.full_name ILIKE ${term} OR wt.note ILIKE ${term})`);
    }

    if (query.cursor !== undefined) {
      const after = decodeCursor(query.cursor);

      if (!after) throw new BadRequestException('Malformed pagination cursor.');

      conditions.push(
        sql`(wt.created_at, wt.id) < (${after.sortKey}::timestamptz, ${after.id}::uuid)`,
      );
    }

    const where =
      conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;

    const result = await this.db.execute<{
      id: string;
      customer: string;
      reference: string | null;
      direction: string;
      reason: string;
      amount: string;
      currency: string;
      balance_after: string;
      note: string | null;
      booking_reference: string | null;
      created_at: string;
      at: string;
    }>(sql`
      SELECT wt.id,
             coalesce(c.full_name, '—')  AS customer,
             c.reference                 AS reference,
             wt.direction::text          AS direction,
             wt.reason::text             AS reason,
             wt.amount::text             AS amount,
             cur.code                    AS currency,
             wt.balance_after::text      AS balance_after,
             wt.note                     AS note,
             b.reference                 AS booking_reference,
             wt.created_at,
             to_char(wt.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at
      FROM wallet_transactions wt
      LEFT JOIN wallets w           ON w.id = wt.wallet_id
      LEFT JOIN customer_profiles c ON c.id = w.customer_profile_id
      LEFT JOIN currencies cur      ON cur.id = wt.currency_id
      LEFT JOIN bookings b          ON b.id = wt.booking_id
      ${where}
      ORDER BY wt.created_at DESC, wt.id DESC
      LIMIT ${query.limit + 1}
    `);

    const hasMore = result.rows.length > query.limit;
    const page = hasMore ? result.rows.slice(0, query.limit) : result.rows;
    const last = page.at(-1);

    return {
      items: page.map((row) => ({
        customer: row.customer,
        customerReference: row.reference,
        direction: row.direction,
        reason: row.reason,
        amount: row.amount,
        currency: row.currency,
        balanceAfter: row.balance_after,
        note: row.note,
        bookingReference: row.booking_reference,
        at: row.at,
      })),
      nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null,
    };
  }
}

export interface WalletRow {
  readonly customer: string;
  readonly customerReference: string | null;
  readonly direction: string;
  readonly reason: string;
  readonly amount: string;
  readonly currency: string;
  readonly balanceAfter: string;
  readonly note: string | null;
  readonly bookingReference: string | null;
  readonly at: string;
}
