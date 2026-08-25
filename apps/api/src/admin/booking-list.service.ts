import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';

import type { Database } from '@safra/db';
import {
  ARRIVAL_ALERT_HOURS,
  type BookingAttention,
  COUNT_CAP,
  SLA_EXPIRY_WARNING_MINUTES,
  type OffsetPage,
  offsetPage,
} from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import { scopeFilter } from '../rbac/scope.sql.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

export interface BookingListRow {
  readonly reference: string;
  readonly property: string;
  readonly customer: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly amount: string;
  readonly currency: string;
  readonly status: string;
}

export interface BookingListQuery {
  /** The caller, for geographic scope enforcement (§8.2). */
  readonly actor?: AccessTokenClaims | undefined;
  readonly limit: number;
  /** 1-based. The screen shows it, so the API speaks in the same terms. */
  readonly page: number;
  readonly status?: string | undefined;
  readonly q?: string | undefined;
  /**
   * §6.4's confirmation window about to lapse — the dashboard's EC-008 alert, as a list.
   *
   * A boolean rather than a window the caller chooses, because the COUNT on the dashboard and the
   * ROWS in this list have to agree. `SLA_EXPIRY_WARNING_MINUTES` is the single definition both read.
   */
  readonly expiring?: boolean | undefined;
  /**
   * The dashboard alert this view answers, if any (EC-004, EC-011).
   *
   * Same contract as `expiring`: every predicate here is the one the counter uses, from the same
   * constant, so an alert saying nine and a list showing six is not expressible.
   */
  readonly attention?: BookingAttention | undefined;
}

/**
 * The bookings registry (SRS §9.3 الحجوزات, design handoff §8).
 *
 * ## Why this exists when §9.4 is a lookup by reference
 *
 * It was argued — in this codebase, in a comment — that a browsable index of every booking is
 * "a privacy surface with no operational use". That was wrong, and the design says so: the
 * handoff's الحجوزات section is a filterable table, because the operational question is not
 * only "show me BKG-2026-000431" but "show me everything stuck in قيد التأكيد right now".
 * You cannot answer the second one from a lookup box.
 *
 * The privacy concern is real and is addressed by scope rather than by absence: the list
 * returns a customer's NAME and no contact details, no payment instrument and no internal
 * notes. Those live on the detail screen behind their own permissions.
 *
 * ## Search
 *
 * Matches the reference, the property name or the customer name. The reference match is
 * anchored (`LIKE 'x%'`) so it uses the unique index; the name matches cannot be, and are
 * bounded by the keyset page rather than by a full scan — `q` is only ever applied together
 * with `LIMIT`, and the ordering index carries the scan.
 */
/**
 * How many bookings sit in each status, and whether any of those figures hit the cap.
 *
 * `capped` is part of the answer rather than something a reader infers, for the same reason
 * `offsetPage` carries it: a total that stopped counting at `COUNT_CAP` must be rendered as
 * «أكثر من…» and never as an exact number.
 */
export interface BookingCounts {
  readonly byStatus: Record<string, number>;
  readonly capped: boolean;
}

