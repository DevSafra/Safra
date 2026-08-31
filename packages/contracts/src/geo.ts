import { z } from 'zod';

import { ERROR } from './error-codes.js';

/**
 * Creating and correcting the platform's geography (SRS §5.4, P-005).
 *
 * ## Why these are writes at all
 *
 * P-005 is explicit that launch geography is an OPERATIONAL value adjusted by staff, not a
 * constant a developer edits and deploys — «أسعار الصرف تُعدَّل من هنا لا من الكود». The screen
 * has shown three disabled «+ إضافة» buttons since it was built, which is the same promise made
 * and not kept: a control that renders and does nothing reads as coverage.
 *
 * ## What is NOT here, on purpose
 *
 * **Exchange rates.** They have a full write path with audited history on their own screen, and a
 * second editor would be two ways to change the number that prices every booking.
 *
 * **Deletion.** A country, city or currency is referenced by bookings, properties and ledger rows
 * that outlive any decision to stop selling there. `isActive` is how a market closes; the row
 * stays, and everything already priced in it still reads.
 */

/**
 * A public URL segment, so it is Latin, lowercase and hyphenated — never the Arabic name.
 *
 * `/ar/city/دمشق` would be percent-encoded into something nobody can read, share or paste, and
 * the slug is unique per country rather than globally: two countries may each have a «طرابلس».
 */
export const slugPattern = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, ERROR.GEO_SLUG_FORMAT);

const slug = slugPattern;

/**
 * A city category, by CODE — not an enum any more.
 *
 * It was `z.enum(['coastal', 'mountain', 'desert', 'historic'])`, which was the schema's own list
 * and became wrong the day `city_categories` became a table staff manage: a category added on
 * الفئات would have been refused by the contract before it reached the service. The set is now in
 * the database, so the SHAPE is checked here and MEMBERSHIP is checked there — the service refuses
 * a code no live category carries.
 *
 * A city may hold several: Petra is desert AND historic.
 */
export const cityCategorySchema = slug;

const name = z.string().trim().min(1).max(80);

/** ISO 3166-1 alpha-2, upper case. */
const countryCode = z
  .string()
  .trim()
  .toUpperCase()
  .length(2)
  .regex(/^[A-Z]{2}$/, ERROR.GEO_COUNTRY_CODE_FORMAT);

/** ISO 4217, upper case. */
const currencyCode = z
  .string()
  .trim()
  .toUpperCase()
  .length(3)
  .regex(/^[A-Z]{3}$/, ERROR.VALIDATION_CURRENCY_CODE);

export const createCitySchema = z
  .object({
    countryCode,
    slug,
    nameAr: name,
    nameEn: name,
    nameDe: name,
    /**
     * An IANA zone, checked against the runtime's own list in the service.
     *
     * Load-bearing rather than decorative: §5.3's same-day cutoff is 17:00 in the CITY's local
     * time, so a city created with a wrong zone closes its own bookings at the wrong hour.
     */
    timezone: z.string().trim().min(3).max(64),
    categories: z.array(cityCategorySchema).max(4).default([]),
  })
  .strict();

/**
 * A city's own prose, and the highlight tags beside it.
 *
 * ## Why they are here rather than in a migration
 *
 * Both render on the PUBLIC city page — `description` as the paragraph under the name, `tags` as
 * the strip of «المدينة القديمة» / «القلعة» — and neither could be written from anywhere but a
 * migration until 2026-08-31. That is the same gap the geography rows themselves had: a value the
 * business changes, reachable only by a deployment.
 *
 * `null` clears the description, which is different from omitting the field: omitted means «leave
 * it», and a `.nullable()` rather than a `.default()` is what lets an operator empty one. The trap
 * a `.default()` sets is recorded in the register — it invents a plausible value for something
 * nobody sent.
 *
 * Tags are capped at eight and forty characters each because they render as a single strip on a
 * phone; a ninth wraps the line and a fortieth character is a sentence, not a tag.
 */
const description = z.string().trim().max(2000).nullable();
const tags = z.array(z.string().trim().min(1).max(40)).max(8);

export const updateCitySchema = z
  .object({
    nameAr: name.optional(),
    nameEn: name.optional(),
    nameDe: name.optional(),
    timezone: z.string().trim().min(3).max(64).optional(),
    categories: z.array(cityCategorySchema).max(4).optional(),
    isActive: z.boolean().optional(),
    descriptionAr: description.optional(),
    descriptionEn: description.optional(),
    descriptionDe: description.optional(),
    tagsAr: tags.optional(),
    tagsEn: tags.optional(),
    tagsDe: tags.optional(),
    /**
     * Where the city sits in the PUBLIC destinations grid.
     *
     * `catalog.service` orders that grid by this column, so it decides which cities a visitor sees
     * first on the home page — and it could only be set by a migration. `coalesce` is enough for
     * it, unlike the prose beside it: the column is `NOT NULL` with a default, so it has no empty
     * state and «leave it» is the only thing an absent value can mean.
     */
    sortOrder: z.number().int().min(0).max(999).optional(),
  })
  .strict();

