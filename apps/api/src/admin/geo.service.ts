import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';

import { DATABASE } from '../database/database.module.js';

export interface CountryRow {
  readonly code: string;
  readonly nameAr: string;
  /* The other two names and the launch flag, so the row can be EDITED without a second fetch. */
  readonly nameEn: string;
  readonly nameDe: string;
  readonly currencyCode: string | null;
  readonly isLaunchMarket: boolean;
  readonly activeCities: number;
  readonly isActive: boolean;
}

export interface CurrencyRow {
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly nameDe: string;
  readonly symbol: string;
  /**
   * Whether the platform still offers it.
   *
   * Absent until 2026-08-30, when currencies became editable: a list with no state renders a
   * deactivated currency identically to a live one, which is an offer the platform has withdrawn
   * and the screen still appears to make.
   */
  readonly isActive: boolean;
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
   * Whether its COUNTRY is open.
   *
   * A city in a closed country is not offered anywhere a visitor can reach, whatever its own flag
   * says — so a console that printed «نشطة» beside it was stating something untrue about a place
   * nobody could book. Carried rather than derived on the client because the rule belongs with
   * the read that enforces it.
   */
  readonly countryActive: boolean;
  /** Its place in the PUBLIC destinations grid — `catalog.service` orders by this. */
  readonly sortOrder: number;
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
  /**
   * Every photograph, with what it SAYS — so the editor can manage it (Bashar, 2026-08-31).
   *
   * The count and the hero above answer «does this city have pictures». They cannot answer «what
   * is the alt text on the third one», which is the question §5.4's accessibility depends on: the
   * hero band is the first third of the public city page and every image on it went out with an
   * empty `alt` until this shipped.
   *
   * Bounded by `MAX_IMAGES_PER_CITY` (12) and by nine cities, on a screen that is a documented
   * exception to pagination — see `geo-bounds.integration.test.ts`, which fails if that stops
   * being true.
   */
  readonly photographs: readonly GeoCityImage[];
  /** The prose §5.4 renders under the name, editable here rather than only by migration. */
  readonly descriptionAr: string | null;
  readonly descriptionEn: string | null;
  readonly descriptionDe: string | null;
  readonly tagsAr: readonly string[];
  readonly tagsEn: readonly string[];
  readonly tagsDe: readonly string[];
}

