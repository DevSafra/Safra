import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import {
  ERROR,
  type CreateCityInput,
  type CreateCountryInput,
  type CreateCurrencyInput,
  type UpdateCityInput,
  type UpdateCountryInput,
  type UpdateCurrencyInput,
} from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { badRequest, conflict, notFound } from '../common/errors/app-error.js';

/**
 * Creating and correcting geography — the three «+ إضافة» buttons, and the rows they add.
 *
 * ## The gap this closes
 *
 * P-005 says launch geography is an OPERATIONAL value staff adjust, not a constant a developer
 * edits and deploys. The screen has shown «+ إضافة دولة», «+ إضافة عملة» and «+ إضافة مدينة»
 * disabled since it was built, and the cities table had no way into a row at all: a market could
 * be opened only by a migration, and could not be closed at all. Bashar asked for all three
 * (2026-08-30).
 *
 * ## Nothing is ever deleted
 *
 * A country, a city and a currency are referenced by bookings, properties and ledger rows that
 * outlive any decision to stop selling somewhere. `is_active` is how a market closes: the row
 * stays, everything already priced in it still reads, and the public search stops offering it.
 *
 * ## Every write is audited, and the audit carries the CODE
 *
 * Not the row id: an operator reading سجل التدقيق needs to know which country changed, and a uuid
 * answers that only if they go and look it up.
 */
@Injectable()
export class GeoWriteService {
  private readonly logger = new Logger(GeoWriteService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /**
   * Whether the runtime recognises this as an IANA zone.
   *
   * Asked of `Intl` rather than checked against a list of our own: the list ships with the
   * platform, changes when the tzdata does, and a hand-kept copy would drift the first time a
   * country redefined its offset. §5.3's same-day cutoff is 17:00 in the CITY's local time, so a
   * city stored with a zone Node cannot resolve closes its own bookings at the wrong hour — or
   * throws when somebody tries to book.
   */
  private assertTimezone(zone: string): void {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(new Date(0));
    } catch {
      throw badRequest(ERROR.GEO_TIMEZONE_INVALID);
    }
  }

  /** The currency's id, or a refusal naming the currency rather than the request. */
  private async currencyId(code: string): Promise<string> {
    const found = await this.db.execute<{ id: string }>(sql`
      SELECT id::text FROM currencies WHERE code = ${code} AND deleted_at IS NULL LIMIT 1
    `);

    const row = found.rows[0];

    if (!row) throw badRequest(ERROR.GEO_CURRENCY_UNKNOWN);

    return row.id;
  }

  private async countryId(code: string): Promise<string> {
    const found = await this.db.execute<{ id: string }>(sql`
      SELECT id::text FROM countries WHERE code = ${code} AND deleted_at IS NULL LIMIT 1
    `);

    const row = found.rows[0];

    if (!row) throw notFound(ERROR.GEO_COUNTRY_NOT_FOUND);

    return row.id;
  }

  /* ── Currencies ─────────────────────────────────────────────────────────── */

  async createCurrency(
    actor: AccessTokenClaims | undefined,
    input: CreateCurrencyInput,
  ): Promise<{ code: string }> {
    const clash = await this.db.execute<{ code: string }>(sql`
      SELECT code FROM currencies WHERE code = ${input.code} LIMIT 1
    `);

    /*
      Checked before the insert AND unique in the database. The check gives the operator a
      sentence naming the clash; the constraint is what makes it true under a second request.
    */
    if (clash.rows[0]) throw conflict(ERROR.GEO_CODE_TAKEN);

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO currencies (code, name_ar, name_en, name_de, symbol, decimals, is_active)
        VALUES (${input.code}, ${input.nameAr}, ${input.nameEn}, ${input.nameDe},
                ${input.symbol}, ${input.decimals}, true)
      `);

      await this.audit.record(
        {
          actorUserId: actor?.sub,
          actorRole: actor?.role,
          action: 'currency.created',
          subjectType: 'currency',
          after: { code: input.code, symbol: input.symbol, decimals: input.decimals },
        },
        tx as unknown as Database,
      );
    });

    /*
      A new currency prices nothing until somebody records a rate for it — `fx` refuses rather
      than defaulting to 1, and the geography screen prints «لا سعر صرف مُعرَّف» in red until then.
    */
    this.logger.log(
      `Currency ${input.code} added. It cannot price a booking until an FX rate is recorded.`,
    );

    return { code: input.code };
  }

  async updateCurrency(
    actor: AccessTokenClaims | undefined,
    code: string,
    input: UpdateCurrencyInput,
  ): Promise<{ code: string }> {
    const before = await this.db.execute<{
      name_ar: string;
      symbol: string;
      is_active: boolean;
    }>(sql`
      SELECT name_ar, symbol, is_active FROM currencies
      WHERE code = ${code} AND deleted_at IS NULL LIMIT 1
    `);

    const row = before.rows[0];

    if (!row) throw notFound(ERROR.GEO_CURRENCY_UNKNOWN);

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE currencies SET
          name_ar   = coalesce(${input.nameAr ?? null}, name_ar),
          name_en   = coalesce(${input.nameEn ?? null}, name_en),
          name_de   = coalesce(${input.nameDe ?? null}, name_de),
          symbol    = coalesce(${input.symbol ?? null}, symbol),
          is_active = coalesce(${input.isActive ?? null}, is_active),
          updated_at = now()
        WHERE code = ${code} AND deleted_at IS NULL
      `);

