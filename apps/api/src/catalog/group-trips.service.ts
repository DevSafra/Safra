import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { ERROR, PUBLIC_GROUP_TRIPS_LIMIT } from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import { notFound } from '../common/errors/app-error.js';

type PublicTripRow = {
  readonly slug: string;
  readonly title_ar: string;
  readonly title_en: string | null;
  readonly title_de: string | null;
  readonly summary_ar: string;
  readonly summary_en: string | null;
  readonly summary_de: string | null;
  readonly description_ar: string | null;
  readonly description_en: string | null;
  readonly description_de: string | null;
  readonly city_slug: string;
  readonly city_name_ar: string;
  readonly city_name_en: string;
  readonly city_name_de: string;
  readonly starts_on: string;
  readonly ends_on: string;
  readonly price_from: string | null;
  readonly currency_code: string | null;
  readonly seats: number | null;
};

/**
 * جروبات — what a visitor is shown (Bashar, 2026-09-27; built 2026-09-28).
 *
 * ## `status = 'published'` is in the WHERE clause, not a filter afterwards
 *
 * The same rule the reviews read follows. A draft is a trip staff are still writing and an archived
 * one is a trip that will not run; neither may leave the database on this path, so the predicate is
 * part of the query rather than something applied to rows already fetched. A client-side filter is
 * one reorder away from publishing a draft.
 *
 * ## The list is capped, the detail is not paged
 *
 * `PUBLIC_GROUP_TRIPS_LIMIT` bounds the list for the reason the FAQ's cap exists: how many trips
 * exist is an operator decision with nothing bounding it, and this is where that becomes a payload.
 * `group-trip-bounds.integration.test.ts` fires lower and names the work first.
 */
@Injectable()
export class PublicGroupTripsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Published trips, soonest first.
   *
   * Past trips are included rather than hidden: a trip that ran last month is evidence SAFRA runs
   * these, and hiding it would leave the section empty every time between two announcements. The
   * ORDER puts what is still to come first, which is what somebody is here to find.
   */
  async list() {
    const rows = await this.db.execute<PublicTripRow>(sql`
      SELECT g.slug, g.title_ar, g.title_en, g.title_de,
             g.summary_ar, g.summary_en, g.summary_de,
             NULL::text AS description_ar, NULL::text AS description_en, NULL::text AS description_de,
             c.slug AS city_slug, c.name_ar AS city_name_ar,
             c.name_en AS city_name_en, c.name_de AS city_name_de,
             g.starts_on::text, g.ends_on::text,
             g.price_from::text, cur.code AS currency_code,
             g.seats
        FROM group_trips g
        JOIN cities c ON c.id = g.city_id
        LEFT JOIN currencies cur ON cur.id = g.currency_id
       WHERE g.deleted_at IS NULL AND g.status = 'published'
       ORDER BY (g.ends_on < current_date), g.starts_on, g.created_at
       LIMIT ${PUBLIC_GROUP_TRIPS_LIMIT}
    `);

    return { items: rows.rows.map(toPublic) };
  }

  async bySlug(slug: string) {
    const rows = await this.db.execute<PublicTripRow>(sql`
      SELECT g.slug, g.title_ar, g.title_en, g.title_de,
             g.summary_ar, g.summary_en, g.summary_de,
             g.description_ar, g.description_en, g.description_de,
             c.slug AS city_slug, c.name_ar AS city_name_ar,
             c.name_en AS city_name_en, c.name_de AS city_name_de,
             g.starts_on::text, g.ends_on::text,
             g.price_from::text, cur.code AS currency_code,
             g.seats
        FROM group_trips g
        JOIN cities c ON c.id = g.city_id
        LEFT JOIN currencies cur ON cur.id = g.currency_id
       WHERE g.slug = ${slug} AND g.deleted_at IS NULL AND g.status = 'published'
    `);

    const row = rows.rows[0];

    /*
      A draft answers exactly as a slug nobody ever used does. «Not published» and «not there» must
      read the same on a public route, or the difference tells a stranger that a trip is being
      prepared under a name they can now guess.
    */
    if (!row) throw notFound(ERROR.GROUP_TRIP_NOT_FOUND);

    return toPublic(row);
  }
}

function toPublic(row: PublicTripRow) {
  return {
    slug: row.slug,
    title: { ar: row.title_ar, en: row.title_en, de: row.title_de },
    summary: { ar: row.summary_ar, en: row.summary_en, de: row.summary_de },
    description: {
      ar: row.description_ar,
      en: row.description_en,
      de: row.description_de,
    },
    city: {
      slug: row.city_slug,
      name: { ar: row.city_name_ar, en: row.city_name_en, de: row.city_name_de },
    },
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    /* Always together. A price with no currency is the shape the money rule forbids outright. */
    priceFrom: row.price_from,
    currencyCode: row.currency_code,
    seats: row.seats === null ? null : Number(row.seats),
  };
}
