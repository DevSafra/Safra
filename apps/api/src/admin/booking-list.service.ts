import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { ERROR, type CursorPage, decodeCursor, encodeCursor } from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import { scopeFilter } from '../rbac/scope.sql.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { badRequest } from '../common/errors/app-error.js';

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
  readonly cursor?: string | undefined;
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

  async list(query: BookingListQuery): Promise<CursorPage<BookingListRow>> {
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

    if (query.cursor !== undefined) {
      const after = decodeCursor(query.cursor);

      if (!after) throw badRequest(ERROR.REQUEST_CURSOR_INVALID);

      // Full timestamp precision — several bookings written in one transaction share a
      // `created_at` to the microsecond, and a truncated bound would end the page there.
      conditions.push(
        sql`(b.created_at, b.id) < (${after.sortKey}::timestamptz, ${after.id}::uuid)`,
      );
    }

    const where =
      conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;

    const result = await this.db.execute<{
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
      FROM bookings b
      LEFT JOIN properties p         ON p.id = b.property_id
      LEFT JOIN customer_profiles c  ON c.id = b.customer_profile_id
      LEFT JOIN currencies cur       ON cur.id = b.currency_id
      ${where}
      ORDER BY b.created_at DESC, b.id DESC
      LIMIT ${query.limit + 1}
    `);

    const hasMore = result.rows.length > query.limit;
    const page = hasMore ? result.rows.slice(0, query.limit) : result.rows;
    const last = page.at(-1);

    return {
      items: page.map((row) => ({
        reference: row.reference,
        property: row.property,
        customer: row.customer,
        checkIn: row.check_in,
        checkOut: row.check_out,
        amount: row.amount,
        currency: row.currency,
        status: row.status,
      })),
      nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null,
    };
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
