import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { schema } from '@safra/db';

import { DATABASE } from '../database/database.module.js';

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

  /** Cities for the search selector and the destinations grid. */
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
        c.categories,
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

    if (!city) throw new NotFoundException('City not found.');

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
}
