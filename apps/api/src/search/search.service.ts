import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { ERROR, type SearchQuery, evaluateArrival } from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import { SettingsService } from '../settings/settings.service.js';
import { badRequest, notFound } from '../common/errors/app-error.js';

export interface SearchResultItem {
  propertyReference: string;
  slug: string;
  nameAr: string;
  nameEn: string;
  /*
    All three names, and the city's in all three too.

    The projection used to carry `nameAr`, `nameEn` and `cityNameAr` only, which left the customer app
    unable to render a search result correctly in two of the three languages it serves: a German reader
    got the ENGLISH property name (241 properties have a distinct German one), and an English or German
    reader got the city SLUG — «damascus» — because no city name in their language was sent at all.
  */
  nameDe: string;
  citySlug: string;
  cityNameAr: string;
  cityNameEn: string;
  cityNameDe: string;
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
      throw badRequest(ERROR.BOOKING_STAY_TOO_LONG, { maxNights });
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

    const offset = this.decodeOffset(query.cursor);

    /**
     * Whether this search can decide its page BEFORE pricing anything.
     *
     * ## What it buys
     *
     * Pricing is the dominant cost of an unfiltered search: one index probe per candidate unit, and
     * an unfiltered search has 150,000 of them. But `recommended` and `rating_desc` rank on
     * `recommendation_score` and `rating`, which are columns of the PROPERTY and owe nothing to the
     * dates being searched. So the page can be chosen first and only its properties priced — twenty
     * of them instead of fifty thousand.
     *
     * ## Why the other two sorts cannot
     *
     * `price_asc` and `price_desc` rank BY the price, which is the thing being computed. There is no
     * way to know which properties belong on page one without pricing all of them.
     *
     * ## Why a price filter also disqualifies it
     *
     * `minPrice`/`maxPrice` are applied after pricing, and they can eliminate every unit of a
     * property — so a property inside the rank window can drop out, and one outside it should have
     * taken its place. Narrowing first would then return a short page and silently omit a match.
     */
    const rankBeforePricing =
      (query.sort === 'recommended' || query.sort === 'rating_desc') &&
      query.minPrice === undefined &&
      query.maxPrice === undefined;

    /**
     * The properties that can appear on this page, when pricing can be deferred.
     *
     * `RANK()`, deliberately, not `ROW_NUMBER()`: ties share a rank, so `rk <= n` returns EVERY
     * property level with the last one on (score, rating). That is what keeps this exact. With
     * `ROW_NUMBER` a property tied at the page boundary would be cut arbitrarily, and for
     * `recommended` — whose third key is the price — the cut would decide an ordering that the price
     * is supposed to decide.
     */
    const pageProperties = rankBeforePricing
      ? sql`
        AND u.property_id IN (
          SELECT ranked.property_id FROM (
            SELECT eligible.property_id,
                   RANK() OVER (
                     ORDER BY pr.recommendation_score DESC, pr.rating DESC NULLS LAST
                   ) AS rk
            FROM (SELECT DISTINCT available.property_id FROM available) eligible
            JOIN properties pr ON pr.id = eligible.property_id
          ) ranked
          WHERE ranked.rk <= ${offset + query.limit + 1}
        )`
      : sql``;

