import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';

import { DATABASE } from '../database/database.module.js';

export interface CountryRow {
  readonly code: string;
  readonly nameAr: string;
  readonly currencyCode: string | null;
  readonly activeCities: number;
  readonly isActive: boolean;
}

export interface CurrencyRow {
  readonly code: string;
  readonly nameAr: string;
  readonly symbol: string;
  /** True for the accounting currency — the one everything is measured in. */
  readonly isAccounting: boolean;
  /** Rate to the accounting currency, or null when none is configured. */
  readonly rateToSyp: string | null;
  readonly rateSetAt: string | null;
}

export interface GeoCityRow {
  readonly slug: string;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly nameDe: string;
  readonly country: string;
  readonly countryCode: string;
  /** The joined display string the table's single cell shows. */
  readonly category: string;
  /** The raw values, so an editor can show which are ticked. */
  readonly categories: readonly string[];
  readonly timezone: string;
  readonly properties: number;
  readonly isActive: boolean;
  /**
   * The photographs behind §5.4's «أول ثلثها صور عالية الجودة».
   *
   * The count and the hero, so the table can say whether a city HAS any without a second round
   * trip. `city_images`, its controller and the re-encoding worker have all existed since the
   * table was written and nothing ever called them: nine cities, zero rows, and a public city page
   * rendering a gradient where the design asks for photography.
   */
  readonly images: number;
  readonly heroKey: string | null;
  readonly heroWidths: readonly number[] | null;
}

/**
 * المدن والدول والعملات (design handoff §8).
 *
 * The screen exists because of P-005: launch geography and exchange rates are OPERATIONAL
 * values, adjusted by staff, not constants edited by a developer and deployed. The handoff
 * says it directly — "أسعار الصرف تُعدَّل من هنا لا من الكود".
 *
 * ## Read-only in this pass
 *
 * Adding a country, a city or a currency is a write with real consequences — a city with no
 * images and no properties would appear in the public search — and each needs its own
 * validated form and audit entry. This service backs the three lists the design shows; the add
 * actions are rendered as disabled with the reason, rather than as buttons that do nothing.
 *
 * FX rates already have a full write path with audited history elsewhere in the console, so
 * they are shown here and edited there rather than duplicated.
 */
@Injectable()
export class GeoService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async countries(): Promise<CountryRow[]> {
    const result = await this.db.execute<{
      code: string;
      name_ar: string;
      currency_code: string | null;
      active_cities: number;
      is_active: boolean;
    }>(sql`
      SELECT co.code, co.name_ar,
             cur.code                       AS currency_code,
             coalesce(ci.n, 0)::int         AS active_cities,
             co.is_active
      FROM countries co
      LEFT JOIN currencies cur ON cur.id = co.display_currency_id
      LEFT JOIN (
        SELECT country_id, count(*) AS n FROM cities WHERE is_active GROUP BY country_id
      ) ci ON ci.country_id = co.id
      ORDER BY co.is_active DESC, co.name_ar
    `);

