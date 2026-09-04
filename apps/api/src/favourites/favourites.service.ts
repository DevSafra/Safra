import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { ERROR, type CursorQuery, decodeCursor, encodeCursor } from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { badRequest, notFound, unauthorized } from '../common/errors/app-error.js';

/** A uuid, checked before it reaches a `::uuid` cast so a forged cursor is a 400 and not a 500. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * المفضلة — the listings a customer has saved (handoff §6).
 *
 * ## It takes a SLUG and resolves it here
 *
 * The client knows slugs, because that is what a property URL carries. It does not get to name a
 * property id: the slug is resolved against `properties` in this service, and only a PUBLISHED,
 * undeleted listing resolves at all. Otherwise a guessed id would let somebody save — and thereby
 * confirm the existence of — a draft nobody has published.
 *
 * ## Saving twice is saving once
 *
 * `favourites_customer_property_unique` covers every row, deleted or not, so the insert is an upsert
 * that clears `deleted_at`. A double tap, a retried request, or a second tab all converge on the same
 * single row rather than racing to create two — and the row keeps the date it was FIRST saved.
 *
 * ## Un-saving is a soft delete
 *
 * P-003, and it also answers a question the business will ask: which listings people save and then
 * drop. A hard delete cannot.
 */
@Injectable()
export class FavouritesService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** The caller's own profile, or a refusal. No endpoint here accepts a customer id. */
  private profileOf(claims: AccessTokenClaims | undefined): string {
    if (!claims) throw unauthorized(ERROR.AUTH_REQUIRED);

    const profileId = claims.customerProfileId;

    /* A staff or partner token has no customer account, and so has no favourites of its own. */
    if (!profileId) throw notFound(ERROR.CUSTOMER_NOT_FOUND);

    return profileId;
  }

  async list(claims: AccessTokenClaims | undefined, query: CursorQuery) {
    const profileId = this.profileOf(claims);

    let after: { sortKey: string; id: string } | null = null;

    if (query.cursor !== undefined) {
      const decoded = decodeCursor(query.cursor);

      if (!decoded || !UUID_PATTERN.test(decoded.id)) {
        throw badRequest(ERROR.REQUEST_CURSOR_INVALID);
      }

      after = { sortKey: decoded.sortKey, id: decoded.id };
    }

    /* String sort key: `created_at` holds microseconds and a Date holds milliseconds — see
       `encodeCursor`, which documents why truncating it repeats the boundary row. */
    const keyset = after
      ? sql`AND (f.created_at, f.id) < (${after.sortKey}::timestamptz, ${after.id}::uuid)`
      : sql``;

    const rows = await this.db.execute<{
      id: string;
      created_at: string;
      slug: string;
      name_ar: string;
      name_en: string | null;
      name_de: string | null;
      city_name_ar: string;
      city_name_en: string | null;
      city_name_de: string | null;
      rating: string | null;
      star_rating: number | null;
      reviews_count: number;
      is_available: boolean;
      from_price: string | null;
      currency_code: string | null;
    }>(sql`
      SELECT f.id, f.created_at::text AS created_at,
             p.slug,
             p.name_ar, p.name_en, p.name_de,
             ci.name_ar AS city_name_ar,
             ci.name_en AS city_name_en,
             ci.name_de AS city_name_de,
             p.star_rating,
             p.rating::text AS rating,
             p.reviews_count,
             /*
               Whether the listing can still be booked.

               Reported rather than filtered: a saved property that was unpublished should say so, not
               vanish. Silently dropping it would look like the save had failed.
             */
             (p.status = 'published' AND p.deleted_at IS NULL) AS is_available,
             cheapest.base_price::text AS from_price,
             cheapest.code             AS currency_code
      FROM favourites f
      JOIN properties p ON p.id = f.property_id
      JOIN cities ci ON ci.id = p.city_id
      /* The cheapest unit still on sale, for the "from" price. One indexed lookup per row. */
      LEFT JOIN LATERAL (
        SELECT u.base_price, cur.code
        FROM units u
        JOIN currencies cur ON cur.id = u.currency_id
        WHERE u.property_id = p.id AND u.is_active AND u.deleted_at IS NULL
        ORDER BY u.base_price ASC
        LIMIT 1
      ) AS cheapest ON true
      WHERE f.customer_profile_id = ${profileId}
        AND f.deleted_at IS NULL
        ${keyset}
      ORDER BY f.created_at DESC, f.id DESC
      LIMIT ${query.limit + 1}
    `);

    const page = rows.rows.slice(0, query.limit);
    const last = page[page.length - 1];

    return {
      items: page.map((row) => ({
        slug: row.slug,
        savedAt: row.created_at,
        isAvailable: row.is_available,
        property: { nameAr: row.name_ar, nameEn: row.name_en, nameDe: row.name_de },
        city: {
          nameAr: row.city_name_ar,
          nameEn: row.city_name_en,
          nameDe: row.city_name_de,
        },
        starRating: row.star_rating,
        rating: row.rating,
        reviewsCount: row.reviews_count,
        fromPrice: row.from_price,
        currencyCode: row.currency_code,
      })),
      nextCursor:
        rows.rows.length > query.limit && last
          ? encodeCursor(last.created_at, last.id)
          : null,
    };
  }

  /**
   * Whether ONE listing is currently saved.
   *
   * Exists because the property page is cached (`revalidate = 60`), so its saved state cannot be
   * server-rendered — a cached page would serve one customer's shortlist to the next, which is the
   * same mistake as caching an account page. The button therefore asks after it mounts.
   *
   * Answers `false` rather than refusing for a caller with no customer profile: "is this saved" has a
   * truthful answer for a partner or a guest, and it is no.
   */
  async status(claims: AccessTokenClaims | undefined, slug: string) {
    if (!claims?.customerProfileId) return { slug, saved: false };

    const found = await this.db.execute<{ saved: boolean }>(sql`
      SELECT true AS saved
      FROM favourites f
      JOIN properties p ON p.id = f.property_id
      WHERE f.customer_profile_id = ${claims.customerProfileId}
        AND p.slug = ${slug}
        AND f.deleted_at IS NULL
      LIMIT 1
    `);

    return { slug, saved: found.rows.length > 0 };
  }

  /** Saves a listing. Idempotent: saving one already saved returns the same answer. */
  async save(claims: AccessTokenClaims | undefined, slug: string) {
    const profileId = this.profileOf(claims);
    const propertyId = await this.publishedPropertyId(slug);

    await this.db.execute(sql`
      INSERT INTO favourites (customer_profile_id, property_id)
      VALUES (${profileId}, ${propertyId})
      ON CONFLICT (customer_profile_id, property_id)
      DO UPDATE SET deleted_at = NULL, updated_at = now()
    `);

    return { slug, saved: true };
  }

  /**
   * Un-saves a listing.
   *
   * Idempotent too, and deliberately does NOT 404 for something that was never saved: the caller's
   * intent is "this should not be in my favourites", and that is already true. A refusal would make a
   * double tap look like a failure.
   */
  async remove(claims: AccessTokenClaims | undefined, slug: string) {
    const profileId = this.profileOf(claims);
    const propertyId = await this.publishedPropertyId(slug);

    await this.db.execute(sql`
      UPDATE favourites
      SET deleted_at = now(), updated_at = now()
      WHERE customer_profile_id = ${profileId}
        AND property_id = ${propertyId}
        AND deleted_at IS NULL
    `);

    return { slug, saved: false };
  }

  /**
   * The id behind a slug, for a listing the public can actually see.
   *
   * `published` is the check that matters: without it a slug could be probed for existence, and a
   * draft could be saved before its partner ever published it.
   */
  private async publishedPropertyId(slug: string): Promise<string> {
    const found = await this.db.execute<{ id: string }>(sql`
      SELECT id FROM properties
      WHERE slug = ${slug} AND status = 'published' AND deleted_at IS NULL
      LIMIT 1
    `);

    const id = found.rows[0]?.id;

    if (!id) throw notFound(ERROR.PROPERTY_NOT_FOUND);

    return id;
  }
}
