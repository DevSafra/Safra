import { createHash } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { Redis } from 'ioredis';

import { currencyDecimals, ERROR, type SearchQuery } from '@safra/contracts';
import type { Database } from '@safra/db';

import { customerFeeMinor, type CustomerFeeRule } from '../bookings/customer-fee.js';
import { unavailable } from '../common/errors/app-error.js';
import { describeError } from '../common/errors/safe-error.js';
import { fromMinor, toMinor } from '../common/money.js';
import { DATABASE } from '../database/database.module.js';
import { REDIS } from '../redis/redis.tokens.js';
import {
  CENTRES_CTE,
  FILTER_GROUPS,
  freeTier,
  type FilterGroup,
} from './search-filters.js';
import { SearchService } from './search.service.js';

/** The review-score floors the sidebar offers, on SAFRA's 1-5 scale. */
export const RATING_BANDS = [4.5, 4, 3.5, 3] as const;
/** Bathroom floors, as booking.com's stepper reads them. */
export const BATHROOM_BANDS = [1, 2, 3, 4] as const;
/** Distance-from-centre ceilings in km. */
export const CENTRE_BANDS = [1, 3, 5] as const;
/** Price histogram resolution — enough bars to read a shape, few enough to draw at 17rem. */
const HISTOGRAM_BARS = 24;
/** How long a set of counts is reused. Availability moves, but not within a minute of browsing. */
const CACHE_SECONDS = 60;
/**
 * The most the counts may cost (Bashar, 2026-10-01, after the production-volume measurement).
 *
 * Nationwide at 50,000 properties the query took 4.9 to 15 seconds uncached, and the first call hit
 * the pool's 15 s timeout and answered 500. Past this limit the counts are abandoned: the endpoint
 * answers 503 at once, the page draws its filters without numbers, and the database is freed for
 * the searches that matter. The results never wait for the counts either way.
 */
export const FACETS_TIMEOUT_MS = 1_500;
/** What the cache holds for a question whose counts ran out of time, so it is not asked again. */
const TIMED_OUT = 'timed-out';

export interface SearchFacets {
  /** Stays matching EVERY filter — the figure in «دمشق: وجدنا ١٢ مكان إقامة». */
  total: number;
  propertyTypes: Record<string, number>;
  starRatings: Record<string, number>;
  /** Keyed by floor: «4.5» is how many stays score 4.5 or more. */
  ratings: Record<string, number>;
  bathrooms: Record<string, number>;
  bedTypes: Record<string, number>;
  /** Keyed by ceiling in km. */
  centre: Record<string, number>;
  freeCancellation: number;
  attributes: Record<string, number>;
  amenities: Record<string, number>;
  /**
   * The nightly price as the CARD prints it, fee included, across every stay that matches the
   * other filters. Null when nothing matches. The bars ignore the budget itself, so the reader sees
   * the whole range they are choosing inside.
   */
  price: {
    min: string;
    max: string;
    currencyCode: string;
    bars: number[];
  } | null;
}

/**
 * Counts beside every filter, true for the reader's dates, party and other filters (Bashar,
 * 2026-10-01: «Live, cached»).
 *
 * ## One scope, a flag per group
 *
 * The candidates are computed once — every unit the SEARCH could return, before any sidebar
 * filter — and each sidebar group is evaluated on them as a boolean column from the same fragment
 * the search uses. A group's own counts then require every flag EXCEPT its own: that is what lets a
 * reader who ticked «٤ نجوم» still see how many five-star stays there are, and it is how booking.com
 * behaves. `total` requires every flag, so it is exactly the length of the result list.
 *
 * ## Cost
 *
 * This is the shape search avoids on its fast path — it prices every candidate, because the price
 * bars and the budget flag need it. So it is cached per normalised query for a minute, and a Redis
 * failure falls through to computing it rather than failing the page: counts are a convenience
 * beside a result list that must not depend on them.
 */