@Injectable()
export class BookingListService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * The row count for a page, over the SAME `FROM … WHERE` the list uses.
   *
   * Sharing one fragment between the list and the count is the point, not tidiness: a count built
   * from a separately written predicate drifts from the list it describes, and a total that
   * disagrees with what the table can page through is worse than showing no total.
   */
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

  async list(query: BookingListQuery): Promise<OffsetPage<BookingListRow>> {
    // Geographic scope first, so it can never be forgotten behind a later `if`.
    const conditions: SQL[] = [scopeFilter(query.actor, 'b.city_id')];

    if (query.status) {
      /**
       * Cast rather than interpolate. The value is already validated against the enum by the
       * controller's schema, so this is defence in depth: a value that somehow reached here
       * unvalidated fails as a Postgres cast error, never as injected SQL.
       */
      conditions.push(sql`b.status = ${query.status}::booking_status`);
    }

    if (query.expiring) {
      /*
        The same predicate the dashboard counts, so the alert and this list cannot disagree.

        `bookings_sla_idx` is (status, confirmation_deadline_at) WHERE status = 'pending_confirmation',
        which serves exactly this — the status term is implied by the partial index and stated anyway,
        because a filter that depended on the index's WHERE clause to be correct would break silently
        if the index were ever redefined.
      */
      conditions.push(sql`
        b.status = 'pending_confirmation'::booking_status
        AND b.confirmation_deadline_at IS NOT NULL
        AND b.confirmation_deadline_at
              <= now() + (${SLA_EXPIRY_WARNING_MINUTES}::int * INTERVAL '1 minute')`);
    }

    /*
      EC-011 — arrived by the calendar, and nobody recorded it.

      In the PROPERTY's timezone, exactly as the counter computes it.

      A correlated subquery rather than a join, deliberately: `fromWhere` is shared by the list and
      its count (the house rule — a total must never describe a different set), and adding a join
      there would make every OTHER view of this registry pay for a filter that is usually off. The
      status term bounds this to the few hundred `confirmed` rows, which is what makes an unindexed
      date comparison acceptable here and would not be over the whole table.
    */
    if (query.attention === 'no_check_in') {
      conditions.push(sql`
        b.status = 'confirmed'::booking_status
        AND b.checked_in_at IS NULL
        AND b.check_in < ((now() AT TIME ZONE
              (SELECT ci.timezone FROM cities ci WHERE ci.id = b.city_id))
              - (${ARRIVAL_ALERT_HOURS}::int * INTERVAL '1 hour'))::date`);
    }

    /* EC-004 — answered by the partner and never moved. Should be empty; see the counter. */
    if (query.attention === 'unconfirmed') {
      conditions.push(sql`
        b.status = 'pending_confirmation'::booking_status
        AND b.partner_responded_at IS NOT NULL`);
    }

    if (query.q) {
      const term = `%${query.q}%`;

      conditions.push(
        sql`(b.reference ILIKE ${query.q + '%'}
             OR p.name_ar ILIKE ${term}
             OR p.name_en ILIKE ${term}
             OR c.full_name ILIKE ${term})`,
      );
    }

    const where =
      conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;

    // One fragment, used by both queries below — see `countOf`.
    const fromWhere = sql`
      FROM bookings b
      LEFT JOIN properties p         ON p.id = b.property_id
      LEFT JOIN customer_profiles c  ON c.id = b.customer_profile_id
      LEFT JOIN currencies cur       ON cur.id = b.currency_id
      ${where}`;

    const [result, total] = await Promise.all([
      this.db.execute<{
        id: string;
        reference: string;
        property: string;
        customer: string;
        check_in: string;
        check_out: string;
        amount: string;
        currency: string;
        status: string;
        created_at: string;
      }>(sql`
      SELECT b.id, b.reference,
             coalesce(p.name_ar, p.name_en, '—') AS property,
             coalesce(c.full_name, '—')          AS customer,
             to_char(b.check_in,  'YYYY-MM-DD')  AS check_in,
             to_char(b.check_out, 'YYYY-MM-DD')  AS check_out,
             b.total_amount::text                AS amount,
             cur.code                            AS currency,
             b.status::text                      AS status,
             to_char(b.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
               AS created_at
        ${fromWhere}
        /*
          Soonest-first when the filter is the expiring one, newest-first otherwise.

          An operator opening "twelve expiring soon" needs the one with four minutes left at the top;
          created_at DESC would put the newest booking there, which is the one with the MOST time.
          The id breaks the tie either way, so the order is total and a page cannot repeat a row.
        */
        ORDER BY
          ${query.expiring ? sql`b.confirmation_deadline_at ASC` : sql`b.created_at DESC`},
          b.id DESC
        LIMIT ${query.limit} ${this.pageOffset(query)}
      `),
      this.countOf(fromWhere),
    ]);

    return offsetPage(
      result.rows.map((row) => ({
        reference: row.reference,
        property: row.property,
        customer: row.customer,
        checkIn: row.check_in,
        checkOut: row.check_out,
        amount: row.amount,
        currency: row.currency,
        status: row.status,
      })),
      total,
      query,
    );
  }

  /**
   * Counts per status, for the filter's context line — each CAPPED at `COUNT_CAP`.
   *
   * Deliberately NOT filtered by the search term: the point of the line is to say how much work
   * exists in each state, which a search would misreport.
   *
   * ## Why this is a count per status rather than one GROUP BY
   *
   * It was `GROUP BY b.status` with no cap, and its comment claimed it ran "over the
   * `(status, created_at)` index" — an index that did not exist. Grouping by a non-leading column
   * has only one plan available: read the whole table. Measured against 5,000,061 rows on
   * 2026-08-20 it touched 239,855 buffers, on every page view of the registry, and returned exact
   * figures the console then summed and printed — beside a pagination bar that correctly said
   * «أكثر من ١٠٠٠٠». Two totals on one screen, one of them paid for by a full scan.
   *
   * `enum_range` gives the statuses from the type rather than a list here, so a status added to the
   * enum appears without anybody remembering this file. Each count runs over its own
   * `LIMIT COUNT_CAP + 1` subquery on `bookings_status_created_idx`, which makes every one of them a
   * bounded range scan — including a status with no rows, which previously cost a full index scan to
   * prove.
   *
   * `capped` travels with the numbers because a capped figure must never be printed as an exact one.
   */
  async counts(actor?: AccessTokenClaims): Promise<BookingCounts> {
    const result = await this.db.execute<{ status: string; n: string }>(sql`
      SELECT s.status::text AS status, c.n::text AS n
      FROM unnest(enum_range(NULL::booking_status)) AS s(status)
      CROSS JOIN LATERAL (
        SELECT count(*) AS n FROM (
          SELECT 1 FROM bookings b
          WHERE b.status = s.status
            AND ${scopeFilter(actor, 'b.city_id')}
          LIMIT ${COUNT_CAP + 1}
        ) capped
      ) c
      WHERE c.n > 0
    `);

    const byStatus = Object.fromEntries(
      result.rows.map((row) => [row.status, Number(row.n)]),
    );

    return {
      byStatus,
      capped: Object.values(byStatus).some((n) => n > COUNT_CAP),
    };
  }
}
