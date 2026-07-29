import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { type SearchQuery, evaluateArrival } from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import { SettingsService } from '../settings/settings.service.js';

export interface SearchResultItem {
  propertyReference: string;
  slug: string;
  nameAr: string;
  nameEn: string;
  citySlug: string;
  cityNameAr: string;
  propertyTypeCode: string;
  rating: string | null;
  reviewsCount: number;
  badges: string[];
  recommendationScore: string;
  cancellationPolicyCode: string;
  /** Cheapest bookable unit for the requested dates and party size. */
  unitId: string;
  nightlyFrom: string;
  stayTotal: string;
  currencyCode: string;
  nights: number;
}

export interface SearchResult {
  items: SearchResultItem[];
  nextCursor: string | null;
  /** Echoed so the UI can explain a shifted date (§5.3). */
  firstBookableDate: string;
}

@Injectable()
export class SearchService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Availability-aware property search (SRS §5.2, §5.3, §5.5).
   *
   * Expressed as one SQL statement rather than fetching candidates and filtering
   * in TypeScript. At the target scale, "load properties then check each one" is
   * an N+1 that no amount of caching rescues — the database can answer
   * availability with two anti-joins over indexed columns instead.
   */
  async search(query: SearchQuery, now: Date = new Date()): Promise<SearchResult> {
    const guests = query.adults + query.children; // Infants do not occupy a bed.

    // ── Same-day cutoff, per city local time (§5.3) ──────────────────────────
    const cutoffHour = await this.settings.getNumber('booking.same_day_cutoff_hour', 17);
    const timezone = await this.resolveTimezone(query.citySlug);
    const verdict = evaluateArrival(query.checkIn, now, timezone, cutoffHour);

    if (!verdict.allowed) {
      throw new BadRequestException({
        message:
          verdict.reason === 'same_day_closed'
            ? "Today's bookings have closed. The first available arrival date is later."
            : 'The arrival date is in the past.',
        reason: verdict.reason,
        firstBookableDate: verdict.firstBookableDate,
      });
    }

    const maxNights = await this.settings.getNumber('search.max_nights', 90);
    const nights = Math.round(
      (Date.parse(`${query.checkOut}T00:00:00Z`) -
        Date.parse(`${query.checkIn}T00:00:00Z`)) /
        86_400_000,
    );

    if (nights > maxNights) {
      throw new BadRequestException(`A stay may not exceed ${maxNights} nights.`);
    }

    /**
     * Ordering. §5.5 is explicit that the default must NOT be cheapest-first but
     * "recommended by SAFRA" — so `recommended` leads on recommendationScore,
     * which a worker computes from partner score, rating, response speed,
     * cancellation rate and data completeness.
     */
    const orderBy = {
      // These reference the snake_case sort aliases from the `candidates` CTE, not
      // the quoted camelCase output columns — unquoted identifiers fold to
      // lowercase, so "stayTotal" is not reachable as c.stay_total.
      recommended: sql`c.recommendation_score DESC, c.rating DESC NULLS LAST, c.stay_total_sort ASC`,
      price_asc: sql`c.stay_total_sort ASC, c.recommendation_score DESC`,
      price_desc: sql`c.stay_total_sort DESC, c.recommendation_score DESC`,
      rating_desc: sql`c.rating DESC NULLS LAST, c.recommendation_score DESC`,
    }[query.sort];

    const rows = await this.db.execute<Record<string, unknown>>(sql`
      WITH bookable AS (
        SELECT
          u.id                AS unit_id,
          u.property_id,
          u.currency_id,
          -- Sum the ACTUAL nightly prices across the stay: a per-day override
          -- (availability_days.price) wins over the unit's base price, so a
          -- seasonal or weekend rate is reflected in the total the guest sees.
          (
            SELECT SUM(COALESCE(ad.price, u.base_price))
            FROM generate_series(
              ${query.checkIn}::date,
              ${query.checkOut}::date - INTERVAL '1 day',
              INTERVAL '1 day'
            ) AS d(day)
            LEFT JOIN availability_days ad
              ON ad.unit_id = u.id AND ad.date = d.day::date
          ) AS stay_total
        FROM units u
        JOIN properties p ON p.id = u.property_id
        WHERE u.is_active
          AND u.deleted_at IS NULL
          AND p.deleted_at IS NULL
          -- §8.1 / P-002: only verified, published inventory is ever searchable.
          AND p.status = 'published'
          AND u.max_guests >= ${guests}
          AND ${nights} >= u.min_nights
          AND (u.max_nights IS NULL OR ${nights} <= u.max_nights)

          -- Anti-join 1: no day in the range is closed, booked or under
          -- maintenance. An ABSENT row means available — §8.4 puts the burden on
          -- the partner to close dates, so units are open by default rather than
          -- requiring 365 rows before a listing can sell.
          AND NOT EXISTS (
            SELECT 1 FROM availability_days ad
            WHERE ad.unit_id = u.id
              AND ad.date >= ${query.checkIn}::date
              AND ad.date <  ${query.checkOut}::date
              AND ad.status <> 'available'
          )

          -- Anti-join 2: no live booking overlaps. Uses the same '[)' bound as the
          -- exclusion constraint, so search and the constraint can never disagree
          -- about what "overlapping" means.
          AND NOT EXISTS (
            SELECT 1 FROM bookings b
            WHERE b.unit_id = u.id
              AND b.status IN ('pending_confirmation', 'confirmed', 'checked_in')
              AND daterange(b.check_in, b.check_out, '[)')
                  && daterange(${query.checkIn}::date, ${query.checkOut}::date, '[)')
          )

          -- Per-day minimum-nights override applies from the arrival date.
          AND NOT EXISTS (
            SELECT 1 FROM availability_days ad
            WHERE ad.unit_id = u.id
              AND ad.date = ${query.checkIn}::date
              AND ad.min_nights IS NOT NULL
              AND ${nights} < ad.min_nights
          )

          ${
            query.amenityCodes.length > 0
              ? sql`AND (
                  SELECT COUNT(DISTINCT a.code)
                  FROM unit_amenities ua
                  JOIN amenities a ON a.id = ua.amenity_id
                  WHERE ua.unit_id = u.id
                    AND a.code IN ${query.amenityCodes}
                ) = ${query.amenityCodes.length}`
              : sql``
          }
      ),
      candidates AS (
        -- One row per PROPERTY, carrying its cheapest bookable unit. Guests search
        -- for a place to stay, not for a room id.
        SELECT DISTINCT ON (b.property_id)
          p.reference          AS "propertyReference",
          p.slug,
          p.name_ar            AS "nameAr",
          p.name_en            AS "nameEn",
          ci.slug              AS "citySlug",
          ci.name_ar           AS "cityNameAr",
          pt.code              AS "propertyTypeCode",
          p.rating,
          p.reviews_count      AS "reviewsCount",
          p.badges,
          p.recommendation_score AS "recommendationScore",
          cp.code              AS "cancellationPolicyCode",
          b.unit_id            AS "unitId",
          cur.code             AS "currencyCode",
          b.stay_total         AS "stayTotal",
          ROUND(b.stay_total / ${nights}, 2) AS "nightlyFrom",
          ${nights}::int       AS nights,
          -- Duplicated in snake_case purely to drive ORDER BY; stripped before
          -- the rows are returned.
          p.recommendation_score,
          b.stay_total         AS stay_total_sort
        FROM bookable b
        JOIN properties p            ON p.id = b.property_id
        JOIN cities ci               ON ci.id = p.city_id
        JOIN property_types pt       ON pt.id = p.property_type_id
        JOIN cancellation_policies cp ON cp.id = p.cancellation_policy_id
        JOIN currencies cur          ON cur.id = b.currency_id
        WHERE TRUE
          ${query.citySlug ? sql`AND ci.slug = ${query.citySlug}` : sql``}
          ${query.propertyTypeCode ? sql`AND pt.code = ${query.propertyTypeCode}` : sql``}
          ${query.minPrice !== undefined ? sql`AND b.stay_total >= ${query.minPrice}` : sql``}
          ${query.maxPrice !== undefined ? sql`AND b.stay_total <= ${query.maxPrice}` : sql``}
          ${
            query.freeCancellationOnly
              ? sql`AND (cp.tiers -> 0 ->> 'refundPercent')::int = 100`
              : sql``
          }
        ORDER BY b.property_id, b.stay_total ASC
      )
      SELECT c.*, ROW_NUMBER() OVER (ORDER BY ${orderBy}) AS row_no
      FROM candidates c
      ORDER BY ${orderBy}
      LIMIT ${query.limit + 1}
      OFFSET ${this.decodeOffset(query.cursor)}
    `);

    const all = rows.rows;
    const hasMore = all.length > query.limit;
    const items = (hasMore ? all.slice(0, query.limit) : all).map(stripSortColumns);

    return {
      items,
      nextCursor: hasMore
        ? encodeOffset(this.decodeOffset(query.cursor) + query.limit)
        : null,
      firstBookableDate: verdict.firstBookableDate,
    };
  }

  /**
   * Timezone for the cutoff decision.
   *
   * With no city selected the search spans markets, so the EARLIEST-closing
   * timezone would be the strict choice — but that would block a customer in
   * Beirut from booking tonight because Damascus has closed. Instead an unscoped
   * search uses the primary launch market's zone, and the per-property booking
   * flow re-checks against that property's actual city before payment. Search is
   * advisory; the booking endpoint is authoritative.
   */
  private async resolveTimezone(citySlug: string | undefined): Promise<string> {
    if (!citySlug) {
      return 'Asia/Damascus';
    }

    const found = await this.db.execute<{ timezone: string }>(
      sql`SELECT timezone FROM cities WHERE slug = ${citySlug} AND deleted_at IS NULL LIMIT 1`,
    );

    const timezone = found.rows[0]?.timezone;

    if (!timezone) {
      throw new NotFoundException(`Unknown city: ${citySlug}`);
    }

    return timezone;
  }

  /**
   * Search uses OFFSET rather than a keyset cursor, unlike the booking list.
   *
   * Deliberate: results are ranked by a computed score that shifts between
   * requests, so there is no stable sort key to seek on. Bounded by the 60-item
   * page cap and a hard offset ceiling, which keeps the cost acceptable — nobody
   * paginates to result 5,000 of a hotel search.
   */
  private decodeOffset(cursor: string | undefined): number {
    if (!cursor) {
      return 0;
    }

    const raw = Number(Buffer.from(cursor, 'base64url').toString('utf8'));

    if (!Number.isInteger(raw) || raw < 0 || raw > 1_000) {
      throw new BadRequestException('Malformed pagination cursor.');
    }

    return raw;
  }
}

function encodeOffset(offset: number): string {
  return Buffer.from(String(offset), 'utf8').toString('base64url');
}

/** Drops the duplicate columns that exist only to drive ORDER BY. */
function stripSortColumns(row: Record<string, unknown>): SearchResultItem {
  const {
    row_no: _rowNo,
    recommendation_score: _rs,
    stay_total_sort: _st,
    ...rest
  } = row;
  return rest as unknown as SearchResultItem;
}
