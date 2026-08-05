import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { COUNT_CAP, type OffsetPage, offsetPage } from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';

/**
 * بطاقات الهدايا and الكوبونات (design handoff §8).
 *
 * ## They are separate instruments, and stay separate
 *
 * The handoff is explicit — "منفصلة تماماً عن بطاقات الهدايا" — and the distinction is
 * financial, not cosmetic: a gift card is a **liability**. Somebody paid for it, the balance
 * is owed, and it carries forward when a booking costs less than the card. A coupon is a
 * **discount**: nobody paid for it, it reduces revenue at the moment of use and never leaves
 * a balance. Merging them would put a liability and a marketing expense in one ledger view.
 *
 * They share this service only for the paging plumbing, and they have separate screens.
 *
 * ## Codes are never returned
 *
 * `gift_cards` stores `code_hash` and `code_last4`. The console shows the reference and the
 * last four characters, and there is no endpoint that returns a usable code — a screen that
 * displays redeemable codes turns a support console into a way to spend other people's money.
 * A card is reissued, not revealed.
 */
@Injectable()
export class PromotionsService {
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

  async giftCards(query: {
    limit: number;
    page: number;
    q?: string | undefined;
  }): Promise<OffsetPage<GiftCardRow>> {
    const conditions: SQL[] = [sql`g.deleted_at IS NULL`];

    if (query.q) {
      const term = `%${query.q}%`;

      conditions.push(
        sql`(g.reference ILIKE ${query.q + '%'}
             OR g.recipient_name ILIKE ${term}
             OR c.full_name ILIKE ${term})`,
      );
    }

    // One fragment, used by both queries below — see `countOf`.
    const fromWhere = sql`
      FROM gift_cards g
      LEFT JOIN customer_profiles c ON c.id = g.purchased_by_customer_id
      LEFT JOIN currencies cur      ON cur.id = g.currency_id
      WHERE ${sql.join(conditions, sql` AND `)}`;

    const [result, total] = await Promise.all([
      this.db.execute<{
        id: string;
        reference: string;
        code_last4: string;
        original_amount: string;
        remaining_amount: string;
        currency: string;
        status: string;
        expires_at: string | null;
        buyer: string | null;
        recipient: string | null;
        created_at: string;
      }>(sql`
      SELECT g.id, g.reference, g.code_last4,
             g.original_amount::text  AS original_amount,
             g.remaining_amount::text AS remaining_amount,
             cur.code                 AS currency,
             g.status::text           AS status,
             to_char(g.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS expires_at,
             c.full_name              AS buyer,
             g.recipient_name         AS recipient,
             to_char(g.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
               AS created_at
      ${fromWhere}
      ORDER BY g.created_at DESC, g.id DESC
      LIMIT ${query.limit} ${this.pageOffset(query)}
      `),
      this.countOf(fromWhere),
    ]);

    return offsetPage(
      result.rows.map((row) => ({
        reference: row.reference,
        codeLast4: row.code_last4,
        originalAmount: row.original_amount,
        remainingAmount: row.remaining_amount,
        currency: row.currency,
        status: row.status,
        expiresAt: row.expires_at,
        buyer: row.buyer ?? row.recipient,
      })),
      total,
      query,
    );
  }

  async coupons(query: {
    limit: number;
    page: number;
    q?: string | undefined;
  }): Promise<OffsetPage<CouponRow>> {
    const conditions: SQL[] = [sql`cp.deleted_at IS NULL`];

    if (query.q) {
      conditions.push(sql`cp.code ILIKE ${query.q + '%'}`);
    }

    // One fragment, used by both queries below — see `countOf`.
    const fromWhere = sql`
      FROM coupons cp
      LEFT JOIN currencies cur ON cur.id = cp.currency_id
      LEFT JOIN cities ci      ON ci.id = cp.city_id
      LEFT JOIN partners pt    ON pt.id = cp.partner_id
      WHERE ${sql.join(conditions, sql` AND `)}`;

    const [result, total] = await Promise.all([
      this.db.execute<{
        id: string;
        code: string;
        type: string;
        value_kind: string;
        value: string;
        currency: string | null;
        min_booking_amount: string | null;
        redemptions_count: number;
        max_redemptions: number | null;
        starts_at: string;
        ends_at: string;
        is_active: boolean;
        expired: boolean;
        city: string | null;
        partner: string | null;
        created_at: string;
      }>(sql`
      SELECT cp.id, cp.code,
             cp.type::text        AS type,
             cp.value_kind::text  AS value_kind,
             cp.value::text       AS value,
             cur.code             AS currency,
             cp.min_booking_amount::text AS min_booking_amount,
             cp.redemptions_count AS redemptions_count,
             cp.max_redemptions   AS max_redemptions,
             to_char(cp.starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS starts_at,
             to_char(cp.ends_at   AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS ends_at,
             cp.is_active,
             (cp.ends_at < now())  AS expired,
             ci.name_ar           AS city,
             pt.display_name      AS partner,
             to_char(cp.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
               AS created_at
      ${fromWhere}
      ORDER BY cp.created_at DESC, cp.id DESC
      LIMIT ${query.limit} ${this.pageOffset(query)}
      `),
      this.countOf(fromWhere),
    ]);

    return offsetPage(
      result.rows.map((row) => ({
        code: row.code,
        type: row.type,
        valueKind: row.value_kind,
        value: row.value,
        currency: row.currency,
        minBookingAmount: row.min_booking_amount,
        redemptionsCount: row.redemptions_count,
        maxRedemptions: row.max_redemptions,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        isActive: row.is_active,
        expired: row.expired,
        scope: row.city ?? row.partner,
      })),
      total,
      query,
    );
  }
}

export interface GiftCardRow {
  readonly reference: string;
  readonly codeLast4: string;
  readonly originalAmount: string;
  readonly remainingAmount: string;
  readonly currency: string;
  readonly status: string;
  readonly expiresAt: string | null;
  readonly buyer: string | null;
}

export interface CouponRow {
  readonly code: string;
  readonly type: string;
  readonly valueKind: string;
  readonly value: string;
  readonly currency: string | null;
  readonly minBookingAmount: string | null;
  readonly redemptionsCount: number;
  readonly maxRedemptions: number | null;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly isActive: boolean;
  readonly expired: boolean;
  /** City name or partner name when the coupon is scoped to one. */
  readonly scope: string | null;
}
