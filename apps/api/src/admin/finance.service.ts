import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { COUNT_CAP, type OffsetPage, offsetPage } from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import { scopeFilter } from '../rbac/scope.sql.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { currencyTotals, type CurrencyTotal } from './currency-totals.js';

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

/** Each card is one figure PER CURRENCY — see `currency-totals.ts` for why never one across them. */
export interface FinanceCounters {
  readonly captured_today: CurrencyTotal[];
  readonly refunded_today: CurrencyTotal[];
  readonly fines_collected_month: CurrencyTotal[];
  /** Advertising settled this month — the platform's second revenue stream (§9.3). */
  readonly ad_revenue_month: CurrencyTotal[];
  readonly partner_payable_outstanding: CurrencyTotal[];
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
   * The four KPI cards.
   *
   * Amounts come from `ledger_entries`, not from `payments.amount`, because the ledger is the
   * balanced double-entry record and is immutable by trigger — a captured payment that was
   * later partially refunded shows correctly here and would be overstated if read from the
   * payment row. `partner_payable_outstanding` is what SAFRA owes and has not paid.
   */
  async counters(actor?: AccessTokenClaims): Promise<FinanceCounters> {
    /*
      Every card under the same scope as the table beneath it, and each summed per currency.

      Two defects were in the version this replaces. Captured, refunded and fines read the whole
      ledger, so a member limited to Aleppo saw what the country took today above a table showing
      only Aleppo. And every card added amounts in whatever currency each row was written in,
      then printed the sum with ONE code — a legacy SYP entry beside a day of dollar captures.

      A ledger leg reaches its city through its booking, and a fine through its booking or else
      its partner, which is exactly how the table's own branches scope them. A leg with no booking
      (a gift card sold) has no city and is platform-level, which `scopeFilter` allows.
    */
    const scoped = (column: string): SQL => scopeFilter(actor, column);

    const result = await this.db.execute<{
      metric: keyof FinanceCounters;
      currency: string;
      amount: string;
    }>(sql`
      SELECT 'captured_today' AS metric, cur.code AS currency, sum(l.amount)::text AS amount
        FROM ledger_entries l
        JOIN currencies cur  ON cur.id = l.currency_id
        LEFT JOIN bookings b ON b.id = l.booking_id
        WHERE l.account = 'customer_payment' AND l.direction = 'credit'
          AND l.created_at >= current_date
          AND ${scoped('b.city_id')}
        GROUP BY cur.code
      UNION ALL
      SELECT 'refunded_today', cur.code, sum(l.amount)::text
        FROM ledger_entries l
        JOIN currencies cur  ON cur.id = l.currency_id
        LEFT JOIN bookings b ON b.id = l.booking_id
        WHERE l.account = 'refund' AND l.direction = 'debit'
          AND l.created_at >= current_date
          AND ${scoped('b.city_id')}
        GROUP BY cur.code
      UNION ALL
      SELECT 'fines_collected_month', cur.code, sum(v.fine_amount)::text
        FROM partner_violations v
        JOIN currencies cur  ON cur.id = v.fine_currency_id
        LEFT JOIN bookings b ON b.id = v.booking_id
        LEFT JOIN partners p ON p.id = v.partner_id
        WHERE v.collected_at IS NOT NULL
          AND v.collected_at >= date_trunc('month', current_date)
          AND ${scoped('coalesce(b.city_id, p.city_id)')}
        GROUP BY cur.code
      UNION ALL
      -- Advertising settled this month (§9.3). From the INVOICE rather than from the ledger, for
      -- the same reason the report card is: an ad_revenue leg carries no city, and every other
      -- figure on this screen is scoped. The two are the same number by construction -- markPaid
      -- posts the pair in the transaction that sets the status.
      SELECT 'ad_revenue_month', cur.code, sum(i.amount)::text
        FROM ad_invoices i
        JOIN ad_campaigns c ON c.id = i.campaign_id
        JOIN currencies cur ON cur.id = i.currency_id
        WHERE i.status = 'paid' AND i.deleted_at IS NULL
          AND i.paid_at >= date_trunc('month', current_date)
          AND ${scoped('c.city_id')}
        GROUP BY cur.code
      UNION ALL
      SELECT 'partner_payable_outstanding', cur.code, sum(b.partner_payable_amount)::text
        FROM bookings b
        JOIN currencies cur ON cur.id = b.currency_id
        WHERE b.status IN ('confirmed','checked_in','completed')
          AND ${scoped('b.city_id')}
        GROUP BY cur.code
    `);

    /*
      A metric with no rows is an empty list, which the screen renders as a zero in the platform
      currency: «nothing today» is a statement it can make, and one the rows support.
    */
    const of = (metric: keyof FinanceCounters): CurrencyTotal[] =>
      currencyTotals(result.rows.filter((row) => row.metric === metric));

    return {
      captured_today: of('captured_today'),
      refunded_today: of('refunded_today'),
      fines_collected_month: of('fines_collected_month'),
      ad_revenue_month: of('ad_revenue_month'),
      partner_payable_outstanding: of('partner_payable_outstanding'),
    };
  }

