import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { COUNT_CAP, type OffsetPage, offsetPage } from '@safra/contracts';

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
        ORDER BY b.created_at DESC, b.id DESC
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
   * Counts per status, for the filter's context line.
   *
   * One grouped query over the `(status, created_at)` index rather than a COUNT per status.
   * Deliberately NOT filtered by the search term: the point of the line is to say how much
   * work exists in each state, which a search would misreport.
   */
  async counts(actor?: AccessTokenClaims): Promise<Record<string, number>> {
    const result = await this.db.execute<{ status: string; n: string }>(sql`
      SELECT b.status::text AS status, count(*)::text AS n
      FROM bookings b
      WHERE ${scopeFilter(actor, 'b.city_id')}
      GROUP BY b.status
    `);

    return Object.fromEntries(result.rows.map((row) => [row.status, Number(row.n)]));
  }
}