    const rows = await this.db.execute<Record<string, unknown>>(sql`
      -- available: which units could be slept in, with no price computed yet.
      --
      -- Pricing is a probe per unit, and an unfiltered search has 150,000 candidates. Splitting
      -- availability from pricing is what lets the page be chosen first and only its properties
      -- priced — see rankBeforePricing above.
      WITH available AS MATERIALIZED (
        SELECT
          u.id                AS unit_id,
          u.property_id,
          u.currency_id,
          u.base_price
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

          -- ── Narrow BEFORE pricing ────────────────────────────────────────
          --
          -- City, type and cancellation policy are properties of the PROPERTY, and they used to be
          -- applied in candidates — after every unit in the country had already been priced and
          -- had its availability checked. So a search of one city did the work of a search of all
          -- of them, and properties_published_idx, which exists precisely for
          -- (city_id, recommendation_score) over published rows, could never be used.
          --
          -- They are repeated in candidates rather than moved. Applying the same predicate twice
          -- cannot change the result, and it means this optimisation cannot quietly alter what a
          -- guest sees if one of these is not exactly equivalent to the join it mirrors.
          ${
            query.citySlug
              ? sql`AND p.city_id = (
                      SELECT id FROM cities WHERE slug = ${query.citySlug} AND deleted_at IS NULL
                    )`
              : sql``
          }
          ${
            query.propertyTypeCode
              ? sql`AND p.property_type_id = (
                      SELECT id FROM property_types WHERE code = ${query.propertyTypeCode}
                    )`
              : sql``
          }
          ${
            query.freeCancellationOnly
              ? sql`AND p.cancellation_policy_id IN (
                      SELECT id FROM cancellation_policies
                      WHERE (tiers -> 0 ->> 'refundPercent')::int = 100
                    )`
              : sql``
          }

          -- Anti-join 1: the calendar says no.
          --
          -- Two rules over the same rows, so ONE scan rather than two: a day in the range that is
          -- closed, booked or under maintenance, OR an arrival day carrying a minimum-nights
          -- override this stay is too short for. They were separate NOT EXISTS clauses, each
          -- opening its own index scan on (unit_id, date) for every candidate unit — and at 200,000
          -- units an unfiltered search made 450,000 lookups into a 73-million-row table.
          --
          -- The union of the two predicates is the union of the two excluded sets, so this is the
          -- same set of units. The min-nights term keeps its date = arrival restriction, which is
          -- inside the range being scanned.
          --
          -- An ABSENT row means available — §8.4 puts the burden on the partner to close dates, so
          -- units are open by default rather than needing 365 rows before a listing can sell.
          AND NOT EXISTS (
            SELECT 1 FROM availability_days ad
            WHERE ad.unit_id = u.id
              AND ad.date >= ${query.checkIn}::date
              AND ad.date <  ${query.checkOut}::date
              AND (
                ad.status <> 'available'
                OR (
                  ad.date = ${query.checkIn}::date
                  AND ad.min_nights IS NOT NULL
                  AND ${nights} < ad.min_nights
                )
              )
          )

          -- Anti-join 2: no live booking overlaps. Uses the same '[)' bound as the
          -- exclusion constraint, so search and the constraint can never disagree
          -- about what "overlapping" means.
          AND NOT EXISTS (
            SELECT 1 FROM bookings b
            WHERE b.unit_id = u.id
              AND b.status IN ('pending_payment', 'pending_confirmation', 'confirmed', 'checked_in')
              AND daterange(b.check_in, b.check_out, '[)')
                  && daterange(${query.checkIn}::date, ${query.checkOut}::date, '[)')
          )

          ${
            // §5.2 trip attributes. `@>` requires the property to carry ALL
            // selected attributes, matching how the amenity filter behaves — a
            // multi-select that silently ORed would surprise anyone narrowing a
            // search on purpose.
            query.attributes.length > 0
              ? // Bound as a parameter, never interpolated. The Zod enum already
                // restricts these to 10 known values, but rule 1 is unconditional:
                // no string-built SQL, so a future change to the schema cannot turn
                // this into an injection point.
                // Each element is bound individually. Passing the JS array directly
                // makes drizzle emit a row constructor `($1,$2)`, which Postgres
                // cannot cast to text[] — "cannot cast type record to text[]".
                sql`AND p.attributes @> ARRAY[${sql.join(
                  query.attributes.map((a) => sql`${a}`),
                  sql`, `,
                )}]::text[]`
              : sql``
          }
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
      bookable AS (
        SELECT
          u.unit_id,
          u.property_id,
          u.currency_id,
          -- The stay's price, as the base rate plus what the overrides CHANGE.
          --
          -- Equivalent to summing COALESCE(ad.price, u.base_price) over every night, which is how
          -- this was written, and far cheaper to execute. That form drove the sum from
          -- generate_series LEFT JOINed to availability_days, so the date never became an index
          -- bound: the plan read all 365 of a unit's rows and hash-joined them down to the two
          -- nights being priced, for every candidate unit (O-scale-2).
          --
          -- Written this way the subquery is a bounded range scan that touches only the nights in
          -- the stay carrying an override, and usually none of them. It is served index-only by
          -- availability_days_priced_idx, which includes the price in its payload.
          --
          -- The algebra: nights × base, plus (override − base) for each overridden night, is the
          -- same total as base for the plain nights plus the override for the priced ones.
          --
          -- A row with a NULL price is a status-only row, so it must NOT read as a free night. It
          -- is excluded here and falls into the base-rate term, which is what COALESCE did.
          u.base_price * ${nights} + COALESCE(
            (
              SELECT SUM(ad.price - u.base_price)
              FROM availability_days ad
              WHERE ad.unit_id = u.unit_id
                AND ad.date >= ${query.checkIn}::date
                AND ad.date <  ${query.checkOut}::date
                AND ad.price IS NOT NULL
            ),
            0
          ) AS stay_total
        FROM available u
        WHERE TRUE
          ${pageProperties}
      ),
      candidates AS (
        -- One row per PROPERTY, carrying its cheapest bookable unit. Guests search
        -- for a place to stay, not for a room id.
        SELECT DISTINCT ON (b.property_id)
          p.reference          AS "propertyReference",
          p.slug,
          p.name_ar            AS "nameAr",
          p.name_en            AS "nameEn",
          p.name_de            AS "nameDe",
          ci.slug              AS "citySlug",
          ci.name_ar           AS "cityNameAr",
          ci.name_en           AS "cityNameEn",
          ci.name_de           AS "cityNameDe",
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
      -- No ROW_NUMBER() here.
      --
      -- There was one, aliased row_no, and stripSortColumns deleted it from every row before
      -- returning them: nothing read it, in this file or anywhere else. A window function is
      -- computed over the WHOLE partition before LIMIT can apply, so the cost of ranking every
      -- matching property was paid on every search and then discarded. Removing it lets the sort
      -- feed the limit directly.
      SELECT c.*
      FROM candidates c
      ORDER BY ${orderBy}
      LIMIT ${query.limit + 1}
      OFFSET ${offset}
    `);

    const all = rows.rows;
    const hasMore = all.length > query.limit;
    const items = (hasMore ? all.slice(0, query.limit) : all).map(stripSortColumns);

    return {
      items,
      nextCursor: hasMore ? encodeOffset(offset + query.limit) : null,
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
      throw notFound(ERROR.GEO_CITY_NOT_FOUND);
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
      throw badRequest(ERROR.REQUEST_CURSOR_INVALID);
    }

    return raw;
  }
}

function encodeOffset(offset: number): string {
  return Buffer.from(String(offset), 'utf8').toString('base64url');
}

/** Drops the duplicate columns that exist only to drive ORDER BY. */
function stripSortColumns(row: Record<string, unknown>): SearchResultItem {
  const { recommendation_score: _rs, stay_total_sort: _st, ...rest } = row;

  return rest as unknown as SearchResultItem;
}