    return result.rows.map((row) => ({
      code: row.code,
      nameAr: row.name_ar,
      currencyCode: row.currency_code,
      activeCities: row.active_cities,
      isActive: row.is_active,
    }));
  }

  /**
   * Currencies with their current rate to SYP.
   *
   * SYP is the accounting currency, so its own rate is 1 by definition and is not read from
   * `fx_rates`. Every other currency shows the LATEST rate, and `null` when none exists — the
   * platform refuses to price a booking in that case rather than guessing, so surfacing the
   * gap here is what lets somebody fix it before a customer hits it.
   */
  async currencies(): Promise<CurrencyRow[]> {
    const result = await this.db.execute<{
      code: string;
      name_ar: string;
      symbol: string;
      is_accounting: boolean;
      rate_to_syp: string | null;
      rate_set_at: string | null;
    }>(sql`
      SELECT c.code, c.name_ar, c.symbol,
             (c.code = 'SYP') AS is_accounting,
             fx.rate::text    AS rate_to_syp,
             to_char(fx.effective_from AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS rate_set_at
      FROM currencies c
      -- base -> quote, matching FxRateService: a rate row says how many units of the QUOTE
      -- currency one unit of the BASE buys, and every stored rate quotes into SYP. Reading it
      -- the other way round renders 12,500 as 0.00008 and looks like a formatter bug.
      -- (No backticks in here: this comment lives inside a sql template literal, and one
      --  would terminate the string. That cost an hour once already.)
      LEFT JOIN LATERAL (
        SELECT f.rate, f.effective_from
        FROM fx_rates f
        JOIN currencies q ON q.id = f.quote_currency_id
        WHERE f.base_currency_id = c.id
          AND q.code = 'SYP'
          AND f.effective_from <= now()
        ORDER BY f.effective_from DESC
        LIMIT 1
      ) fx ON TRUE
      -- Retired currencies are gone from the screen, not greyed out on it: this list has no
      -- status column, so a retired row would read as an offer the platform still makes.
      -- JOD and LBP were retired on 2026-08-30 -- see post/0017.
      WHERE c.deleted_at IS NULL
      ORDER BY (c.code = 'SYP') DESC, c.code
    `);

    return result.rows.map((row) => ({
      code: row.code,
      nameAr: row.name_ar,
      symbol: row.symbol,
      isAccounting: row.is_accounting,
      rateToSyp: row.is_accounting ? '1' : row.rate_to_syp,
      rateSetAt: row.rate_set_at,
    }));
  }

  /**
   * Cities with their published-property counts.
   *
   * Not paginated: there are nine, the design shows them all, and the launch plan is three
   * countries. If this ever grows past a screenful it needs the same keyset treatment as the
   * registries — noted here so the next person does not have to rediscover why it differs.
   */
  async cities(q?: string): Promise<GeoCityRow[]> {
    const filter = q
      ? sql`WHERE ci.name_ar ILIKE ${`%${q}%`} OR ci.slug ILIKE ${`${q}%`}`
      : sql``;

    const result = await this.db.execute<{
      slug: string;
      name_ar: string;
      name_en: string;
      name_de: string;
      country: string;
      country_code: string;
      category: string;
      categories: string[];
      timezone: string;
      properties: number;
      is_active: boolean;
      images: number;
      hero_key: string | null;
      hero_widths: number[] | null;
    }>(sql`
      SELECT ci.slug, ci.name_ar, ci.name_en, ci.name_de,
             coalesce(co.name_ar, '—')  AS country,
             coalesce(co.code, '')      AS country_code,
             -- categories is an ARRAY: a city can be coastal AND historic, as Latakia is.
             -- Joined into one string because the design's category column is a single cell.
             coalesce(array_to_string(ci.categories, ' · '), '—') AS category,
             ci.categories::text[]      AS categories,
             ci.timezone,
             coalesce(pr.n, 0)::int     AS properties,
             ci.is_active,
             coalesce(im.n, 0)::int     AS images,
             hero.file_key              AS hero_key,
             hero.variant_widths        AS hero_widths
      FROM cities ci
      LEFT JOIN countries co ON co.id = ci.country_id
      LEFT JOIN (
        SELECT city_id, count(*) AS n FROM properties
        WHERE status = 'published' GROUP BY city_id
      ) pr ON pr.city_id = ci.id
      LEFT JOIN (
        SELECT city_id, count(*) AS n FROM city_images
        WHERE deleted_at IS NULL GROUP BY city_id
      ) im ON im.city_id = ci.id
      -- The hero, or the first image where none is flagged: a city with photographs must show one.
      LEFT JOIN LATERAL (
        SELECT file_key, variant_widths FROM city_images
        WHERE city_id = ci.id AND deleted_at IS NULL
        ORDER BY is_hero DESC, sort_order, created_at
        LIMIT 1
      ) hero ON TRUE
      ${filter}
      ORDER BY ci.is_active DESC, ci.name_ar
    `);

    return result.rows.map((row) => ({
      slug: row.slug,
      nameAr: row.name_ar,
      nameEn: row.name_en,
      nameDe: row.name_de,
      country: row.country,
      countryCode: row.country_code,
      category: row.category,
      categories: row.categories,
      timezone: row.timezone,
      properties: row.properties,
      isActive: row.is_active,
      images: row.images,
      heroKey: row.hero_key,
      heroWidths: row.hero_widths,
    }));
  }
}
