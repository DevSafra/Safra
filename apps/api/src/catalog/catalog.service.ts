import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { schema } from '@safra/db';

import { DATABASE } from '../database/database.module.js';
import { ERROR } from '@safra/contracts';
import { notFound } from '../common/errors/app-error.js';

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
   * ## `to_jsonb(c.categories)`, never the bare column
   *
   * `categories` is an array of a Postgres ENUM, and node-postgres parses arrays only for element
   * types it has a built-in parser for. Selected bare, the column arrives as the LITERAL string
   * `'{historic}'` while the generic below promises `string[]` — and a generic on `db.execute` is
   * an assertion, not a check, so nothing failed.
   *
   * The consumer then swallowed it: `apps/web/src/lib/catalog.ts` validates the response and falls
   * back to an empty list rather than throwing, which is right for a reference endpoint that
   * blipped and exactly wrong here. The public home page rendered its destinations grid and its
   * city selector EMPTY, permanently, while `/cities/:slug` — which goes through the query builder,
   * where Drizzle parses the literal itself — kept working.
   */
  async cities() {
    const rows = await this.db.execute<{
      slug: string;
      name_ar: string;
      name_en: string;
      name_de: string;
      country_code: string;
      categories: string[];
      published_count: string;
    }>(sql`
      SELECT
        c.slug, c.name_ar, c.name_en, c.name_de,
        co.code AS country_code,
        -- An enum array reaches the driver as a literal string unless it is cast. See above.
        to_jsonb(c.categories) AS categories,
        -- The count shown on a destination card must reflect what a visitor can
        -- actually book, so unpublished inventory is excluded.
        (
          SELECT COUNT(*)::text FROM properties p
          WHERE p.city_id = c.id AND p.status = 'published' AND p.deleted_at IS NULL
        ) AS published_count
      FROM cities c
      JOIN countries co ON co.id = c.country_id
      WHERE c.is_active AND c.deleted_at IS NULL
      ORDER BY c.sort_order, c.slug
    `);

    return rows.rows.map((r) => ({
      slug: r.slug,
      nameAr: r.name_ar,
      nameEn: r.name_en,
      nameDe: r.name_de,
      countryCode: r.country_code,
      categories: r.categories,
      propertyCount: Number(r.published_count),
    }));
  }

  /** A single city page (§5.4) — description, tags and category. */
  async city(slug: string) {
    const city = await this.db.query.cities.findFirst({
      where: and(eq(schema.cities.slug, slug), isNull(schema.cities.deletedAt)),
      columns: {
        slug: true,
        nameAr: true,
        nameEn: true,
        nameDe: true,
        descriptionAr: true,
        descriptionEn: true,
        descriptionDe: true,
        categories: true,
        tagsAr: true,
        tagsEn: true,
        tagsDe: true,
        timezone: true,
        latitude: true,
        longitude: true,
      },
      with: {
        country: { columns: { code: true, nameAr: true, nameEn: true, nameDe: true } },
      },
    });

    if (!city) throw notFound(ERROR.GEO_CITY_NOT_FOUND);

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

  /** Filterable amenities for the results sidebar (§5.5). */
  async amenities() {
    return this.db.query.amenities.findMany({
      where: and(
        eq(schema.amenities.isFilterable, true),
        isNull(schema.amenities.deletedAt),
      ),
      columns: {
        code: true,
        nameAr: true,
        nameEn: true,
        nameDe: true,
        category: true,
        icon: true,
      },
      orderBy: [asc(schema.amenities.sortOrder)],
    });
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