@Injectable()
export class SearchFacetsService {
  private readonly logger = new Logger(SearchFacetsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly search: SearchService,
  ) {}

  async facets(query: SearchQuery, now: Date = new Date()): Promise<SearchFacets> {
    const prepared = await this.search.prepare(query, now);

    if (prepared.empty) return emptyFacets();

    const key = cacheKey(query, prepared.feeRule);
    const cached = await this.readCache(key);

    if (cached === TIMED_OUT) throw unavailable(ERROR.SEARCH_FACETS_UNAVAILABLE);
    if (cached) return cached;

    try {
      const computed = await this.compute(query, prepared);
      await this.writeCache(key, computed);
      return computed;
    } catch (error) {
      if (!isStatementTimeout(error)) throw error;
      /*
        Remembered for the same minute a result would be: the same question asked again would run
        out of time again, and each attempt costs the database the full limit.
      */
      await this.writeCache(key, TIMED_OUT);
      throw unavailable(ERROR.SEARCH_FACETS_UNAVAILABLE);
    }
  }

  private async compute(
    query: SearchQuery,
    prepared: Extract<Awaited<ReturnType<SearchService['prepare']>>, { empty: false }>,
  ): Promise<SearchFacets> {
    const { filters, nights, minStayBase, maxStayBase, feeRule } = prepared;
    const exactPricing = minStayBase !== undefined || maxStayBase !== undefined;

    /** Every flag except the named group's — the condition a group's own counts are taken under. */
    const allBut = (skip: FilterGroup | 'price' | null): SQL =>
      sql.join(
        [
          ...FILTER_GROUPS.filter((group) => group !== skip).map((group) =>
            sql.raw(`f.ok_${group.toLowerCase()}`),
          ),
          ...(skip === 'price' ? [] : [sql`f.ok_price`]),
        ],
        sql` AND `,
      );

    const flag = (group: FilterGroup): SQL =>
      sql`(TRUE ${filters[group]}) AS ${sql.raw(`ok_${group.toLowerCase()}`)}`;

    const priceFlag = sql`(TRUE
      ${minStayBase !== undefined ? sql`AND stay_total >= ${minStayBase}` : sql``}
      ${maxStayBase !== undefined ? sql`AND stay_total <= ${maxStayBase}` : sql``}
    )`;

    const statement = sql`
      WITH ${CENTRES_CTE},
      -- scope: every unit the search could return before any sidebar filter, each sidebar group
      -- evaluated as a flag from the same fragment the search ANDs. Joined to an OPEN city and
      -- country, as the search candidates are, so a withdrawn market is not counted either.
      scope AS MATERIALIZED (
        SELECT
          u.id AS unit_id,
          u.property_id,
          u.base_price,
          u.bathrooms,
          u.bed_type,
          u.currency_id,
          p.property_type_id,
          p.star_rating,
          p.rating,
          p.attributes,
          ${freeTier(sql`cp.tiers`)} AS is_free,
          CASE
            WHEN cc.latitude IS NULL OR p.public_latitude IS NULL THEN NULL
            ELSE 6371008.8 * 2 * asin(sqrt(
              power(sin(radians(cc.latitude - p.public_latitude) / 2), 2)
              + cos(radians(p.public_latitude)) * cos(radians(cc.latitude))
                * power(sin(radians(cc.longitude - p.public_longitude) / 2), 2)
            ))
          END AS centre_metres,
          ${sql.join(FILTER_GROUPS.map(flag), sql`, `)}
        FROM units u
        JOIN properties p ON p.id = u.property_id
        JOIN cities ci ON ci.id = p.city_id AND ci.is_active
        JOIN countries co ON co.id = ci.country_id AND co.is_active
        JOIN cancellation_policies cp ON cp.id = p.cancellation_policy_id
        LEFT JOIN centres cc ON cc.city_id = p.city_id
        WHERE ${filters.scope}
      ),
      -- priced: the same accommodation arithmetic as the search, for the budget flag and the bars.
      -- priced: EXACT only when a budget is set, because only then does a count depend on it. Without
      -- one the bars are drawn from each room's base nightly rate (Bashar, 2026-10-01): pricing every
      -- unit for the exact dates was nearly all of the cost, and the bars are a picture of the range,
      -- not a quote. The budget filter itself stays exact whenever it is in use.
      priced AS MATERIALIZED (
        SELECT s.*,
               ${
                 exactPricing
                   ? sql`s.base_price * ${nights} + COALESCE(
                       (
                         SELECT SUM(ad.price - s.base_price)
                         FROM availability_days ad
                         WHERE ad.unit_id = s.unit_id
                           AND ad.date >= ${query.checkIn}::date
                           AND ad.date <  ${query.checkOut}::date
                           AND ad.price IS NOT NULL
                       ),
                       0
                     )`
                   : sql`s.base_price * ${nights}`
               } AS stay_total
        FROM scope s
      ),
      f AS MATERIALIZED (
        SELECT priced.*, ${priceFlag} AS ok_price FROM priced
      ),
      -- One row per PROPERTY for the price bars: its cheapest unit matching every other filter,
      -- which is the price its card would carry.
      -- Grouped by currency as well, so a price and its currency always come from the same units:
      -- taking MIN of each separately could pair a dollar figure with a pound code.
      cheapest AS (
        SELECT f.property_id, cur.code AS currency, MIN(f.stay_total / ${nights}) AS nightly
        FROM f
        JOIN currencies cur ON cur.id = f.currency_id
        WHERE ${allBut('price')}
        GROUP BY f.property_id, cur.code
      ),
      -- The bars are drawn in ONE currency: the one most matching stays are priced in. A
      -- histogram spanning two currencies is a picture of nothing (66.99 dollars beside 50,001.99
      -- pounds on one axis), and since 2026-09-14 the dollar is the only currency SAFRA offers, so
      -- anything else is legacy inventory the bars should not be scaled by.
      main_currency AS (
        SELECT currency FROM cheapest GROUP BY currency
        ORDER BY COUNT(DISTINCT property_id) DESC, currency LIMIT 1
      ),
      priced_main AS (
        SELECT c.* FROM cheapest c JOIN main_currency m ON m.currency = c.currency
      ),
      bounds AS (
        SELECT MIN(nightly) AS lo, MAX(nightly) AS hi, MIN(currency) AS currency FROM priced_main
      )
      SELECT jsonb_build_object(
        'total', (SELECT COUNT(DISTINCT f.property_id) FROM f WHERE ${allBut(null)}),
        'propertyTypes', (
          SELECT COALESCE(jsonb_object_agg(x.code, x.n), '{}'::jsonb) FROM (
            SELECT pt.code, COUNT(DISTINCT f.property_id) AS n
            FROM f JOIN property_types pt ON pt.id = f.property_type_id
            WHERE ${allBut('propertyType')}
            GROUP BY pt.code
          ) x
        ),
        'starRatings', (
          SELECT COALESCE(jsonb_object_agg(x.star_rating, x.n), '{}'::jsonb) FROM (
            SELECT f.star_rating, COUNT(DISTINCT f.property_id) AS n
            FROM f WHERE f.star_rating IS NOT NULL AND ${allBut('stars')}
            GROUP BY f.star_rating
          ) x
        ),
        'ratings', (
          SELECT jsonb_build_object(${sql.join(
            RATING_BANDS.map(
              (band) =>
                sql`${String(band)}::text, COUNT(DISTINCT f.property_id) FILTER (WHERE f.rating >= ${band})`,
            ),
            sql`, `,
          )})
          FROM f WHERE ${allBut('rating')}
        ),
        'bathrooms', (
          SELECT jsonb_build_object(${sql.join(
            BATHROOM_BANDS.map(
              (band) =>
                sql`${String(band)}::text, COUNT(DISTINCT f.property_id) FILTER (WHERE f.bathrooms >= ${band})`,
            ),
            sql`, `,
          )})
          FROM f WHERE ${allBut('bathrooms')}
        ),
        'bedTypes', (
          SELECT COALESCE(jsonb_object_agg(x.bed_type, x.n), '{}'::jsonb) FROM (
            SELECT f.bed_type, COUNT(DISTINCT f.property_id) AS n
            FROM f WHERE ${allBut('bedType')}
            GROUP BY f.bed_type
          ) x
        ),
        'centre', (
          SELECT jsonb_build_object(${sql.join(
            CENTRE_BANDS.map(
              (band) =>
                sql`${String(band)}::text, COUNT(DISTINCT f.property_id) FILTER (WHERE f.centre_metres <= ${band * 1000})`,
            ),
            sql`, `,
          )})
          FROM f WHERE ${allBut('centre')}
        ),
        'freeCancellation', (
          SELECT COUNT(DISTINCT f.property_id) FROM f
          WHERE f.is_free AND ${allBut('freeCancellation')}
        ),
        -- Attributes and amenities are AND filters: ticking one more narrows, so each count is
        -- taken over the CURRENT results — how many would remain with that box ticked as well.
        'attributes', (
          SELECT COALESCE(jsonb_object_agg(x.code, x.n), '{}'::jsonb) FROM (
            SELECT attr.code, COUNT(DISTINCT f.property_id) AS n
            FROM f CROSS JOIN LATERAL unnest(f.attributes) AS attr(code)
            WHERE ${allBut(null)}
            GROUP BY attr.code
          ) x
        ),
        'amenities', (
          SELECT COALESCE(jsonb_object_agg(x.code, x.n), '{}'::jsonb) FROM (
            SELECT a.code, COUNT(DISTINCT f.property_id) AS n
            FROM f
            JOIN LATERAL (
              SELECT ua.amenity_id FROM unit_amenities ua WHERE ua.unit_id = f.unit_id
              UNION
              SELECT pa.amenity_id FROM property_amenities pa WHERE pa.property_id = f.property_id
            ) held ON TRUE
            JOIN amenities a ON a.id = held.amenity_id AND a.is_filterable
            WHERE ${allBut(null)}
            GROUP BY a.code
          ) x
        ),
        'price', (
          SELECT CASE WHEN b.lo IS NULL THEN NULL ELSE jsonb_build_object(
            'lo', b.lo,
            'hi', b.hi,
            'currency', b.currency,
            'bars', (
              SELECT COALESCE(jsonb_agg(COALESCE(h.n, 0) ORDER BY g.i), '[]'::jsonb)
              FROM generate_series(1, ${HISTOGRAM_BARS}) AS g(i)
              LEFT JOIN (
                SELECT CASE WHEN b.hi = b.lo THEN 1
                            ELSE LEAST(width_bucket(c.nightly, b.lo, b.hi, ${HISTOGRAM_BARS}), ${HISTOGRAM_BARS})
                       END AS i,
                       COUNT(*) AS n
                FROM priced_main c
                GROUP BY 1
              ) h ON h.i = g.i
            )
          ) END
          FROM bounds b
        )
      ) AS facets
    `;

    /* SET LOCAL lasts exactly as long as this transaction, so no other query on the connection inherits it. */
    const result = await this.db.transaction(async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL statement_timeout = ${FACETS_TIMEOUT_MS}`));
      return tx.execute<{ facets: RawFacets }>(statement);
    });

    const raw = result.rows[0]?.facets;

    if (!raw) return emptyFacets();

    return {
      total: Number(raw.total),
      propertyTypes: numbers(raw.propertyTypes),
      starRatings: numbers(raw.starRatings),
      ratings: numbers(raw.ratings),
      bathrooms: numbers(raw.bathrooms),
      bedTypes: numbers(raw.bedTypes),
      centre: numbers(raw.centre),
      freeCancellation: Number(raw.freeCancellation),
      attributes: numbers(raw.attributes),
      amenities: numbers(raw.amenities),
      price: raw.price
        ? {
            min: shown(String(raw.price.lo), raw.price.currency, feeRule),
            max: shown(String(raw.price.hi), raw.price.currency, feeRule),
            currencyCode: raw.price.currency,
            bars: raw.price.bars.map(Number),
          }
        : null,
    };
  }

  private async readCache(key: string): Promise<SearchFacets | typeof TIMED_OUT | null> {
    try {
      const hit = await this.redis.get(key);
      if (hit === TIMED_OUT) return TIMED_OUT;
      return hit ? (JSON.parse(hit) as SearchFacets) : null;
    } catch (error) {
      this.logger.warn(`facet cache read failed: ${describeError(error)}`);
      return null;
    }
  }

  private async writeCache(
    key: string,
    value: SearchFacets | typeof TIMED_OUT,
  ): Promise<void> {
    try {
      await this.redis.set(
        key,
        value === TIMED_OUT ? TIMED_OUT : JSON.stringify(value),
        'EX',
        CACHE_SECONDS,
      );
    } catch (error) {
      this.logger.warn(`facet cache write failed: ${describeError(error)}`);
    }
  }
}

interface RawFacets {
  total: number | string;
  propertyTypes: Record<string, number | string>;
  starRatings: Record<string, number | string>;
  ratings: Record<string, number | string>;
  bathrooms: Record<string, number | string>;
  bedTypes: Record<string, number | string>;
  centre: Record<string, number | string>;
  freeCancellation: number | string;
  attributes: Record<string, number | string>;
  amenities: Record<string, number | string>;
  price: {
    lo: number | string;
    hi: number | string;
    currency: string;
    bars: (number | string)[];
  } | null;
}

/** PostgreSQL's query_canceled, which is what statement_timeout raises. Read from the error or its cause. */
function isStatementTimeout(error: unknown): boolean {
  const code = (value: unknown) =>
    typeof value === 'object' && value !== null && 'code' in value
      ? String(value.code)
      : undefined;
  const cause =
    typeof error === 'object' && error !== null && 'cause' in error
      ? error.cause
      : undefined;
  return code(error) === '57014' || code(cause) === '57014';
}

function numbers(
  input: Record<string, number | string> | null | undefined,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(input ?? {}).map(([key, n]) => [key, Number(n)]),
  );
}

/** A base nightly figure as the card prints it: the fee folded in exactly as search does. */
function shown(base: string, currencyCode: string, rule: CustomerFeeRule): string {
  const scale = currencyDecimals(currencyCode);
  const minor = toMinor(Number(base).toFixed(scale), scale);
  return fromMinor(minor + customerFeeMinor(minor, rule, scale), scale);
}

function emptyFacets(): SearchFacets {
  return {
    total: 0,
    propertyTypes: {},
    starRatings: {},
    ratings: {},
    bathrooms: {},
    bedTypes: {},
    centre: {},
    freeCancellation: 0,
    attributes: {},
    amenities: {},
    price: null,
  };
}

/**
 * A stable key for one question. Arrays are sorted, because «4 and 5 stars» and «5 and 4» are the
 * same question and must share an entry; paging fields are dropped, because counts do not page. The
 * fee rule is part of the key, so a change on the Rules Engine page cannot serve stale bars.
 */
function cacheKey(query: SearchQuery, rule: CustomerFeeRule): string {
  const { sort: _sort, limit: _limit, cursor: _cursor, ...rest } = query;
  const normalised: [string, unknown][] = Object.entries(rest as Record<string, unknown>)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]): [string, unknown] => [
      key,
      Array.isArray(value) ? (value as unknown[]).map(String).sort() : value,
    ])
    .sort(([a], [b]) => a.localeCompare(b));
  const digest = createHash('sha256')
    .update(JSON.stringify({ normalised, rule }))
    .digest('hex');
  return `search:facets:v1:${digest}`;
}
