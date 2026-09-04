import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { schema } from '@safra/db';

import { DATABASE } from '../database/database.module.js';
import { ERROR } from '@safra/contracts';
import { notFound } from '../common/errors/app-error.js';

/**
 * One city's ACTIVE categories, as a jsonb array of `{code, nameAr, nameEn, nameDe}`.
 *
 * Written once and used by both readers below, because a list and the detail page showing
 * different categories for the same city is a defect nobody would look for. Correlated on `c.id`,
 * so it goes wherever `cities c` is in scope. `sort_order` is what الفئات's arrows write, so the
 * order a customer reads is the order staff chose.
 */
const CITY_CATEGORIES_JSON = sql`
  coalesce((
    SELECT jsonb_agg(
             jsonb_build_object(
               'code', cc.code,
               'nameAr', cc.name_ar,
               'nameEn', cc.name_en,
               'nameDe', cc.name_de
             )
             ORDER BY cc.sort_order, cc.code
           )
    FROM city_category_links l
    JOIN city_categories cc ON cc.id = l.category_id
    WHERE l.city_id = c.id AND cc.is_active AND cc.deleted_at IS NULL
  ), '[]'::jsonb)
`;

/**
 * One city's COVER photograph, or SQL `null` where it has none.
 *
 * The home page shows destinations as photographs rather than as named boxes, and the only
 * picture of a city the platform holds is the one staff uploaded on الجغرافيا. Selected here
 * rather than fetched per card: nine cities would otherwise be nine round trips on a page with a
 * 200 ms budget.
 *
 * `is_hero DESC, sort_order` is the SAME ordering the detail page uses, deliberately — a visitor
 * who clicks a destination must land on the photograph they clicked, and two orderings written
 * separately drift the first time somebody reorders a gallery.
 *
 * `variant_widths` needs NO `to_jsonb` here, unlike the categories aggregate above. That wrapper
 * was written in out of caution and then proved unnecessary: the integer array is being passed to
 * `jsonb_build_object`, which converts it to a JSON array itself, so it arrives as `[400, 800,
 * 900]` either way. It was removed after the assertion meant to guard it was mutated and stayed
 * green — the trap `categories` fell into is real at the TOP level of a select, not inside a jsonb
 * constructor.
 *
 * `credit` is NOT selected. The column exists for attribution where a licence demands it and no
 * surface renders it today, including the city page; carrying it into a payload nothing prints
 * would be a field that reads as handled. See the report accompanying this change.
 */
const CITY_COVER_JSON = sql`
  (
    SELECT jsonb_build_object(
             'fileKey', i.file_key,
             'variantWidths', i.variant_widths,
             'width', i.width,
             'height', i.height,
             'alt', jsonb_build_object('ar', i.alt_ar, 'en', i.alt_en, 'de', i.alt_de)
           )
    FROM city_images i
    WHERE i.city_id = c.id AND i.deleted_at IS NULL
    ORDER BY i.is_hero DESC, i.sort_order
    LIMIT 1
  )
`;

/**
 * Public reference data for the storefront (SRS §5.1, §5.4).
 *
 * Read-only and cacheable: cities, property types and amenities change through the
 * admin panel, not per request, so the web app can hold these for minutes without
 * risk. Availability is the only thing that must never be cached.
 */