/**
 * What a person may change about a city PHOTOGRAPH, once it has been rendered.
 *
 * Nothing here touches the bytes: `file_key`, `width`, `height` and `variant_widths` are the
 * worker's, and a form that could edit them would be a form that can make a row describe an object
 * that is not there.
 *
 * `alt` is the one that matters beyond tidiness. §5.4's hero band is the first third of the public
 * city page, and until now every one of those images went out with an empty `alt` — a screen
 * reader announced nothing at all. It is nullable rather than required because an empty alt is the
 * CORRECT answer for a purely decorative image, and forcing a sentence would produce invented
 * descriptions of somebody's city.
 *
 * `isHero` is only ever set TRUE here. Unsetting it would leave a city with no hero and §5.4's
 * band with nothing to draw; the way to move it is to name a different image, and the service
 * clears the previous one in the same transaction.
 */
export const updateCityImageSchema = z
  .object({
    altAr: z.string().trim().max(160).nullable().optional(),
    altEn: z.string().trim().max(160).nullable().optional(),
    altDe: z.string().trim().max(160).nullable().optional(),
    credit: z.string().trim().max(120).nullable().optional(),
    isHero: z.literal(true).optional(),
    sortOrder: z.number().int().min(0).max(99).optional(),
  })
  .strict();

export type UpdateCityImageInput = z.infer<typeof updateCityImageSchema>;

export const createCountrySchema = z
  .object({
    code: countryCode,
    nameAr: name,
    nameEn: name,
    nameDe: name,
    /** What prices are SHOWN in for a visitor browsing this country. Must already exist. */
    displayCurrencyCode: currencyCode,
    isLaunchMarket: z.boolean().default(false),
  })
  .strict();

export const updateCountrySchema = z
  .object({
    nameAr: name.optional(),
    nameEn: name.optional(),
    nameDe: name.optional(),
    displayCurrencyCode: currencyCode.optional(),
    isLaunchMarket: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

/**
 * Adding a currency: the CODE, and the names it is read by.
 *
 * ## The symbol and the decimals are not inputs
 *
 * They are properties of the code — `CURRENCY_CATALOGUE` holds all three together and the service
 * looks them up. Taking a symbol from the form let «USD» be saved with «€», which renders every
 * dollar on the platform with a euro sign and nothing refuses it; taking `decimals` from the form
 * let JOD be stored with two, which truncates 10.125 to 10.13 on the way in — the defect
 * `0049_concerned_eternals.sql` exists to undo. Bashar asked for the menu (2026-08-30); this is
 * what makes the menu the authority rather than a convenience.
 *
 * The names stay editable: «دولار أمريكي» is a translation, not a property of ISO 4217, and the
 * catalogue's are a starting point the form prefills.
 */
export const createCurrencySchema = z
  .object({
    code: currencyCode,
    nameAr: name,
    nameEn: name,
    nameDe: name,
  })
  .strict();

export const updateCurrencySchema = z
  .object({
    nameAr: name.optional(),
    nameEn: name.optional(),
    nameDe: name.optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

/**
 * A city category — «الفئة» — now that they are rows rather than enum members.
 *
 * `code` is the identifier every catalogue, filter and seed already keys on, so it is chosen once
 * and never edited: renaming it would orphan the translations and every link that used it. The
 * NAMES are what a person changes.
 */
export const createCityCategorySchema = z
  .object({
    code: slug,
    nameAr: name,
    nameEn: name,
    nameDe: name,
  })
  .strict();

export const updateCityCategorySchema = z
  .object({
    nameAr: name.optional(),
    nameEn: name.optional(),
    nameDe: name.optional(),
    /** Retired rather than deleted: cities already filed under it keep their link. */
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(999).optional(),
  })
  .strict();

export type CreateCityCategoryInput = z.infer<typeof createCityCategorySchema>;
export type UpdateCityCategoryInput = z.infer<typeof updateCityCategorySchema>;

export type CreateCityInput = z.infer<typeof createCitySchema>;
export type UpdateCityInput = z.infer<typeof updateCitySchema>;
export type CreateCountryInput = z.infer<typeof createCountrySchema>;
export type UpdateCountryInput = z.infer<typeof updateCountrySchema>;
export type CreateCurrencyInput = z.infer<typeof createCurrencySchema>;
export type UpdateCurrencyInput = z.infer<typeof updateCurrencySchema>;
