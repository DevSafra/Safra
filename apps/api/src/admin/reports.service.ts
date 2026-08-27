import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';

import { DATABASE } from '../database/database.module.js';
import { scopeFilter } from '../rbac/scope.sql.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

export interface ReportCard {
  readonly key:
    | 'commission_revenue'
    | 'ad_revenue'
    | 'occupancy'
    | 'cancellations'
    | 'partner_response';
  /** The headline figure, already formatted as a decimal string. */
  readonly value: string;
  /** Same measure over the previous period, so the UI can state the delta honestly. */
  readonly previous: string | null;
  /** Eight buckets, oldest first, for the sparkline. */
  readonly series: readonly { readonly bucket: string; readonly value: string }[];
}

/** How many weekly buckets the design's sparkline shows. */
const BUCKETS = 8;

/**
 * التقارير (design handoff §8).
 *
 * Four measures, each with a value, the previous period for comparison, and eight weekly
 * buckets for the sparkline. The design shows a trend string like "↑ 14٪ عن حزيران"; that
 * arrow is COMPUTED here from `previous` rather than stored, because a hardcoded direction is
 * the easiest thing in a dashboard to leave pointing the wrong way after a bad month.
 *
 * ## Occupancy is honest about what it measures
 *
 * True occupancy is booked-nights ÷ available-nights, and available-nights lives in
 * `availability_days`, which the dev database has barely populated. Rather than divide by a
 * number that is nearly zero and print 4,000%, this reports the ratio over the units that have
 * ANY availability recorded, and the UI labels it as such. An impressive wrong number is worse
 * than a modest correct one.
 *
 * ## Weekly buckets, generated not inferred
 *
 * `generate_series` produces all eight weeks whether or not they contain rows, so a quiet week
 * renders as a zero bar rather than shifting every later bar one place left — which would make
 * the last two "recent" bars in the design highlight the wrong weeks.
 */
@Injectable()
export class ReportsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async cards(actor?: AccessTokenClaims): Promise<ReportCard[]> {
    const [revenue, ads, occupancy, cancellations, response] = await Promise.all([
      this.commissionRevenue(actor),
      this.adRevenue(actor),
      this.occupancy(actor),
      this.cancellations(actor),
      this.partnerResponse(actor),
    ]);

