import { z } from 'zod';

import { ERROR } from './error-codes.js';
import { PAYOUT_METHODS } from './payout-account.js';

/**
 * SAFRA's own payout destinations and the revenue transfers that reach them (Bashar, 2026-09-05).
 *
 * ## Why this exists
 *
 * Commission, the customer fee and advertising revenue accrue as CREDITS to
 * `safra_commission_partner`, `safra_commission_customer` and `ad_revenue` — and **nothing has ever
 * debited them.** The books said what SAFRA had earned and nothing about what it had collected, and
 * there was no configuration anywhere naming the account SAFRA's own money should reach. Partners
 * have had both since 2026-09-04; SAFRA had neither.
 *
 * Bashar: *"I want the Super Admin to be able to fully manage where SAFRA's own earnings are
 * collected, just as partners can manage where their earnings are paid."*
 *
 * ## Everything here mirrors the partner contract on purpose
 *
 * The same rails, the same masked number, the same `pending → verified` lifecycle, the same
 * refusal to pay into anything unverified. A destination for money is a destination for money.
 * Where the two differ, the difference is stated rather than implied — a SAFRA account carries a
 * LABEL and a DEFAULT flag, because there is one SAFRA and there may be several of its accounts.
 */

const holder = z
  .string()
  .trim()
  .min(2, ERROR.VALIDATION_REQUIRED)
  .max(120, ERROR.VALIDATION_TOO_LONG);

/**
 * The account number, which never leaves the API in clear.
 *
 * Stored as AES-256-GCM ciphertext with the last four kept separately, exactly as a partner's is.
 * The same shape check too: digits, spaces and hyphens, because an IBAN and a wallet number are
 * both written that way and neither is a free-text field.
 */
const accountNumber = z
  .string()
  .trim()
  .min(4, ERROR.VALIDATION_REQUIRED)
  .max(64, ERROR.VALIDATION_TOO_LONG)
  .regex(/^[A-Za-z0-9 -]+$/, ERROR.VALIDATION_ACCOUNT_NUMBER);

const SWIFT = /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/;

export const safraPayoutAccountInputSchema = z
  .object({
    /** What a finance officer calls it: «الحساب التشغيلي». Not a name on a bank statement. */
    label: z
      .string()
      .trim()
      .min(2, ERROR.VALIDATION_REQUIRED)
      .max(80, ERROR.VALIDATION_TOO_LONG),
    method: z.enum(PAYOUT_METHODS, { message: ERROR.VALIDATION_PAYOUT_METHOD }),
    accountHolder: holder,
    accountNumber,
    bankName: z.string().trim().max(120, ERROR.VALIDATION_TOO_LONG).optional(),
    swiftCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(SWIFT, ERROR.VALIDATION_SWIFT)
      .optional()
      .or(z.literal('')),
    currency: z.string().trim().toUpperCase().length(3, ERROR.VALIDATION_CURRENCY_CODE),
  })
  .strict();

export type SafraPayoutAccountInput = z.infer<typeof safraPayoutAccountInputSchema>;

/**
 * What may be changed without retyping the number.
 *
 * `accountNumber` is deliberately absent: the read projection never returns the ciphertext, so an
 * edit that carried it would be sending back something the screen never had. Changing the number
 * means creating a new account, which is also what makes the verification meaningful.
 *
 * `isDefault` and `isActive` are here because both are operational switches rather than statements
 * about the account's authenticity — see the schema's note on why they are separate from `status`.
 */
export const safraPayoutAccountUpdateSchema = z
  .object({
    label: z
      .string()
      .trim()
      .min(2, ERROR.VALIDATION_REQUIRED)
      .max(80, ERROR.VALIDATION_TOO_LONG)
      .optional(),
    accountHolder: holder.optional(),
    bankName: z.string().trim().max(120, ERROR.VALIDATION_TOO_LONG).optional(),
    isDefault: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export type SafraPayoutAccountUpdateInput = z.infer<
  typeof safraPayoutAccountUpdateSchema
>;

/**
 * Opening a transfer of SAFRA's revenue for a period.
 *
 * The period is the whole definition of what the payout settles: every SAFRA revenue entry dated
 * inside it. Periods may not overlap an existing non-cancelled payout, or the same revenue would
 * be settled twice — the ledger would balance and the money would leave twice, which is the
 * quietest accounting failure this feature can have.
 */
export const safraPayoutOpenSchema = z
  .object({
    periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, ERROR.VALIDATION_DATE_FORMAT),
    periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, ERROR.VALIDATION_DATE_FORMAT),
    notes: z.string().trim().max(500, ERROR.VALIDATION_TOO_LONG).optional(),
  })
  .strict()
  .refine((v) => v.periodEnd >= v.periodStart, {
    message: ERROR.SAFRA_PAYOUT_PERIOD_ORDER,
    path: ['periodEnd'],
  });

export type SafraPayoutOpenInput = z.infer<typeof safraPayoutOpenSchema>;

/**
 * Marking one paid — the only step that writes the ledger.
 *
 * The bank's reference is required for the same reason a partner payout requires it: without it a
 * line on a statement cannot be matched to a payout, and «we transferred it» is a claim with
 * nothing behind it.
 */
export const safraPayoutPaidSchema = z
  .object({
    paidReference: z
      .string()
      .trim()
      .min(3, ERROR.VALIDATION_REQUIRED)
      .max(80, ERROR.VALIDATION_TOO_LONG),
  })
  .strict();

export type SafraPayoutPaidInput = z.infer<typeof safraPayoutPaidSchema>;

/** Holding or cancelling one, with a reason the next reader can act on. */
export const safraPayoutReasonSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(8, ERROR.VALIDATION_REQUIRED)
      .max(500, ERROR.VALIDATION_TOO_LONG),
  })
  .strict();

export type SafraPayoutReasonInput = z.infer<typeof safraPayoutReasonSchema>;

/**
 * Rejecting an account, with the reason — required, and shown wherever the account is.
 *
 * A rejection with no reason is a dead end: the next officer sees a refused account and cannot
 * tell which field to correct, so they enter the same thing again.
 */
export const safraPayoutAccountRejectSchema = safraPayoutReasonSchema;

/**
 * The three ledger accounts a SAFRA payout settles.
 *
 * Written out rather than derived, because this list IS the definition of «SAFRA revenue» for the
 * purpose of paying it out. `partner_fine` is deliberately absent: a fine is money a partner owes
 * SAFRA, netted against what SAFRA owes them, and it never becomes a separate transfer.
 * `payment_provider_fee` is a COST, not revenue. Adding a fourth stream means adding it here and
 * to the payout row, which is the point of naming them.
 */
export const SAFRA_REVENUE_ACCOUNTS = [
  'safra_commission_partner',
  'safra_commission_customer',
  'ad_revenue',
] as const;

export type SafraRevenueAccount = (typeof SAFRA_REVENUE_ACCOUNTS)[number];
