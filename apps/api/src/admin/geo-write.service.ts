import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';

import type { Database } from '@safra/db';
import {
  ACCOUNTING_CURRENCY,
  currencyOption,
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
    /*
      A RETIRED code is free again.

      This read every row, so once `post/0017` retired JOD and LBP neither could ever be added
      back — «that code is already in use» about a currency the screen does not show and the reads
      filter out. Retiring is how this platform stops offering something; it is not a tombstone
      that blocks the name for ever.

      Reinstating one is `UPDATE … deleted_at = NULL` rather than a second row, because the id is
      what bookings, wallet movements and ledger rows point at — a new row would leave the history
      pointing at the retired one.
    */
    const clash = await this.db.execute<{ code: string; retired: boolean }>(sql`
      SELECT code, (deleted_at IS NOT NULL) AS retired
      FROM currencies WHERE code = ${input.code} LIMIT 1
    `);

    /*
      Checked before the insert AND unique in the database. The check gives the operator a
      sentence naming the clash; the constraint is what makes it true under a second request.
    */
    const existing = clash.rows[0];

    if (existing && !existing.retired) throw conflict(ERROR.GEO_CODE_TAKEN);

    /*
      The symbol and the minor-unit digits come from the CODE, never from the request.

      A caller supplying both could store «USD» with «€» — every dollar on the platform then
      renders with a euro sign, and nothing refuses it — or JOD with two decimals, which truncates
      10.125 to 10.13 on the way in. Both are properties of ISO 4217, so the catalogue is the
      authority and a code outside it is refused rather than half-known.
    */
    const known = currencyOption(input.code);

    if (!known) throw badRequest(ERROR.GEO_CURRENCY_UNKNOWN);

    await this.db.transaction(async (tx) => {
      await tx.execute(
        existing
          ? sql`
              UPDATE currencies SET
                deleted_at = NULL, is_active = true,
                name_ar = ${input.nameAr}, name_en = ${input.nameEn},
                name_de = ${input.nameDe},
                symbol = ${known.symbol}, decimals = ${known.decimals},
                updated_at = now()
              WHERE code = ${input.code}
            `
          : sql`
              INSERT INTO currencies
                (code, name_ar, name_en, name_de, symbol, decimals, is_active)
              VALUES (${input.code}, ${input.nameAr}, ${input.nameEn}, ${input.nameDe},
                      ${known.symbol}, ${known.decimals}, true)
            `,
      );

      await this.audit.record(
        {
          actorUserId: actor?.sub,
          actorRole: actor?.role,
          action: 'currency.created',
          subjectType: 'currency',
          after: {
            code: input.code,
            symbol: known.symbol,
            decimals: known.decimals,
            /* Whether this brought a retired currency back, which is not the same event. */
            reinstated: existing !== undefined,
          },
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
      is_active: boolean;
    }>(sql`
      SELECT name_ar, is_active FROM currencies
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
          /* No symbol here: it belongs to the CODE, and the code is not editable. */
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

  /* ── Deleting ───────────────────────────────────────────────────────────────
   *
   * Bashar (2026-08-31): «I can add/edit everything on the page المدن والدول والعملات but I can
   * not delete». He was right — there was no delete at all, on any of the four tables.
   *
   * ## What delete MEANS here, and why it is not simply DELETE FROM
   *
   * These are reference rows: a booking names its city and its currency, a ledger entry names its
   * currency, a property names its city. Those records outlive any decision to stop using the row
   * they point at, and a hard delete would either be refused by the foreign key or — worse, if the
   * key were relaxed — leave a booking whose city cannot be named. So a row goes only when NOTHING
   * outside it points at it, and the refusal says how many things do.
   *
   * That is not a hedge. It is the realistic case: a city added with a typo, a currency added by
   * mistake, a country nobody ended up launching, a category that was never used. Those delete
   * cleanly. A city with four hundred properties is not something anybody should be able to remove
   * with one press, and «أوقفها» — which every refusal names — is the answer for it.
   *
   * ## Soft, like every other delete in this codebase
   *
   * `deleted_at`, so `audit_log` can still resolve the subject it names — a hard delete would
   * leave «حُذفت عملة» in سجل التدقيق with an id and no name. The code stays reserved by the unique
   * constraint, and the create paths REINSTATE a row rather than refusing it, which is what makes
   * the delete reversible by simply adding it again.
   */

  /**
   * Counts the rows that point at something, across a written list of tables.
   *
   * A written list rather than a walk over `pg_constraint`: a walk answers for the schema as it is
   * TODAY and silently starts counting a table added tomorrow, which sounds safer and is not — the
   * whole point is that adding a reference to cities must make somebody read this function and
   * decide whether it blocks a delete or is owned BY the city. `city_images` and
   * `city_category_links` are the city's own children and are deliberately absent.
   *
   * Every table is counted in one round trip, and each `sql` fragment is written here rather than
   * built from a caller-supplied name — nothing in this file interpolates a table.
   */
  private async countReferences(
    fragments: readonly { readonly what: string; readonly count: SQL }[],
  ): Promise<number> {
    const total = await this.db.execute<{ n: string }>(sql`
      SELECT (${sql.join(
        fragments.map((one) => one.count),
        sql` + `,
      )})::text AS n
    `);

    return Number(total.rows[0]?.n ?? '0');
  }

  /**
   * Removes a currency, unless the platform has priced anything in it.
   *
   * Seventeen tables point at `currencies`. All seventeen are counted, because a currency that is
   * gone from the console while a wallet still holds a balance in it is a balance nobody can name.
   * SYP is refused outright and separately: `ledger_entries.amount_syp` is DENOMINATED in it, so it
   * is not a row that becomes deletable when the counts happen to be zero.
   */
  async deleteCurrency(
    actor: AccessTokenClaims | undefined,
    code: string,
  ): Promise<{ code: string }> {
    const found = await this.db.execute<{ id: string; name_ar: string }>(sql`
      SELECT id, name_ar FROM currencies WHERE code = ${code} AND deleted_at IS NULL LIMIT 1
    `);

    const row = found.rows[0];

    if (!row) throw notFound(ERROR.GEO_CURRENCY_UNKNOWN);
    if (code === ACCOUNTING_CURRENCY) throw conflict(ERROR.GEO_CURRENCY_ACCOUNTING);

    const id = row.id;
    const used = await this.countReferences([
      {
        what: 'ad_campaigns',
        count: sql`(SELECT count(*) FROM ad_campaigns WHERE price_currency_id = ${id}::uuid)`,
      },
      {
        what: 'ad_invoices',
        count: sql`(SELECT count(*) FROM ad_invoices WHERE currency_id = ${id}::uuid)`,
      },
      {
        what: 'bookings',
        count: sql`(SELECT count(*) FROM bookings WHERE currency_id = ${id}::uuid)`,
      },
      {
        what: 'countries',
        count: sql`(SELECT count(*) FROM countries WHERE display_currency_id = ${id}::uuid)`,
      },
      {
        what: 'coupons',
        count: sql`(SELECT count(*) FROM coupons WHERE currency_id = ${id}::uuid)`,
      },
      {
        what: 'customer_profiles',
        count: sql`(SELECT count(*) FROM customer_profiles WHERE preferred_currency_id = ${id}::uuid)`,
      },
      {
        what: 'disputes',
        count: sql`(SELECT count(*) FROM disputes WHERE compensation_currency_id = ${id}::uuid)`,
      },
      {
        what: 'fx_rates',
        count: sql`(SELECT count(*) FROM fx_rates WHERE base_currency_id = ${id}::uuid OR quote_currency_id = ${id}::uuid)`,
      },
      {
        what: 'gift_cards',
        count: sql`(SELECT count(*) FROM gift_cards WHERE currency_id = ${id}::uuid)`,
      },
      {
        what: 'ledger_entries',
        count: sql`(SELECT count(*) FROM ledger_entries WHERE currency_id = ${id}::uuid)`,
      },
      {
        what: 'partner_payout_accounts',
        count: sql`(SELECT count(*) FROM partner_payout_accounts WHERE currency_id = ${id}::uuid)`,
      },
      {
        what: 'partner_payouts',
        count: sql`(SELECT count(*) FROM partner_payouts WHERE currency_id = ${id}::uuid)`,
      },
      {
        what: 'partner_violations',
        count: sql`(SELECT count(*) FROM partner_violations WHERE fine_currency_id = ${id}::uuid)`,
      },
      {
        what: 'payments',
        count: sql`(SELECT count(*) FROM payments WHERE currency_id = ${id}::uuid)`,
      },
      {
        what: 'refunds',
        count: sql`(SELECT count(*) FROM refunds WHERE currency_id = ${id}::uuid)`,
      },
      {
        what: 'units',
        count: sql`(SELECT count(*) FROM units WHERE currency_id = ${id}::uuid)`,
      },
      {
        what: 'wallets',
        count: sql`(SELECT count(*) FROM wallets WHERE currency_id = ${id}::uuid)`,
      },
      {
        what: 'wallet_transactions',
        count: sql`(SELECT count(*) FROM wallet_transactions WHERE currency_id = ${id}::uuid)`,
      },
    ]);

    if (used > 0) throw conflict(ERROR.GEO_CURRENCY_IN_USE, { n: used });

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE currencies SET deleted_at = now(), updated_at = now() WHERE id = ${id}::uuid
      `);

      await this.audit.record(
        {
          actorUserId: actor?.sub,
          actorRole: actor?.role,
          action: 'currency.deleted',
          subjectType: 'currency',
          before: { code, nameAr: row.name_ar },
          after: { code },
        },
        tx as unknown as Database,
      );
    });

    return { code };
  }

  /**
   * Removes a country, unless it still holds cities.
   *
   * Cities are counted INCLUDING soft-deleted ones. A deleted city keeps its `country_id`, so a
   * country that looks empty on screen can still be pointed at — and the unique index that would
   * let that city's slug be reused is scoped per country, so the row genuinely still matters.
   */
  async deleteCountry(
    actor: AccessTokenClaims | undefined,
    code: string,
  ): Promise<{ code: string }> {
    const found = await this.db.execute<{ id: string; name_ar: string }>(sql`
      SELECT id, name_ar FROM countries WHERE code = ${code} AND deleted_at IS NULL LIMIT 1
    `);

    const row = found.rows[0];

    if (!row) throw notFound(ERROR.GEO_COUNTRY_NOT_FOUND);

    const id = row.id;
    const used = await this.countReferences([
      {
        what: 'cities',
        count: sql`(SELECT count(*) FROM cities WHERE country_id = ${id}::uuid)`,
      },
    ]);

    if (used > 0) throw conflict(ERROR.GEO_COUNTRY_IN_USE, { n: used });

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE countries SET deleted_at = now(), updated_at = now() WHERE id = ${id}::uuid
      `);

      await this.audit.record(
        {
          actorUserId: actor?.sub,
          actorRole: actor?.role,
          action: 'country.deleted',
          subjectType: 'country',
          before: { code, nameAr: row.name_ar },
          after: { code },
        },
        tx as unknown as Database,
      );
    });

    return { code };
  }

  /**
   * Removes a city, unless anything outside it points at one.
   *
   * Its OWN children go with it: `city_category_links` is deleted and `city_images` soft-deleted,
   * because neither is a record about anything but this city — a link to a category the city no
   * longer has would keep that category undeletable for ever, which is the shape «Before deleting,
   * ask what it DID» warns about in reverse.
   *
   * The eight tables that BLOCK are records ABOUT other things that merely name this city.
   */
  async deleteCity(
    actor: AccessTokenClaims | undefined,
    slug: string,
  ): Promise<{ slug: string }> {
    const found = await this.db.execute<{ id: string; name_ar: string }>(sql`
      SELECT id, name_ar FROM cities WHERE slug = ${slug} AND deleted_at IS NULL LIMIT 1
    `);

    const row = found.rows[0];

    if (!row) throw notFound(ERROR.GEO_CITY_NOT_FOUND);

    const id = row.id;
    const used = await this.countReferences([
      {
        what: 'properties',
        count: sql`(SELECT count(*) FROM properties WHERE city_id = ${id}::uuid)`,
      },
      {
        what: 'bookings',
        count: sql`(SELECT count(*) FROM bookings WHERE city_id = ${id}::uuid)`,
      },
      {
        what: 'partners',
        count: sql`(SELECT count(*) FROM partners WHERE city_id = ${id}::uuid)`,
      },
      {
        what: 'partner_applications',
        count: sql`(SELECT count(*) FROM partner_applications WHERE city_id = ${id}::uuid)`,
      },
      {
        what: 'advertisers',
        count: sql`(SELECT count(*) FROM advertisers WHERE city_id = ${id}::uuid)`,
      },
      {
        what: 'ad_campaigns',
        count: sql`(SELECT count(*) FROM ad_campaigns WHERE city_id = ${id}::uuid)`,
      },
      {
        what: 'coupons',
        count: sql`(SELECT count(*) FROM coupons WHERE city_id = ${id}::uuid)`,
      },
      {
        what: 'staff_scope_cities',
        count: sql`(SELECT count(*) FROM staff_scope_cities WHERE city_id = ${id}::uuid)`,
      },
    ]);

    if (used > 0) throw conflict(ERROR.GEO_CITY_IN_USE, { n: used });

    await this.db.transaction(async (tx) => {
      /* The city's own children, so neither outlives it holding something else hostage. */
      await tx.execute(sql`DELETE FROM city_category_links WHERE city_id = ${id}::uuid`);
      await tx.execute(sql`
        UPDATE city_images SET deleted_at = now()
        WHERE city_id = ${id}::uuid AND deleted_at IS NULL
      `);

      await tx.execute(sql`
        UPDATE cities SET deleted_at = now(), updated_at = now() WHERE id = ${id}::uuid
      `);

      await this.audit.record(
        {
          actorUserId: actor?.sub,
          actorRole: actor?.role,
          action: 'city.deleted',
          subjectType: 'city',
          before: { slug, nameAr: row.name_ar },
          after: { slug },
        },
        tx as unknown as Database,
      );
    });

    return { slug };
  }

  /* ── Countries ──────────────────────────────────────────────────────────── */

  async createCountry(
    actor: AccessTokenClaims | undefined,
    input: CreateCountryInput,
  ): Promise<{ code: string }> {
    /*
      A code the platform once held and DELETED is reinstated, not refused.

      `countries.code` is uniquely constrained without a `deleted_at` predicate, so a soft-deleted
      row keeps its code reserved for ever — «add Jordan back» would answer «هذا الرمز مستخدم
      بالفعل» about a country nobody can see. The same shape `createCurrency` documents, and the
      thing that makes deleting a country reversible: adding it again brings it back, with its id
      intact so anything that still pointed at it still resolves.
    */
    const clash = await this.db.execute<{ retired: boolean }>(sql`
      SELECT (deleted_at IS NOT NULL) AS retired
      FROM countries WHERE code = ${input.code} LIMIT 1
    `);

    const existing = clash.rows[0];

    if (existing && !existing.retired) throw conflict(ERROR.GEO_CODE_TAKEN);

    const currency = await this.currencyId(input.displayCurrencyCode);

    await this.db.transaction(async (tx) => {
      if (existing) {
        await tx.execute(sql`
          UPDATE countries SET
            name_ar = ${input.nameAr}, name_en = ${input.nameEn}, name_de = ${input.nameDe},
            display_currency_id = ${currency}::uuid,
            is_launch_market = ${input.isLaunchMarket},
            is_active = true, deleted_at = NULL, updated_at = now()
          WHERE code = ${input.code}
        `);
      } else {
        await tx.execute(sql`
          INSERT INTO countries
            (code, name_ar, name_en, name_de, display_currency_id, is_launch_market, is_active)
          VALUES (${input.code}, ${input.nameAr}, ${input.nameEn}, ${input.nameDe},
                  ${currency}::uuid, ${input.isLaunchMarket}, true)
        `);
      }

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
            reinstated: existing !== undefined,
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

  /**
   * Files a city under a set of categories — the JOIN, and the legacy array beside it.
   *
   * `city_category_links` is the authority. `cities.categories` is a `city_category[]` still read
   * by the customer city page, the home page's category strip, `catalog.service` and the geography
   * screen, so it is written in step for every code that HAS an enum member — the four that
   * predate `city_categories`. A category staff added since has no member and lives only in the
   * join, which is why the array is a read path being retired rather than a second source of
   * truth. Recorded in FUTURE-WORK.
   */
  private async setCategories(
    tx: Database,
    cityId: string,
    codes: readonly string[],
  ): Promise<void> {
    await tx.execute(sql`
      DELETE FROM city_category_links WHERE city_id = ${cityId}::uuid
    `);

    if (codes.length > 0) {
      const list = sql.join(
        codes.map((code) => sql`${code}`),
        sql`, `,
      );

      /*
        Every code must name a LIVE category, and a request naming one that does not is refused
        rather than quietly filed under fewer categories than it asked for. The console builds its
        checkboxes from this same table, so reaching this is a tampered request or a stale tab —
        and «some of what you sent was ignored» is the answer neither of them should get.
      */
      const found = await tx.execute<{ n: string }>(sql`
        SELECT count(*)::text AS n FROM city_categories
        WHERE code IN (${list}) AND deleted_at IS NULL
      `);

      if (Number(found.rows[0]?.n ?? 0) !== new Set(codes).size) {
        throw badRequest(ERROR.GEO_CATEGORY_NOT_FOUND);
      }

      await tx.execute(sql`
        INSERT INTO city_category_links (city_id, category_id)
        SELECT ${cityId}::uuid, cc.id
        FROM city_categories cc
        WHERE cc.code IN (${list}) AND cc.deleted_at IS NULL
        ON CONFLICT DO NOTHING
      `);
    }

    /* Only the four with an enum member; anything newer is in the join alone. */
    await tx.execute(sql`
      UPDATE cities SET categories = ${sql.raw(categoriesLiteral(codes))}, updated_at = now()
      WHERE id = ${cityId}::uuid
    `);
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
      const made = await tx.execute<{ id: string }>(sql`
        INSERT INTO cities
          (country_id, slug, name_ar, name_en, name_de, timezone, categories, is_active)
        VALUES (${country}::uuid, ${input.slug}, ${input.nameAr}, ${input.nameEn},
                ${input.nameDe}, ${input.timezone}, '{}'::city_category[], true)
        RETURNING id::text
      `);

      const cityId = made.rows[0]?.id;

      if (!cityId) throw notFound(ERROR.GEO_CITY_NOT_FOUND);

      await this.setCategories(tx as unknown as Database, cityId, input.categories);

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
          updated_at = now()
        WHERE id = ${row.id}::uuid
      `);

      /* Absent from the payload means «leave them», not «clear them». */
      if (input.categories !== undefined) {
        await this.setCategories(tx as unknown as Database, row.id, input.categories);
      }

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
  /*
    The four the ENUM knows, which is not the same set as the table any more.

    A category staff added since `city_categories` became a table has no enum member, and a
    Postgres enum cannot gain one from a request. Those live in the join alone — filtered out here
    rather than rejected, because refusing a legitimate category would make the table's whole
    purpose unreachable.
  */
  const inEnum = new Set(['coastal', 'mountain', 'desert', 'historic']);
  const known = categories.filter((category) => inEnum.has(category));

  return known.length === 0
    ? `'{}'::city_category[]`
    : `ARRAY[${known.map((c) => `'${c}'`).join(',')}]::city_category[]`;
}