  async list(query: {
    limit: number;
    page: number;
    q?: string | undefined;
    actor?: AccessTokenClaims | undefined;
  }): Promise<OffsetPage<FinanceRow>> {
    /*
      Scope is applied per union branch, not to the union, so each branch keeps its own index. A
      fine has no booking city of its own and falls back to the partner's, which is where the
      violation was earned.
    */
    const scoped = (column: string): SQL => scopeFilter(query.actor, column);
    const term = query.q ? `%${query.q}%` : null;

    /*
      The search predicate is repeated per branch rather than applied to the union, so each
      branch stays index-eligible. `null` short-circuits to TRUE, which Postgres folds away.
    */
    const search = (columns: SQL): SQL =>
      term === null ? sql`TRUE` : sql`(${columns} ILIKE ${term})`;

    /*
      The whole union is the fragment, so the count runs over exactly the rows the list pages
      through. Three branches, one total — a per-branch count would be three numbers nobody
      asked for and would not add up to the page count anyway.
    */
    const fromWhere = sql`FROM (
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
        WHERE ${scoped('b.city_id')}
          AND ${search(sql`pay.reference || ' ' || coalesce(b.reference,'')`)}

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
        WHERE ${scoped('b2.city_id')}
          AND ${search(sql`coalesce(pay2.reference,'') || ' ' || coalesce(b2.reference,'')`)}

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
        WHERE ${scoped('coalesce(b3.city_id, p.city_id)')}
          AND ${search(sql`coalesce(p.reference,'') || ' ' || coalesce(b3.reference,'')`)}
          -- Only violations that CARRY a fine, and the omission of this broke the whole screen.
          --
          -- الدفع is money. A violation at 'recorded' or 'warned' -- the first two rungs of the
          -- enforcement ladder, and the ordinary state of a violation nobody has fined -- has a
          -- NULL fine_amount, and this branch selected it anyway with a NULL amount and a NULL
          -- currency. financeItemSchema types both as a required string, so the CONSOLE's parse of
          -- the whole response failed and the page rendered «تعذّر تحميل هذه القائمة» -- no table,
          -- no counters, no pagination bar. One un-fined violation took الدفع down entirely.
          --
          -- It survived because of ORDERING, which is the only reason this was not found long ago:
          -- rows come back newest first, and the one un-fined violation in the fixture data sat
          -- thousands of rows deep where no page ever parsed it. Recording a violation -- the first
          -- thing the ladder asks anybody to do -- puts one on page one.
          --
          -- fine_currency_id is checked too. Nothing enforces the pair (there is no CHECK on this
          -- table), so a fine whose currency went missing would fail the parse the same way; that
          -- is a data defect worth its own constraint, recorded in FUTURE-WORK rather than left as
          -- a way for this screen to die again.
          --
          -- Written as SQL comments, not a JS block comment: this text lives INSIDE a tagged SQL
          -- template, where a backtick would end the template and a JS comment is just more SQL.
          AND v.fine_amount IS NOT NULL
          AND v.fine_currency_id IS NOT NULL
      ) rows`;

    const [result, total] = await Promise.all([
      this.db.execute<{
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
      SELECT * ${fromWhere}
      ORDER BY rows.created_at DESC, rows.id DESC
      LIMIT ${query.limit} ${this.pageOffset(query)}
      `),
      this.countOf(fromWhere),
    ]);

    return offsetPage(
      result.rows.map((row) => ({
        reference: row.reference,
        linkedTo: row.linked_to,
        method: row.method,
        kind: row.kind,
        amount: row.amount,
        currency: row.currency,
        status: row.status,
        at: row.at,
      })),
      total,
      query,
    );
  }

  /** The keyset bound, applied per union branch so each keeps its own index. */

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
    page: number;
    q?: string | undefined;
  }): Promise<OffsetPage<WalletRow>> {
    /*
      NOT scoped, deliberately. A wallet belongs to a CUSTOMER, and a customer belongs to no city —
      they book in Latakia in July and Damascus in August. Scoping this by the booking a transaction
      happens to reference would show a partial balance history, which is worse than none: somebody
      would reconcile against it. Recorded in the enforcement rules.
    */
    const conditions: SQL[] = [];

    if (query.q) {
      const term = `%${query.q}%`;

      conditions.push(sql`(c.full_name ILIKE ${term} OR wt.note ILIKE ${term})`);
    }

    const where =
      conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;

    // One fragment, used by both queries below — see `countOf`.
    const fromWhere = sql`
      FROM wallet_transactions wt
      LEFT JOIN wallets w           ON w.id = wt.wallet_id
      LEFT JOIN customer_profiles c ON c.id = w.customer_profile_id
      LEFT JOIN currencies cur      ON cur.id = wt.currency_id
      LEFT JOIN bookings b          ON b.id = wt.booking_id
      ${where}`;

    const [result, total] = await Promise.all([
      this.db.execute<{
        id: string;
        customer: string;
        reference: string | null;
        customer_active: boolean;
        direction: string;
        reason: string;
        amount: string;
        restricted: string;
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
             (c.id IS NOT NULL AND c.deleted_at IS NULL) AS customer_active,
             wt.direction::text          AS direction,
             wt.reason::text             AS reason,
             wt.amount::text             AS amount,
             wt.restricted_amount::text  AS restricted,
             cur.code                    AS currency,
             wt.balance_after::text      AS balance_after,
             wt.note                     AS note,
             b.reference                 AS booking_reference,
             wt.created_at,
             to_char(wt.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at
      ${fromWhere}
      ORDER BY wt.created_at DESC, wt.id DESC
      LIMIT ${query.limit} ${this.pageOffset(query)}
      `),
      this.countOf(fromWhere),
    ]);

    return offsetPage(
      result.rows.map((row) => ({
        customer: row.customer,
        customerReference: row.reference,
        /*
          Whether that customer still has a record to open.

          المحفظة keeps showing a movement whose profile was removed — it is a financial record and
          hiding it would hide money — but العملاء filters deleted profiles out, so a link to one
          answers 404. The row says which it is rather than the console guessing from the reference.
        */
        customerActive: row.customer_active,
        direction: row.direction,
        reason: row.reason,
        amount: row.amount,
        /*
          How much of this movement was money that cannot be paid out.

          On the ROW rather than only on the customer's record: المحفظة is where a disputed
          movement is read, and «40.00 credited» does not say whether SAFRA handed out goodwill or
          returned somebody their own money — which is the difference between what may leave and
          what may not.
        */
        restrictedAmount: row.restricted,
        currency: row.currency,
        balanceAfter: row.balance_after,
        note: row.note,
        bookingReference: row.booking_reference,
        at: row.at,
      })),
      total,
      query,
    );
  }
}

export interface WalletRow {
  readonly customer: string;
  readonly customerReference: string | null;
  readonly direction: string;
  readonly reason: string;
  readonly amount: string;
  /** How much of `amount` was money that may never be paid out. */
  readonly restrictedAmount: string;
  readonly currency: string;
  readonly balanceAfter: string;
  readonly note: string | null;
  readonly bookingReference: string | null;
  readonly at: string;
}