@Injectable()
export class CatalogService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Cities for the search selector and the destinations grid.
   *
   * ## Categories come from the TABLE, not from `cities.categories`
   *
   * They were read from the `city_category[]` column, which is a frozen enum: a category staff
   * add on الفئات has no member there, so it could never reach the public site. The page existed
   * and the rest of the platform could not see what it wrote — «built and connected to nothing»
   * one layer down. `city_category_links` is the authority (see `GeoWriteService.setCategories`),
   * so the read follows it, and «displayed on the entire system» becomes true rather than true
   * for the four categories that happened to predate the screen (Bashar, 2026-08-30).
   *
   * Retired categories are excluded here and kept on the console: a customer must not be offered
   * a filter the platform has withdrawn, while staff still need to see what a city is filed under.
   *
   * ## The names travel with the code
   *
   * Like `partner_types` and every other reference row, and for the reason `docs/i18n.md` gives:
   * a code resolved against a catalogue in the web app is a code that renders as itself the day
   * somebody adds a fifth category. These are DATA — a row's own name in three languages — not
   * copy written in a component.
   *
   * ## `to_jsonb`, never a bare array
   *
   * node-postgres parses arrays only for element types it has a built-in parser for. Selected
   * bare, an enum array arrived as the LITERAL string `'{historic}'` while the generic promised
   * `string[]` — and a generic on `db.execute` is an assertion, not a check, so nothing failed.
   * The consumer then swallowed it and the destinations grid rendered EMPTY, permanently. The
   * aggregate below is jsonb for the same reason.
   */
  async cities() {
    const rows = await this.db.execute<{
      slug: string;
      name_ar: string;
      name_en: string;
      name_de: string;
      country_code: string;
      categories: { code: string; nameAr: string; nameEn: string; nameDe: string }[];
      cover: {
        fileKey: string;
        variantWidths: number[];
        width: number | null;
        height: number | null;
        alt: { ar: string | null; en: string | null; de: string | null };
      } | null;
      published_count: string;
    }>(sql`
      SELECT
        c.slug, c.name_ar, c.name_en, c.name_de,
        co.code AS country_code,
        ${CITY_CATEGORIES_JSON} AS categories,
        ${CITY_COVER_JSON} AS cover,
        -- The count shown on a destination card must reflect what a visitor can
        -- actually book, so unpublished inventory is excluded.
        (
          SELECT COUNT(*)::text FROM properties p
          WHERE p.city_id = c.id AND p.status = 'published' AND p.deleted_at IS NULL
        ) AS published_count
      FROM cities c
      JOIN countries co ON co.id = c.country_id
      -- The COUNTRY has to be open too (Bashar, 2026-08-31).
      --
      -- «When I deactivate a country, its cities will be still activated.» This join has always
      -- been here, for the code, and never checked the flag: closing a market left every one of
      -- its cities in the destinations grid and in the search selector. The confirmation the
      -- console shows when closing one NAMES how many cities it affects, which was a promise the
      -- read did not keep.
      --
      -- Derived rather than cascaded: the city keeps its OWN is_active, so re-opening the country
      -- restores exactly what was there rather than switching on cities somebody had closed
      -- deliberately.
      WHERE c.is_active AND co.is_active AND c.deleted_at IS NULL
      ORDER BY c.sort_order, c.slug
    `);

    return rows.rows.map((r) => ({
      slug: r.slug,
      nameAr: r.name_ar,
      nameEn: r.name_en,
      nameDe: r.name_de,
      countryCode: r.country_code,
      categories: r.categories,
      /* `null` where a city has no photograph — the grid draws that case deliberately. */
      cover: r.cover,
      propertyCount: Number(r.published_count),
    }));
  }

  /**
   * A single city page (§5.4) — description, tags and category.
   *
   * ## Withdrawn means unreachable, not merely unlisted
   *
   * This read checked neither the city's flag nor its country's, so a city taken off the
   * destinations grid still rendered its own page to anybody holding the URL — and §5.4's page is
   * indexed, so «holding the URL» includes every search engine that ever crawled it. A withdrawn
   * market that answers 200 is a market that is still open to the only visitors who matter here.
   *
   * `notFound` rather than a «closed» page, deliberately: what a city IS while withdrawn is not
   * something the design describes, and inventing a state would be inventing product.
   */
  async city(slug: string) {
    const city = await this.db.query.cities.findFirst({
      where: and(
        eq(schema.cities.slug, slug),
        eq(schema.cities.isActive, true),
        isNull(schema.cities.deletedAt),
      ),
      columns: {
        slug: true,
        nameAr: true,
        nameEn: true,
        nameDe: true,
        descriptionAr: true,
        descriptionEn: true,
        descriptionDe: true,
        tagsAr: true,
        tagsEn: true,
        tagsDe: true,
        timezone: true,
        latitude: true,
        longitude: true,
      },
      with: {
        country: {
          columns: {
            code: true,
            nameAr: true,
            nameEn: true,
            nameDe: true,
            /* Read only to enforce the rule below — never returned to a visitor. */
            isActive: true,
          },
        },
      },
    });

    /*
      A city in a CLOSED country is closed. The country's flag cannot be expressed in the query
      builder's `where` without a join it does not offer here, so it is checked on the row — one
      condition, and the same answer either way.
    */
    if (!city || !city.country.isActive) throw notFound(ERROR.GEO_CITY_NOT_FOUND);

    /* Never leaked onward: the visitor is told the city is not there, not why. */
    const { isActive: _countryIsActive, ...country } = city.country;

    /*
      The SAME read as the list — see `CITY_CATEGORIES_JSON`. It is a second query rather than a
      join on the query builder because the builder cannot express a correlated aggregate, and one
      indexed lookup on a page that is already fetching photographs is not the cost worth avoiding.
    */
    const categories = await this.db.execute<{
      categories: { code: string; nameAr: string; nameEn: string; nameDe: string }[];
    }>(sql`
      SELECT ${CITY_CATEGORIES_JSON} AS categories
      FROM cities c
      WHERE c.slug = ${slug} AND c.deleted_at IS NULL
    `);

    // §5.4's hero band. Hero first, then by sort order.
    const images = await this.db.execute<Record<string, unknown>>(sql`
      SELECT i.file_key, i.variant_widths, i.width, i.height,
             i.alt_ar, i.alt_en, i.alt_de, i.credit, i.is_hero
      FROM city_images i
      JOIN cities c ON c.id = i.city_id
      WHERE c.slug = ${slug} AND i.deleted_at IS NULL
      ORDER BY i.is_hero DESC, i.sort_order
    `);

    return {
      ...city,
      country,
      /* From `city_categories`, so a category staff added is on this page too. */
      categories: categories.rows[0]?.categories ?? [],
      images: images.rows.map((r) => ({
        fileKey: r['file_key'],
        variantWidths: (r['variant_widths'] as number[] | null) ?? [],
        width: r['width'] === null ? null : Number(r['width']),
        height: r['height'] === null ? null : Number(r['height']),
        alt: { ar: r['alt_ar'], en: r['alt_en'], de: r['alt_de'] },
        credit: r['credit'],
        isHero: r['is_hero'] === true,
      })),
    };
  }

  /** Property types with a live count, for the "types of stay" grid. */
  /**
   * SAFRA's cancellation policies, for the §7.2 add-property form.
   *
   * Code and the Arabic name only. The tier structure is what the booking flow prices against and
   * is not something a partner chooses between on a dropdown — showing it here would invite the
   * belief that it can be varied per listing, which §7.4 is explicit it cannot.
   */
  async cancellationPolicies() {
    const rows = await this.db.execute<{
      code: string;
      name_ar: string;
      name_en: string | null;
    }>(sql`
      SELECT code, name_ar, name_en
      FROM cancellation_policies
      ORDER BY code
    `);

    return rows.rows.map((row) => ({
      code: row.code,
      nameAr: row.name_ar,
      nameEn: row.name_en,
    }));
  }

  /**
   * The kinds of business that can apply to become a partner (Bashar, 2026-08-19).
   *
   * Public, because «انضم كشريك» is a page anybody may read and the form has to offer real
   * choices. Rows rather than a hardcoded list for the reason the schema gives: adding Mobility
   * is meant to be an INSERT, and a list frozen into the customer app would make it a deployment.
   *
   * The `id` is deliberately absent, as everywhere else in this file. A public form sends a CODE
   * and the server resolves it — a client that could send an id could send any id.
   */
  async partnerTypes() {
    const rows = await this.db.execute<{
      code: string;
      name_ar: string;
      name_en: string;
      name_de: string;
    }>(sql`
      SELECT code, name_ar, name_en, name_de
      FROM partner_types
      WHERE is_active = true AND deleted_at IS NULL
      ORDER BY name_ar
    `);

    return rows.rows.map((row) => ({
      code: row.code,
      nameAr: row.name_ar,
      nameEn: row.name_en,
      nameDe: row.name_de,
    }));
  }

  async propertyTypes() {
    const rows = await this.db.execute<{
      code: string;
      name_ar: string;
      name_en: string;
      name_de: string;
      glyph: string | null;
      published_count: string;
    }>(sql`
      SELECT pt.code, pt.name_ar, pt.name_en, pt.name_de, pt.glyph,
        (
          SELECT COUNT(*)::text FROM properties p
          WHERE p.property_type_id = pt.id AND p.status = 'published' AND p.deleted_at IS NULL
        ) AS published_count
      FROM property_types pt
      WHERE pt.is_active AND pt.deleted_at IS NULL
      ORDER BY pt.sort_order
    `);

    return rows.rows.map((r) => ({
      code: r.code,
      nameAr: r.name_ar,
      nameEn: r.name_en,
      nameDe: r.name_de,
      glyph: r.glyph,
      propertyCount: Number(r.published_count),
    }));
  }

  /**
   * Filterable amenities for the results sidebar (§5.5), each with how many stays actually have it.
   *
   * ## Why the count is not decoration
   *
   * It is the difference between a filter and a trap. `unit_amenities` held **zero rows** on
   * 2026-09-02 while this endpoint listed twelve amenities, so the moment the results page grew a
   * filter panel, every checkbox on it emptied the page. A control whose only possible outcome is
   * «لا نتائج» does not read as an untagged catalogue — it reads as a broken site, and the visitor
   * blames the search rather than the data.
   *
   * The panel therefore lists only amenities with a count above zero, exactly as it prints the
   * count beside each property type. Nothing has to be remembered when staff start tagging: an
   * amenity appears in the filter the moment a published stay has it, and disappears if the last
   * one loses it.
   *
   * ## Counted over BOOKABLE units, not over the link table
   *
   * `COUNT(*) FROM unit_amenities` would count links to units of draft, rejected and deleted
   * properties — so a filter could offer «مسبح · 40» and return nothing, which is the same defect
   * one step quieter. The subquery walks to the property and applies the same `published` and
   * `deleted_at IS NULL` predicate the search itself uses, so the number and the result set are
   * answers to the same question.
   *
   * DISTINCT on the property, not the unit: two rooms with a pool in one hotel is one stay a
   * visitor can find, and «مسبح · 2» over a single result is a number that undermines the rest.
   */
  async amenities() {
    const rows = await this.db.execute<{
      code: string;
      name_ar: string;
      name_en: string;
      name_de: string;
      category: string;
      icon: string | null;
      property_count: string;
    }>(sql`
      SELECT a.code, a.name_ar, a.name_en, a.name_de, a.category, a.icon,
        (
          SELECT COUNT(DISTINCT u.property_id)::text
          FROM unit_amenities ua
          JOIN units u ON u.id = ua.unit_id AND u.deleted_at IS NULL
          JOIN properties p ON p.id = u.property_id
          WHERE ua.amenity_id = a.id
            AND p.status = 'published'
            AND p.deleted_at IS NULL
        ) AS property_count
      FROM amenities a
      WHERE a.is_filterable AND a.deleted_at IS NULL
      ORDER BY a.sort_order
    `);

    return rows.rows.map((r) => ({
      code: r.code,
      nameAr: r.name_ar,
      nameEn: r.name_en,
      nameDe: r.name_de,
      category: r.category,
      icon: r.icon,
      propertyCount: Number(r.property_count),
    }));
  }

  /**
   * The operational values the storefront must display rather than assume — the
   * customer service fee above all (P-005: it is configuration, not a constant).
   *
   * Only non-sensitive keys are exposed. An allow-list rather than a deny-list, so
   * a newly added internal setting is private by default.
   */
  async publicSettings() {
    const PUBLIC_KEYS = [
      'commission.customer_fee_mode',
      'commission.customer_fee_value',
      /* Read by the checkout and the invoice to decide whether to NAME the fee (§9.3). */
      'commission.customer_fee_visible',
      'commission.partner_rate',
      'booking.confirmation_window_minutes',
      'booking.same_day_cutoff_hour',
      'refund.minimum_percent',
    ];

    const rows = await this.db.query.settings.findMany({
      where: (s, { inArray, and: andOp, eq: eqOp }) =>
        andOp(inArray(s.key, PUBLIC_KEYS), eqOp(s.scope, 'global'), isNull(s.deletedAt)),
      columns: { key: true, value: true },
    });

    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  /**
   * Active currencies, and the latest rate for every pair staff have recorded.
   *
   * ## One row per pair, newest first
   *
   * `fx_rates` is a HISTORY — a pair gains a row each time the rate is set, and the old rows stay,
   * because a booking priced last month has to remain explicable. A display conversion wants only
   * the current one, which is what `DISTINCT ON` selects.
   *
   * ## Both directions are not stored, and are not invented here either
   *
   * The table holds USD→SYP; it does not hold SYP→USD. Emitting the inverse from here would look
   * like data and be arithmetic, and the moment a spread or a fee entered the picture the inverse
   * would stop being one divided by the rate. The display side derives it and says so.
   */
  async currencies() {
    const [currencies, rates] = await Promise.all([
      this.db.execute<{ code: string; symbol: string | null }>(sql`
        SELECT code, symbol FROM currencies WHERE is_active = true ORDER BY code
      `),
      this.db.execute<{
        base: string;
        quote: string;
        rate: string;
        effective_from: string;
      }>(sql`
        SELECT DISTINCT ON (f.base_currency_id, f.quote_currency_id)
               b.code AS base, q.code AS quote, f.rate::text AS rate,
               f.effective_from::text AS effective_from
        FROM fx_rates f
        JOIN currencies b ON b.id = f.base_currency_id
        JOIN currencies q ON q.id = f.quote_currency_id
        WHERE f.effective_from <= now()
        ORDER BY f.base_currency_id, f.quote_currency_id, f.effective_from DESC
      `),
    ]);

    return {
      currencies: currencies.rows.map((row) => ({
        code: row.code,
        symbol: row.symbol ?? row.code,
      })),
      rates: rates.rows.map((row) => ({
        base: row.base,
        quote: row.quote,
        rate: row.rate,
        effectiveFrom: row.effective_from,
      })),
    };
  }
}
