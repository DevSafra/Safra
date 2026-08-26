import { z } from 'zod';

import { ERROR } from './error-codes.js';

/** What kind of business is advertising. Restaurants and activities are the launch set. */
export const ADVERTISER_KINDS = [
  'restaurant',
  'activity',
  'shop',
  'transport',
  'other',
] as const;

export type AdvertiserKind = (typeof ADVERTISER_KINDS)[number];

/** How a campaign is billed. The design shows only «شهري»; the column allows the others. */
export const AD_BILLING_PERIODS = ['weekly', 'monthly', 'quarterly'] as const;

export type AdBillingPeriod = (typeof AD_BILLING_PERIODS)[number];

/**
 * A URL an ad may point at.
 *
 * ## Only http and https, and the reason is not tidiness
 *
 * The click endpoint redirects to whatever this column holds. `javascript:` would execute in the
 * customer's browser on SAFRA's own page; `data:` can carry a whole document. Both are refused at
 * the boundary, so the redirect target is always a fetchable address a person typed.
 *
 * The HOST is deliberately not restricted — an advertiser's own site is the point. What is
 * restricted is the scheme, which is where the danger is.
 */
export const adTargetUrlSchema = z
  .string()
  .trim()
  .max(2048, ERROR.VALIDATION_REQUIRED)
  .refine((value) => {
    try {
      const url = new URL(value);

      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }, ERROR.AD_TARGET_URL_INVALID);

/** Creating an advertiser — the business that pays, distinct from a partner who sells. */
export const advertiserCreateSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    kind: z.enum(ADVERTISER_KINDS, { message: ERROR.VALIDATION_REQUIRED }),
    citySlug: z.string().trim().min(1).max(120),
    contactEmail: z
      .string()
      .trim()
      .email(ERROR.VALIDATION_EMAIL_INVALID)
      .max(254)
      .optional(),
    contactPhone: z.string().trim().min(6).max(32).optional(),
  })
  .strict();

export type AdvertiserCreateInput = z.infer<typeof advertiserCreateSchema>;

/**
 * Creating a campaign — §9.3's «+ حملة جديدة».
 *
 * ## All three headlines are required
 *
 * Exactly as `properties` requires three names. The customer app serves ar, en and de; a campaign
 * with one headline is a campaign that shows the wrong language to two thirds of its readers.
 *
 * ## The price is optional, and that is not an oversight
 *
 * `price_amount` is nullable in the schema. A campaign may be a goodwill placement or part of a
 * barter — and one with no price simply generates no invoices. What is NOT allowed is a price
 * without a currency, which is the shape «no amount without its currency» exists to forbid.
 */
export const campaignCreateSchema = z
  .object({
    advertiserReference: z.string().trim().min(1).max(64),
    citySlug: z.string().trim().min(1).max(120),
    headlineAr: z.string().trim().min(2).max(120),
    headlineEn: z.string().trim().min(2).max(120),
    headlineDe: z.string().trim().min(2).max(120),
    targetUrl: adTargetUrlSchema,
    billingPeriod: z.enum(AD_BILLING_PERIODS, { message: ERROR.VALIDATION_REQUIRED }),
    priceAmount: z
      .string()
      .regex(/^\d{1,10}(\.\d{1,3})?$/, ERROR.VALIDATION_DECIMAL_STRING)
      .optional(),
    priceCurrency: z
      .string()
      .regex(/^[A-Z]{3}$/, ERROR.VALIDATION_CURRENCY_CODE)
      .optional(),
    startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, ERROR.VALIDATION_DATE_FORMAT),
    endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, ERROR.VALIDATION_DATE_FORMAT),
  })
  .strict()
  .refine((v) => v.endsOn > v.startsOn, {
    message: ERROR.AD_WINDOW_ORDER,
    path: ['endsOn'],
  })
  .refine((v) => (v.priceAmount === undefined) === (v.priceCurrency === undefined), {
    message: ERROR.AD_PRICE_NEEDS_CURRENCY,
    path: ['priceCurrency'],
  });

export type CampaignCreateInput = z.infer<typeof campaignCreateSchema>;

/**
 * Editing a campaign's creative.
 *
 * The WINDOW and the PRICE are not editable: both are what invoices were issued against, and a
 * campaign whose billing period moves underneath its own invoices is a bill nobody can reconcile.
 * A different run is a different campaign.
 */
export const campaignUpdateSchema = z
  .object({
    headlineAr: z.string().trim().min(2).max(120).optional(),
    headlineEn: z.string().trim().min(2).max(120).optional(),
    headlineDe: z.string().trim().min(2).max(120).optional(),
    targetUrl: adTargetUrlSchema.optional(),
  })
  .strict();

export type CampaignUpdateInput = z.infer<typeof campaignUpdateSchema>;

/** Marking an ad invoice paid, or voiding one that will never be. */
export const adInvoicePaySchema = z
  .object({
    /** Free text: how it was settled — a transfer reference, a cash receipt. Audited. */
    note: z.string().trim().min(3).max(500),
  })
  .strict();

export type AdInvoicePayInput = z.infer<typeof adInvoicePaySchema>;

/** What the customer app is served for one city. Never a draft, a paused or a lapsed campaign. */
export interface DeliveredAd {
  readonly reference: string;
  readonly headline: string;
  readonly advertiser: string;
  readonly kind: AdvertiserKind;
  /** The CLICK path on SAFRA, never the advertiser's URL — see the delivery service. */
  readonly clickPath: string;
  readonly imagePath: string | null;
}
