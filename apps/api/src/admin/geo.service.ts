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
  readonly country: string;
  readonly category: string;
  readonly properties: number;
  readonly isActive: boolean;
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
      country: string;
      category: string;
      properties: number;
      is_active: boolean;
    }>(sql`
      SELECT ci.slug, ci.name_ar,
             coalesce(co.name_ar, '—')  AS country,
             -- categories is an ARRAY: a city can be coastal AND historic, as Latakia is.
             -- Joined into one string because the design's category column is a single cell.
             coalesce(array_to_string(ci.categories, ' · '), '—') AS category,
             coalesce(pr.n, 0)::int     AS properties,
             ci.is_active
      FROM cities ci
      LEFT JOIN countries co ON co.id = ci.country_id
      LEFT JOIN (
        SELECT city_id, count(*) AS n FROM properties
        WHERE status = 'published' GROUP BY city_id
      ) pr ON pr.city_id = ci.id
      ${filter}
      ORDER BY ci.is_active DESC, ci.name_ar
    `);

    return result.rows.map((row) => ({
      slug: row.slug,
      nameAr: row.name_ar,
      country: row.country,
      category: row.category,
      properties: row.properties,
      isActive: row.is_active,
    }));
  }
}