/** One city photograph, as the console manages it. Never the bytes — see `updateCityImageSchema`. */
export interface GeoCityImage {
  readonly id: string;
  readonly fileKey: string;
  readonly variantWidths: readonly number[];
  readonly altAr: string | null;
  readonly altEn: string | null;
  readonly altDe: string | null;
  readonly credit: string | null;
  readonly isHero: boolean;
  readonly sortOrder: number;
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
      name_en: string;
      name_de: string;
      currency_code: string | null;
      is_launch_market: boolean;
      active_cities: number;
      is_active: boolean;
    }>(sql`
      SELECT co.code, co.name_ar, co.name_en, co.name_de,
             cur.code                       AS currency_code,
             co.is_launch_market,
             coalesce(ci.n, 0)::int         AS active_cities,
             co.is_active
      FROM countries co
      LEFT JOIN currencies cur ON cur.id = co.display_currency_id
      LEFT JOIN (
        SELECT country_id, count(*) AS n FROM cities
        WHERE is_active AND deleted_at IS NULL GROUP BY country_id
      ) ci ON ci.country_id = co.id
      -- A DELETED country is gone from the screen, like a retired currency below. The filter was
      -- absent because nothing could delete one until 2026-08-31; a soft delete with no filter
      -- would have left the row sitting there looking untouched.
      WHERE co.deleted_at IS NULL
      ORDER BY co.is_active DESC, co.name_ar
    `);

    return result.rows.map((row) => ({
      code: row.code,
      nameAr: row.name_ar,
      nameEn: row.name_en,
      nameDe: row.name_de,
      currencyCode: row.currency_code,
      isLaunchMarket: row.is_launch_market,
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
      name_en: string;
      name_de: string;
      symbol: string;
      is_active: boolean;
      is_accounting: boolean;
      rate_to_syp: string | null;
      rate_set_at: string | null;
    }>(sql`
      SELECT c.code, c.name_ar, c.name_en, c.name_de, c.symbol, c.is_active,
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
      nameEn: row.name_en,
      nameDe: row.name_de,
      symbol: row.symbol,
      isActive: row.is_active,
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
    /*
      A deleted city is gone from the screen. Written into BOTH branches rather than appended,
      because `WHERE a OR b` plus `AND deleted_at IS NULL` needs the search terms bracketed — an
      appended clause would have bound only to the slug half and left deleted cities matching by
      name. Cheaper to write it twice than to be subtly wrong once.
    */
    const filter = q
      ? sql`WHERE ci.deleted_at IS NULL
              AND (ci.name_ar ILIKE ${`%${q}%`} OR ci.slug ILIKE ${`${q}%`})`
      : sql`WHERE ci.deleted_at IS NULL`;

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
      country_active: boolean;
      sort_order: number;
      images: number;
      photographs: GeoCityImage[];
      description_ar: string | null;
      description_en: string | null;
      description_de: string | null;
      tags_ar: string[] | null;
      tags_en: string[] | null;
      tags_de: string[] | null;
      hero_key: string | null;
      hero_widths: number[] | null;
    }>(sql`
      SELECT ci.slug, ci.name_ar, ci.name_en, ci.name_de,
             coalesce(co.name_ar, '—')  AS country,
             coalesce(co.code, '')      AS country_code,
             -- ── What a city is filed under, read from city_category_links ───────────
             --
             -- Both of these came off ci.categories, the frozen city_category[] column, so a
             -- category staff added on الفئات appeared in NEITHER: not in the table's cell, and
             -- not ticked in the editor that wrote it. The links table is the authority — see
             -- GeoWriteService.setCategories — so both follow it.
             --
             -- The cell carries the ARABIC NAMES because the design's category column is one
             -- cell and a code is not a word; the editor gets CODES because a checkbox is keyed
             -- by the identifier, not by a name somebody may rename tomorrow. A city can be
             -- coastal AND historic, as Latakia is, hence an aggregate rather than a column.
             coalesce((
               SELECT string_agg(cc.name_ar, ' · ' ORDER BY cc.sort_order, cc.code)
               FROM city_category_links l
               JOIN city_categories cc ON cc.id = l.category_id
               WHERE l.city_id = ci.id AND cc.deleted_at IS NULL
             ), '—')                    AS category,
             coalesce((
               SELECT array_agg(cc.code ORDER BY cc.sort_order, cc.code)
               FROM city_category_links l
               JOIN city_categories cc ON cc.id = l.category_id
               WHERE l.city_id = ci.id AND cc.deleted_at IS NULL
             ), '{}')::text[]           AS categories,
             ci.timezone,
             coalesce(pr.n, 0)::int     AS properties,
             ci.is_active,
             coalesce(co.is_active, false) AS country_active,
             ci.sort_order,
             ci.description_ar, ci.description_en, ci.description_de,
             ci.tags_ar, ci.tags_en, ci.tags_de,
             coalesce(im.n, 0)::int     AS images,
             -- Every photograph with its metadata, in the order §5.4's band draws them.
             -- jsonb rather than a second query: nine cities, twelve pictures each at most.
             coalesce((
               SELECT jsonb_agg(
                        jsonb_build_object(
                          'id', p.id::text,
                          'fileKey', p.file_key,
                          'variantWidths', p.variant_widths,
                          'altAr', p.alt_ar,
                          'altEn', p.alt_en,
                          'altDe', p.alt_de,
                          'credit', p.credit,
                          'isHero', p.is_hero,
                          'sortOrder', p.sort_order
                        )
                        -- sort_order ALONE, which is what the arrows write.
                        --
                        -- It was is_hero DESC first, mirroring the public read. That pinned the
                        -- hero to row one whatever its position, so pressing the up arrow on row
                        -- two wrote sort_order correctly and the list did not move: the control
                        -- looked dead (Bashar, 2026-08-31). A list ordered by something other
                        -- than the value its own arrows write cannot be reordered.
                        --
                        -- The public read still draws the hero first -- it is chosen by the FLAG,
                        -- not by position, and the badge on this screen says which one it is.
                        ORDER BY p.sort_order, p.created_at
                      )
               FROM city_images p
               WHERE p.city_id = ci.id AND p.deleted_at IS NULL
             ), '[]'::jsonb)            AS photographs,
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
      -- The PUBLIC order, because that is the thing being managed (Bashar, 2026-08-31).
      -- It was is_active DESC, name_ar -- a reasonable way to READ a list and a useless way to
      -- reorder one: the arrows would have moved rows around in an order nobody sees. The
      -- catalogue service sorts the destinations grid by sort_order, so this does too, and the
      -- slug breaks a tie the same way it does there. Backticks are absent on purpose: they
      -- terminate the sql template they sit inside.
      ORDER BY ci.sort_order, ci.slug
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
      countryActive: row.country_active,
      sortOrder: row.sort_order,
      images: row.images,
      photographs: row.photographs,
      descriptionAr: row.description_ar,
      descriptionEn: row.description_en,
      descriptionDe: row.description_de,
      /* Always an array, so no consumer has to guard before mapping. */
      tagsAr: row.tags_ar ?? [],
      tagsEn: row.tags_en ?? [],
      tagsDe: row.tags_de ?? [],
      heroKey: row.hero_key,
      heroWidths: row.hero_widths,
    }));
  }
}