    /* Beside the commission, because they are SAFRA's two revenue streams and read as a pair. */
    return [revenue, ads, occupancy, cancellations, response];
  }

  /**
   * SAFRA's own revenue: the 7% partner commission plus the flat customer fee.
   *
   * Never the booking total — that is the partner's money passing through. Getting this wrong
   * would overstate revenue by roughly fourteen times.
   */
  private async commissionRevenue(actor?: AccessTokenClaims): Promise<ReportCard> {
    const result = await this.db.execute<{ bucket: string; value: string }>(sql`
      WITH weeks AS (
        SELECT generate_series(
          date_trunc('week', current_date) - interval '${sql.raw(String(BUCKETS - 1))} weeks',
          date_trunc('week', current_date),
          interval '1 week'
        ) AS bucket
      )
      SELECT to_char(w.bucket, 'YYYY-MM-DD') AS bucket,
             coalesce(sum(b.partner_commission_amount + b.customer_fee_amount), 0)::text
               AS value
      FROM weeks w
      LEFT JOIN bookings b
        ON date_trunc('week', b.created_at) = w.bucket
       AND b.status IN ('confirmed','checked_in','completed')
       AND ${scopeFilter(actor, 'b.city_id')}
      GROUP BY w.bucket
      ORDER BY w.bucket
    `);

    return this.card('commission_revenue', result.rows);
  }

  /**
   * SAFRA's OTHER revenue: what advertisers actually paid (§9.3).
   *
   * ## Why it is here at all
   *
   * Bashar, 2026-08-27: «I do not want advertising revenue to be accounted for in the ledger but
   * invisible in reporting.» It posts `ad_payment` ↔ `ad_revenue` the moment an invoice is recorded
   * as paid, and every figure derived from the books carried it — while التقارير, the screen
   * somebody opens to ask what the platform earns, counted only booking commission. A revenue
   * stream that exists in the accounts and not on the report is a report that is quietly wrong.
   *
   * ## Read from the INVOICE, not from the ledger
   *
   * The two are the same number by construction — `AdInvoiceService.markPaid` posts the pair in the
   * same transaction as the status change, so an invoice is `paid` if and only if the legs exist.
   * The invoice is used because a ledger entry has no city: `ad_revenue` legs carry no
   * `booking_id` and no `partner_id`, so there is nothing to narrow by, and every other card on
   * this screen is scoped. Reaching the city through `ad_campaigns` is what makes this card obey
   * the same rule as the rest of the screen.
   *
   * `paid_at`, not `created_at`: an invoice issued in March and settled in May is May's revenue,
   * which is the whole reason the ledger posts on payment rather than on issue.
   */
  private async adRevenue(actor?: AccessTokenClaims): Promise<ReportCard> {
    const result = await this.db.execute<{ bucket: string; value: string }>(sql`
      WITH weeks AS (
        SELECT generate_series(
          date_trunc('week', current_date) - interval '${sql.raw(String(BUCKETS - 1))} weeks',
          date_trunc('week', current_date),
          interval '1 week'
        ) AS bucket
      )
      SELECT to_char(w.bucket, 'YYYY-MM-DD') AS bucket,
             coalesce(sum(i.amount), 0)::text AS value
      FROM weeks w
      LEFT JOIN ad_invoices i
        ON date_trunc('week', i.paid_at) = w.bucket
       AND i.status = 'paid'
       AND i.deleted_at IS NULL
      LEFT JOIN ad_campaigns c ON c.id = i.campaign_id
      WHERE i.id IS NULL OR ${scopeFilter(actor, 'c.city_id')}
      GROUP BY w.bucket
      ORDER BY w.bucket
    `);

    return this.card('ad_revenue', result.rows);
  }

  /** Booked nights against recorded availability — see the class note on what this measures. */
  private async occupancy(actor?: AccessTokenClaims): Promise<ReportCard> {
    const result = await this.db.execute<{ bucket: string; value: string }>(sql`
      WITH weeks AS (
        SELECT generate_series(
          date_trunc('week', current_date) - interval '${sql.raw(String(BUCKETS - 1))} weeks',
          date_trunc('week', current_date),
          interval '1 week'
        ) AS bucket
      )
      -- availability_days has a COMPOSITE primary key (unit_id, date) and no id column, so the
      -- counts are over a.unit_id. count(*) would count the generated week row itself on a week
      -- with no availability and report 0% occupancy of one phantom day.
      SELECT to_char(w.bucket, 'YYYY-MM-DD') AS bucket,
             CASE WHEN count(a.unit_id) = 0 THEN '0'
                  ELSE round(
                    100.0 * count(a.unit_id) FILTER (WHERE a.status = 'booked')
                    / count(a.unit_id), 1)::text
             END AS value
      FROM weeks w
      -- Occupancy scopes through the unit's property, which is the only city an availability
      -- day has. A scoped member sees the occupancy of their own cities, which is the number
      -- they can act on.
      LEFT JOIN availability_days a
        ON date_trunc('week', a.date) = w.bucket
      LEFT JOIN units u     ON u.id = a.unit_id
      LEFT JOIN properties pr ON pr.id = u.property_id
      WHERE ${scopeFilter(actor, 'pr.city_id')}
      GROUP BY w.bucket
      ORDER BY w.bucket
    `);

    return this.card('occupancy', result.rows);
  }

  /** Cancellation rate as a percentage of bookings created in the week. */
  private async cancellations(actor?: AccessTokenClaims): Promise<ReportCard> {
    const result = await this.db.execute<{ bucket: string; value: string }>(sql`
      WITH weeks AS (
        SELECT generate_series(
          date_trunc('week', current_date) - interval '${sql.raw(String(BUCKETS - 1))} weeks',
          date_trunc('week', current_date),
          interval '1 week'
        ) AS bucket
      )
      SELECT to_char(w.bucket, 'YYYY-MM-DD') AS bucket,
             CASE WHEN count(b.id) = 0 THEN '0'
                  ELSE round(
                    100.0 * count(b.id) FILTER (WHERE b.status = 'cancelled')
                    / count(b.id), 1)::text
             END AS value
      FROM weeks w
      LEFT JOIN bookings b ON date_trunc('week', b.created_at) = w.bucket
       AND ${scopeFilter(actor, 'b.city_id')}
      GROUP BY w.bucket
      ORDER BY w.bucket
    `);

    return this.card('cancellations', result.rows);
  }

  /**
   * Median minutes from payment to partner response.
   *
   * Median, not mean: one partner who never answered until the two-hour deadline expired drags
   * a mean far enough to hide that everybody else replies in minutes. The SLA is what matters
   * operationally, and the median is what tells you whether it is being met.
   */
  private async partnerResponse(actor?: AccessTokenClaims): Promise<ReportCard> {
    const result = await this.db.execute<{ bucket: string; value: string }>(sql`
      WITH weeks AS (
        SELECT generate_series(
          date_trunc('week', current_date) - interval '${sql.raw(String(BUCKETS - 1))} weeks',
          date_trunc('week', current_date),
          interval '1 week'
        ) AS bucket
      )
      SELECT to_char(w.bucket, 'YYYY-MM-DD') AS bucket,
             coalesce(round(
               percentile_cont(0.5) WITHIN GROUP (
                 ORDER BY extract(epoch FROM (b.partner_responded_at - b.paid_at)) / 60
               )::numeric, 0), 0)::text AS value
      FROM weeks w
      LEFT JOIN bookings b
        ON date_trunc('week', b.created_at) = w.bucket
       AND b.paid_at IS NOT NULL
       AND b.partner_responded_at IS NOT NULL
       AND ${scopeFilter(actor, 'b.city_id')}
      GROUP BY w.bucket
      ORDER BY w.bucket
    `);

    return this.card('partner_response', result.rows);
  }

  /**
   * Shapes a bucket series into a card.
   *
   * The headline is the LAST bucket (the current week) and `previous` is the one before it, so
   * the arrow the UI draws compares like with like. A single-bucket result yields a null
   * previous rather than a fabricated 0% change.
   */
  private card(
    key: ReportCard['key'],
    rows: readonly { bucket: string; value: string }[],
  ): ReportCard {
    const current = rows.at(-1)?.value ?? '0';
    const previous = rows.length >= 2 ? (rows.at(-2)?.value ?? null) : null;

    return { key, value: current, previous, series: rows };
  }
}
