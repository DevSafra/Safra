import { z } from 'zod';

import { ERROR } from './error-codes.js';

/**
 * الكوبونات — §9.3's five coupon types, and nothing beyond them.
 *
 * The types are TARGETING categories, not funding models: `city` and `partner` narrow WHERE a
 * coupon applies, using the scope columns beside them. SAFRA funds every one of them out of its own
 * two revenue lines — see `coupon_discount` in the ledger enum for why the partner never does.
 */
export const COUPON_TYPES = [
  'first_booking',
  'seasonal',
  'city',
  'partner',
  'campaign',
] as const;

export type CouponType = (typeof COUPON_TYPES)[number];

export const COUPON_VALUE_KINDS = ['percent', 'fixed'] as const;

export type CouponValueKind = (typeof COUPON_VALUE_KINDS)[number];

/**
 * A coupon code as stored and compared: upper case, no separators.
 *
 * Somebody typing `safra-20` from a poster, an email or a phone call must reach the same coupon as
 * `SAFRA20`. Normalising on the way in AND on the way to lookup is what makes the unique index
 * mean what it looks like it means — without it, `SAFRA20` and `safra20` are two coupons.
 */
export function normaliseCouponCode(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '');
}

/** 4–32 characters after normalising: long enough to be unguessable, short enough to say aloud. */
export const couponCodeSchema = z
  .string()
  .trim()
  .min(1, ERROR.VALIDATION_REQUIRED)
  .max(64, ERROR.VALIDATION_REQUIRED)
  .transform(normaliseCouponCode)
  .refine((v) => /^[A-Z0-9]{4,32}$/.test(v), ERROR.COUPON_INVALID);

/** A money amount, at the scale a money column holds. Never a number — see `MONEY_SCALE`. */
const moneyString = z
  .string()
  .regex(/^\d{1,10}(\.\d{1,3})?$/, ERROR.VALIDATION_DECIMAL_STRING);

/**
 * Creating a coupon — §9.3's «+ كوبون جديد».
 *
 * ## The value means two different things
 *
 * `percent` is a whole percentage of the STAY; `fixed` is an amount in `currency`. The database
 * already refuses a percentage outside 1–100 and a fixed value with no currency
 * (`coupons_percent_bounded`, `coupons_fixed_needs_currency`), and this refuses both earlier so an
 * operator is told rather than meeting a constraint violation.
 *
 * ## What the window means
 *
 * `startsAt`/`endsAt` are dates, inclusive of the start and exclusive of the end at midnight UTC —
 * the same shape the registry already prints. `coupons_window_ordered` holds the ordering; this
 * refuses it first, for the same reason.
 */
export const couponCreateSchema = z
  .object({
    code: couponCodeSchema,
    type: z.enum(COUPON_TYPES, { message: ERROR.VALIDATION_REQUIRED }),
    valueKind: z.enum(COUPON_VALUE_KINDS, { message: ERROR.VALIDATION_REQUIRED }),
    value: moneyString,
    /** Required for `fixed`, forbidden for `percent` — a percentage has no currency. */
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/, ERROR.VALIDATION_CURRENCY_CODE)
      .optional(),
    maxDiscountAmount: moneyString.optional(),
    minBookingAmount: moneyString.optional(),
    startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, ERROR.VALIDATION_DATE_FORMAT),
    endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, ERROR.VALIDATION_DATE_FORMAT),
    /** Absent means uncapped — the registry prints «∞». */
    maxRedemptions: z.number().int().positive().max(1_000_000).optional(),
    /**
     * Absent means ONE, which is the column's own default.
     *
     * There is no "unlimited per customer": a coupon anybody can spend repeatedly is a discount on
     * the price list rather than a campaign, and the schema has said so since it was written.
     */
    maxRedemptionsPerCustomer: z.number().int().positive().max(100).optional(),
    /** Scope: a city slug and a partner reference, each narrowing where the coupon applies. */
    citySlug: z.string().trim().min(1).max(120).optional(),
    partnerReference: z.string().trim().min(1).max(64).optional(),
  })
  .strict()
  .refine(
    (v) => v.valueKind !== 'percent' || (Number(v.value) >= 1 && Number(v.value) <= 100),
    { message: ERROR.COUPON_PERCENT_RANGE, path: ['value'] },
  )
  .refine((v) => v.valueKind !== 'fixed' || v.currency !== undefined, {
    message: ERROR.COUPON_FIXED_NEEDS_CURRENCY,
    path: ['currency'],
  })
  .refine((v) => v.endsOn > v.startsOn, {
    message: ERROR.COUPON_WINDOW_ORDER,
    path: ['endsOn'],
  });

export type CouponCreateInput = z.infer<typeof couponCreateSchema>;

/**
 * Editing a coupon — everything except the CODE and the value.
 *
 * A code is what a customer was told; changing it orphans every poster and email that carries it.
 * The value and its kind are what a redemption was priced against — `coupon_redemptions` records
 * what each one actually gave, but a coupon whose meaning changes underneath its own history is a
 * record nobody can reconcile. Both are set once; a different offer is a different coupon.
 */
export const couponUpdateSchema = z
  .object({
    maxDiscountAmount: moneyString.nullable().optional(),
    minBookingAmount: moneyString.nullable().optional(),
    startsOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, ERROR.VALIDATION_DATE_FORMAT)
      .optional(),
    endsOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, ERROR.VALIDATION_DATE_FORMAT)
      .optional(),
    maxRedemptions: z.number().int().positive().max(1_000_000).nullable().optional(),
    /* Never null — see the note on create. Absent leaves it as it is. */
    maxRedemptionsPerCustomer: z.number().int().positive().max(100).optional(),
  })
  .strict();

export type CouponUpdateInput = z.infer<typeof couponUpdateSchema>;

/** Switching a coupon on or off — the operator's own control, separate from the calendar. */
export const couponActiveSchema = z.object({ isActive: z.boolean() }).strict();

export type CouponActiveInput = z.infer<typeof couponActiveSchema>;

/** What a customer sends to have a code priced against a stay. */
export const couponPreviewSchema = z
  .object({
    code: couponCodeSchema,
    unitId: z.string().uuid(ERROR.VALIDATION_REQUIRED),
    checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, ERROR.VALIDATION_DATE_FORMAT),
    checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, ERROR.VALIDATION_DATE_FORMAT),
  })
  .strict();

export type CouponPreviewInput = z.infer<typeof couponPreviewSchema>;

/** What a preview answers: the discount and what it leaves to pay. */
export interface CouponPreview {
  readonly code: string;
  readonly valueKind: CouponValueKind;
  readonly discountAmount: string;
  readonly totalBefore: string;
  readonly totalAfter: string;
  readonly currencyCode: string;
}
