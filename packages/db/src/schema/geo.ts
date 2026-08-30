import { relations } from 'drizzle-orm';
import {
  boolean,
  char,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import {
  createdAt,
  foreignId,
  fxRate,
  notDeleted,
  primaryId,
  timestamps,
} from './_shared.js';
import { cityCategory } from './enums.js';

/**
 * Currencies, countries and cities are TABLES, not enums or constants: SRS §1.4
 * requires an admin to add a currency or country "without modifying the code".
 */
export const currencies = pgTable('currencies', {
  id: primaryId(),
  code: char('code', { length: 3 }).notNull().unique(), // ISO 4217
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en').notNull(),
  nameDe: text('name_de').notNull(),
  symbol: text('symbol').notNull(),
  /** Minor-unit digits: 2 for USD, 0 for JPY. SYP is quoted with 2. */
  decimals: smallint('decimals').notNull().default(2),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps,
});

export const countries = pgTable('countries', {
  id: primaryId(),
  code: char('code', { length: 2 }).notNull().unique(), // ISO 3166-1 alpha-2
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en').notNull(),
  nameDe: text('name_de').notNull(),
  /** Default display currency for visitors resolved to this country. */
  displayCurrencyId: foreignId('display_currency_id')
    .notNull()
    .references(() => currencies.id),
  /** SRS §1.3: Syria, Jordan and Lebanon at launch; others are future scope. */
  isLaunchMarket: boolean('is_launch_market').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps,
});

/**
 * The city categories — «الفئات» — as a TABLE rather than an enum (Bashar, 2026-08-30).
 *
 * ## Why it moved
 *
 * `city_category` was a `pgEnum` with four members, so «manage the categories» was a migration and
 * a deployment, not a screen. Every other reference set on this platform is already a table for
 * exactly that reason — `amenities` says it outright: «Admin-managed so a new filter (§5.5) needs
 * no deploy» — and city categories were the one that was not.
 *
 * ## The enum is not dropped
 *
 * `cities.categories` keeps its `city_category[]` column, populated in step with this table, and
 * migration `post/0018` backfills the pair. Dropping the column would rewrite `catalog.service`,
 * the customer city page, the home page's category strip and the geography screen in the same
 * commit as a schema change — and a Postgres enum cannot lose a member while a column still holds
 * it. The join is the authority for what a city IS; the array stays as the read path until those
 * callers move, and `GeoCategoryService` writes both.
 *
 * `code` rather than a numeric id in the URL, matching `property_types` and `amenities`: it is
 * what the seed, the catalogues and every existing filter already key on.
 */
export const cityCategories = pgTable('city_categories', {
  id: primaryId(),
  /** `coastal` | `mountain` | `desert` | `historic` | whatever staff add next. */
  code: text('code').notNull().unique(),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en').notNull(),
  nameDe: text('name_de').notNull(),
  /** Retired rather than deleted: a city may still be filed under it. */
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  ...timestamps,
});

export const cities = pgTable(
  'cities',
  {
    id: primaryId(),
    countryId: foreignId('country_id')
      .notNull()
      .references(() => countries.id),
    /** URL segment for the SEO city page (§5.4), e.g. "damascus". */
    slug: text('slug').notNull(),
    nameAr: text('name_ar').notNull(),
    nameEn: text('name_en').notNull(),
    nameDe: text('name_de').notNull(),
    descriptionAr: text('description_ar'),
    descriptionEn: text('description_en'),
    descriptionDe: text('description_de'),
    /**
     * IANA zone, e.g. "Asia/Damascus". Load-bearing: the same-day booking cutoff
     * (§5.3) is 17:00 in the CITY's local time, not the server's or the user's.
     */
    timezone: text('timezone').notNull(),
    /** Per-city override of the global cutoff hour; null falls back to settings. */
    sameDayCutoffHour: smallint('same_day_cutoff_hour'),
    latitude: text('latitude'),
    longitude: text('longitude'),
    /** SRS §5.4: a city may be both desert and historic (e.g. Petra). */
    categories: cityCategory('categories').array().notNull().default([]),
    /** Highlight tags shown on the city page: "المدينة القديمة", "القلعة", … */
    tagsAr: text('tags_ar').array().notNull().default([]),
    tagsEn: text('tags_en').array().notNull().default([]),
    tagsDe: text('tags_de').array().notNull().default([]),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    // Slugs must be unique per country, and only among live rows — a soft-deleted
    // city must not reserve its slug forever.
    uniqueIndex('cities_country_slug_unique').on(t.countryId, t.slug).where(notDeleted),
    index('cities_country_active_idx').on(t.countryId, t.isActive),
    index('cities_categories_idx').using('gin', t.categories),
  ],
);

/**
 * City photography for the hero band (§5.4: "the first third of the page is
 * high-quality images of the city").
 *
 * A separate table rather than a column on `cities` because the spec asks for
 * imagery in the plural, and a hero band rotates through several. Shares the same
 * upload pipeline as property images, so the same validation and EXIF stripping
 * apply — city photos are usually licensed stock, and stripping metadata avoids
 * republishing a photographer's embedded details by accident.
 */
/**
 * Which categories a city is filed under.
 *
 * A join rather than an array column, matching `unit_amenities`: an array cannot carry a foreign
 * key, so a category retired or renamed would leave orphan strings in every city that held it.
 */
export const cityCategoryLinks = pgTable(
  'city_category_links',
  {
    cityId: foreignId('city_id')
      .notNull()
      .references(() => cities.id),
    categoryId: foreignId('category_id')
      .notNull()
      .references(() => cityCategories.id),
  },
  (t) => [
    primaryKey({ columns: [t.cityId, t.categoryId] }),
    index('city_category_links_category_idx').on(t.categoryId),
  ],
);

export const cityImages = pgTable(
  'city_images',
  {
    id: primaryId(),
    cityId: foreignId('city_id')
      .notNull()
      .references(() => cities.id),
    fileKey: text('file_key').notNull(),
    variantWidths: integer('variant_widths').array().notNull().default([]),
    width: integer('width'),
    height: integer('height'),
    altAr: text('alt_ar'),
    altEn: text('alt_en'),
    altDe: text('alt_de'),
    /** Attribution, where the licence requires it. */
    credit: text('credit'),
    isHero: boolean('is_hero').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (t) => [index('city_images_city_idx').on(t.cityId, t.sortOrder)],
);

/**
 * SRS §1.4 makes SYP the internal accounting currency, and SYP is volatile. Rates
 * are therefore an immutable time series, and every financial record snapshots the
 * rate it used (see bookings.fxRateToSyp). Without that, last month's revenue
 * reports would silently change whenever the admin updated the rate.
 */
export const fxRates = pgTable(
  'fx_rates',
  {
    id: primaryId(),
    baseCurrencyId: foreignId('base_currency_id')
      .notNull()
      .references(() => currencies.id),
    quoteCurrencyId: foreignId('quote_currency_id')
      .notNull()
      .references(() => currencies.id),
    rate: fxRate('rate').notNull(),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
    /** "manual" | "central_bank" | provider name — for auditability. */
    source: text('source').notNull().default('manual'),
    createdByUserId: foreignId('created_by_user_id'),
    ...createdAt,
  },
  (t) => [
    index('fx_rates_lookup_idx').on(t.baseCurrencyId, t.quoteCurrencyId, t.effectiveFrom),
  ],
);

export const countriesRelations = relations(countries, ({ one, many }) => ({
  displayCurrency: one(currencies, {
    fields: [countries.displayCurrencyId],
    references: [currencies.id],
  }),
  cities: many(cities),
}));

export const citiesRelations = relations(cities, ({ one }) => ({
  country: one(countries, { fields: [cities.countryId], references: [countries.id] }),
}));