      await this.audit.record(
        {
          actorUserId: actor?.sub,
          actorRole: actor?.role,
          action: 'currency.updated',
          subjectType: 'currency',
          before: { code, nameAr: row.name_ar, isActive: row.is_active },
          after: { code, ...input },
        },
        tx as unknown as Database,
      );
    });

    return { code };
  }

  /* ── Countries ──────────────────────────────────────────────────────────── */

  async createCountry(
    actor: AccessTokenClaims | undefined,
    input: CreateCountryInput,
  ): Promise<{ code: string }> {
    const clash = await this.db.execute<{ code: string }>(sql`
      SELECT code FROM countries WHERE code = ${input.code} LIMIT 1
    `);

    if (clash.rows[0]) throw conflict(ERROR.GEO_CODE_TAKEN);

    const currency = await this.currencyId(input.displayCurrencyCode);

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO countries
          (code, name_ar, name_en, name_de, display_currency_id, is_launch_market, is_active)
        VALUES (${input.code}, ${input.nameAr}, ${input.nameEn}, ${input.nameDe},
                ${currency}::uuid, ${input.isLaunchMarket}, true)
      `);

      await this.audit.record(
        {
          actorUserId: actor?.sub,
          actorRole: actor?.role,
          action: 'country.created',
          subjectType: 'country',
          after: {
            code: input.code,
            currency: input.displayCurrencyCode,
            isLaunchMarket: input.isLaunchMarket,
          },
        },
        tx as unknown as Database,
      );
    });

    return { code: input.code };
  }

  async updateCountry(
    actor: AccessTokenClaims | undefined,
    code: string,
    input: UpdateCountryInput,
  ): Promise<{ code: string }> {
    const before = await this.db.execute<{ name_ar: string; is_active: boolean }>(sql`
      SELECT name_ar, is_active FROM countries
      WHERE code = ${code} AND deleted_at IS NULL LIMIT 1
    `);

    const row = before.rows[0];

    if (!row) throw notFound(ERROR.GEO_COUNTRY_NOT_FOUND);

    const currency =
      input.displayCurrencyCode === undefined
        ? null
        : await this.currencyId(input.displayCurrencyCode);

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE countries SET
          name_ar             = coalesce(${input.nameAr ?? null}, name_ar),
          name_en             = coalesce(${input.nameEn ?? null}, name_en),
          name_de             = coalesce(${input.nameDe ?? null}, name_de),
          display_currency_id = coalesce(${currency}::uuid, display_currency_id),
          is_launch_market    = coalesce(${input.isLaunchMarket ?? null}, is_launch_market),
          is_active           = coalesce(${input.isActive ?? null}, is_active),
          updated_at = now()
        WHERE code = ${code} AND deleted_at IS NULL
      `);

      await this.audit.record(
        {
          actorUserId: actor?.sub,
          actorRole: actor?.role,
          action: 'country.updated',
          subjectType: 'country',
          before: { code, nameAr: row.name_ar, isActive: row.is_active },
          after: { code, ...input },
        },
        tx as unknown as Database,
      );
    });

    return { code };
  }

  /* ── Cities ─────────────────────────────────────────────────────────────── */

  async createCity(
    actor: AccessTokenClaims | undefined,
    input: CreateCityInput,
  ): Promise<{ slug: string }> {
    this.assertTimezone(input.timezone);

    const country = await this.countryId(input.countryCode);

    /* Unique per COUNTRY, not globally: two countries may each have a «طرابلس». */
    const clash = await this.db.execute<{ slug: string }>(sql`
      SELECT slug FROM cities
      WHERE country_id = ${country}::uuid AND slug = ${input.slug} AND deleted_at IS NULL
      LIMIT 1
    `);

    if (clash.rows[0]) throw conflict(ERROR.GEO_SLUG_TAKEN);

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO cities
          (country_id, slug, name_ar, name_en, name_de, timezone, categories, is_active)
        VALUES (${country}::uuid, ${input.slug}, ${input.nameAr}, ${input.nameEn},
                ${input.nameDe}, ${input.timezone},
                ${sql.raw(categoriesLiteral(input.categories))}, true)
      `);

      await this.audit.record(
        {
          actorUserId: actor?.sub,
          actorRole: actor?.role,
          action: 'city.created',
          subjectType: 'city',
          after: {
            slug: input.slug,
            country: input.countryCode,
            timezone: input.timezone,
          },
        },
        tx as unknown as Database,
      );
    });

    return { slug: input.slug };
  }

  async updateCity(
    actor: AccessTokenClaims | undefined,
    slug: string,
    input: UpdateCityInput,
  ): Promise<{ slug: string }> {
    if (input.timezone !== undefined) this.assertTimezone(input.timezone);

    const before = await this.db.execute<{
      id: string;
      name_ar: string;
      is_active: boolean;
      properties: number;
    }>(sql`
      SELECT c.id::text, c.name_ar, c.is_active,
             (SELECT count(*)::int FROM properties p
              WHERE p.city_id = c.id AND p.status = 'published' AND p.deleted_at IS NULL)
               AS properties
      FROM cities c
      WHERE c.slug = ${slug} AND c.deleted_at IS NULL
      LIMIT 1
    `);

    const row = before.rows[0];

    if (!row) throw notFound(ERROR.GEO_CITY_NOT_FOUND);

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE cities SET
          name_ar   = coalesce(${input.nameAr ?? null}, name_ar),
          name_en   = coalesce(${input.nameEn ?? null}, name_en),
          name_de   = coalesce(${input.nameDe ?? null}, name_de),
          timezone  = coalesce(${input.timezone ?? null}, timezone),
          is_active = coalesce(${input.isActive ?? null}, is_active),
          categories = ${
            input.categories === undefined
              ? sql`categories`
              : sql.raw(categoriesLiteral(input.categories))
          },
          updated_at = now()
        WHERE id = ${row.id}::uuid
      `);

      await this.audit.record(
        {
          actorUserId: actor?.sub,
          actorRole: actor?.role,
          action: 'city.updated',
          subjectType: 'city',
          before: { slug, nameAr: row.name_ar, isActive: row.is_active },
          /*
            How many PUBLISHED properties this decision affects. Closing a city hides them from
            the public search, and an audit row that recorded the flag without the consequence
            would leave nobody able to answer «how much did that cost us» afterwards.
          */
          after: { slug, ...input, publishedProperties: row.properties },
        },
        tx as unknown as Database,
      );
    });

    return { slug };
  }
}

/**
 * The categories array, as a literal.
 *
 * `sql.raw` because a JavaScript array binds as a TUPLE rather than a Postgres array — the trap
 * `scope.sql.ts` records. Every element has already been narrowed by `cityCategorySchema` to one
 * of four enum members, so nothing caller-supplied reaches this string; the assertion below is
 * what keeps that true if the schema and this function ever drift.
 */
function categoriesLiteral(categories: readonly string[]): string {
  const allowed = new Set(['coastal', 'mountain', 'desert', 'historic']);

  for (const category of categories) {
    if (!allowed.has(category)) throw badRequest(ERROR.REQUEST_VALIDATION_FAILED);
  }

  return categories.length === 0
    ? `'{}'::city_category[]`
    : `ARRAY[${categories.map((c) => `'${c}'`).join(',')}]::city_category[]`;
}
