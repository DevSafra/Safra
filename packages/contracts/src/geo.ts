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

/** The four the schema allows — a city may hold several, e.g. Petra is desert AND historic. */
export const cityCategorySchema = z.enum(['coastal', 'mountain', 'desert', 'historic']);

/**
 * A public URL segment, so it is Latin, lowercase and hyphenated — never the Arabic name.
 *
 * `/ar/city/دمشق` would be percent-encoded into something nobody can read, share or paste, and
 * the slug is unique per country rather than globally: two countries may each have a «طرابلس».
 */
const slug = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, ERROR.GEO_SLUG_FORMAT);

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

export const updateCitySchema = z
  .object({
    nameAr: name.optional(),
    nameEn: name.optional(),
    nameDe: name.optional(),
    timezone: z.string().trim().min(3).max(64).optional(),
    categories: z.array(cityCategorySchema).max(4).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

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

export const createCurrencySchema = z
  .object({
    code: currencyCode,
    nameAr: name,
    nameEn: name,
    nameDe: name,
    symbol: z.string().trim().min(1).max(8),
    /** Minor-unit digits: 2 for USD, 0 for JPY. */
    decimals: z.number().int().min(0).max(4).default(2),
  })
  .strict();

export const updateCurrencySchema = z
  .object({
    nameAr: name.optional(),
    nameEn: name.optional(),
    nameDe: name.optional(),
    symbol: z.string().trim().min(1).max(8).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export type CreateCityInput = z.infer<typeof createCitySchema>;
export type UpdateCityInput = z.infer<typeof updateCitySchema>;
export type CreateCountryInput = z.infer<typeof createCountrySchema>;
export type UpdateCountryInput = z.infer<typeof updateCountrySchema>;
export type CreateCurrencyInput = z.infer<typeof createCurrencySchema>;
export type UpdateCurrencyInput = z.infer<typeof updateCurrencySchema>;
