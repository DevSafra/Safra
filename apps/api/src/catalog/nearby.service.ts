import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { MAX_SEARCH_RADIUS_KM } from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import { publicCoordinate } from './public-location.js';

/**
 * How many PLACES a map draws — distinct published points, not listings.
 *
 * Twelve is what fits before the pills start colliding at the zoom the map opens at, and it
 * bounds the work on a public route. Counting points rather than listings matters: a dozen
 * listings at one coordinate would otherwise spend the entire budget on one pill.
 */
const NEARBY_LIMIT = 12;

/** How far around the subject listing to look, in metres. */
const NEARBY_RADIUS_METRES = 3_000;

/**
 * The other listings a map shows around the one being viewed, with their prices.
 *
 * ## Nothing here is a new disclosure
 *
 * Every neighbour is published at its PUBLIC coordinate — the same ~100 m pair its own
 * property page already serves to anyone who opens it — and at its public «from» price, the
 * same figure its search card already carries. The endpoint rearranges public facts; it does
 * not reveal a private one. That is the test to apply to any field added here later.
 *
 * The subject listing is excluded from its own neighbour list. Not for privacy — it is the
 * one thing on that map the reader definitely already knows — but because a price pill on
 * top of the area disc reads as a second, competing listing at the same place.
 *
 * ## Why the price is «from» and not a stay total
 *
 * A map marker has room for one number. A stay total depends on dates, party size and fees,
 * and a marker that quoted one without saying so would be a price the reader could not then
 * find at checkout. The nightly floor is the number the search cards already show and is
 * honest at a glance.
 */
@Injectable()
export class NearbyService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Published listings within `NEARBY_RADIUS_METRES` of a public coordinate.
   *
   * Takes the PUBLIC pair, never a raw one — the caller has it because the property page
   * already published it, and passing the exact location would centre the search on a point
   * the API is not allowed to know it knows.
   */
  async around(
    publicLatitude: string,
    publicLongitude: string,
    excludeSlug: string,
  ): Promise<NearbyListing[]> {
    const latitude = Number(publicLatitude);
    const longitude = Number(publicLongitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];

    /* The same correction areaCircle makes: longitude degrees shorten toward the poles. */
    const METRES_PER_DEGREE_LAT = 111_320;
    const deltaLat = NEARBY_RADIUS_METRES / METRES_PER_DEGREE_LAT;
    const deltaLon = deltaLat / Math.max(0.01, Math.cos((latitude * Math.PI) / 180));

    const rows = await this.db.execute<Record<string, unknown>>(sql`
      WITH in_box AS (
        SELECT
          p.id, p.slug, p.name_ar, p.name_en, p.name_de,
          p.star_rating, p.rating, p.reviews_count,
          p.public_latitude, p.public_longitude,
          (
            SELECT MIN(u.base_price) FROM units u
            WHERE u.property_id = p.id AND u.is_active AND u.deleted_at IS NULL
          ) AS from_price
        FROM properties p
        WHERE p.status = 'published'
          AND p.deleted_at IS NULL
          AND p.slug <> ${excludeSlug}
          AND p.public_latitude IS NOT NULL
          -- The bounding box is what uses properties_public_coords_idx; the ordering below
          -- trims its corners, which reach 1.41x the radius.
          AND p.public_latitude BETWEEN ${latitude - deltaLat}::numeric
                                    AND ${latitude + deltaLat}::numeric
          AND p.public_longitude BETWEEN ${longitude - deltaLon}::numeric
                                     AND ${longitude + deltaLon}::numeric
          -- A suspended partner's listings leave discovery, and a map is discovery.
          AND NOT EXISTS (
            SELECT 1 FROM partners sp
            WHERE sp.id = p.partner_id AND sp.suspended_at IS NOT NULL
          )
      ),
      /*
        ONE ROW PER PUBLISHED POINT, not per listing, and the limit applies to POINTS.

        Rounding to three decimals means two hotels on the same street share a coordinate,
        so a per-listing limit is spent by whichever cluster happens to be nearest — on the
        dev database twelve co-located fixtures filled the whole map and hid every real
        neighbour, and a dense district would do the same in production. Grouping first
        makes the twelve a budget of PLACES, which is what a reader is actually looking at.

        The representative is the CHEAPEST listing at the point, so the pill's price and the
        listing its link opens are the same one.
      */
      grouped AS (
        SELECT DISTINCT ON (public_latitude, public_longitude)
          slug, name_ar, name_en, name_de,
          star_rating, rating, reviews_count,
          public_latitude, public_longitude, from_price,
          COUNT(*) OVER (PARTITION BY public_latitude, public_longitude) AS stays_here
        FROM in_box
        ORDER BY public_latitude, public_longitude, from_price ASC NULLS LAST, slug
      )
      SELECT
        g.*,
        (
          SELECT cur.code FROM units u
          JOIN currencies cur ON cur.id = u.currency_id
          JOIN properties pp ON pp.id = u.property_id
          WHERE pp.slug = g.slug AND u.is_active AND u.deleted_at IS NULL
          ORDER BY u.base_price
          LIMIT 1
        ) AS currency_code
      FROM grouped g
      ORDER BY (
        power(g.public_latitude - ${latitude}::numeric, 2)
        + power((g.public_longitude - ${longitude}::numeric)
                * cos(radians(${latitude}::numeric)), 2)
      )
      LIMIT ${NEARBY_LIMIT}
    `);

    return rows.rows.map((r) => ({
      slug: typeof r['slug'] === 'string' ? r['slug'] : '',
      name: {
        ar: r['name_ar'] as string,
        en: r['name_en'] as string,
        de: r['name_de'] as string,
      },
      latitude: publicCoordinate(r['public_latitude']),
      longitude: publicCoordinate(r['public_longitude']),
      starRating: r['star_rating'] === null ? null : Number(r['star_rating']),
      rating: (r['rating'] as string | null) ?? null,
      reviewsCount: Number(r['reviews_count'] ?? 0),
      fromPrice: (r['from_price'] as string | null) ?? null,
      currencyCode: (r['currency_code'] as string | null) ?? null,
      staysHere: Number(r['stays_here'] ?? 1),
    }));
  }
}

export interface NearbyListing {
  slug: string;
  name: { ar: string; en: string; de: string };
  latitude: string | null;
  longitude: string | null;
  starRating: number | null;
  rating: string | null;
  reviewsCount: number;
  /** The advertised nightly floor, or null where no unit carries a price. */
  fromPrice: string | null;
  currencyCode: string | null;
  /**
   * How many published listings share this exact published point.
   *
   * One normally. More is not an anomaly: rounding to ~100 m means neighbours on one street
   * genuinely collapse to a single coordinate, and no zoom level can separate them — so the
   * map says how many are there rather than pretending there is one.
   */
  staysHere: number;
}

/** Exported for the tests that check the radius is bounded. */
export const NEARBY_BOUNDS = {
  limit: NEARBY_LIMIT,
  radiusMetres: NEARBY_RADIUS_METRES,
  maxSearchRadiusKm: MAX_SEARCH_RADIUS_KM,
};
