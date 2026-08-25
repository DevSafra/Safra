import { z } from 'zod';

import { calendarDateSchema, tripAttributeSchema } from './search.js';
import { emailSchema, phoneSchema } from './auth.js';
import { ERROR } from './error-codes.js';

/**
 * Booking creation (SRS §6.3).
 *
 * Guest details are required even for a signed-in customer: §6.5 puts the guest's
 * name on the voucher and the QR code, and the person travelling is not always the
 * person paying.
 */
export const bookingCreateSchema = z
  .object({
    unitId: z.string().uuid(),
    checkIn: calendarDateSchema,
    checkOut: calendarDateSchema,
    adults: z.number().int().min(1).max(30),
    children: z.number().int().min(0).max(20).default(0),
    infants: z.number().int().min(0).max(10).default(0),
    guest: z
      .object({
        fullName: z.string().trim().min(2).max(120),
        email: emailSchema,
        phone: phoneSchema,
      })
      .strict(),
    attributes: z.array(tripAttributeSchema).max(10).default([]),
    /**
     * EC-003. The client generates this once per checkout attempt, so a double-click
     * or a retried request cannot create two bookings or two charges.
     */
    idempotencyKey: z.string().trim().min(16).max(128),
  })
  .strict()
  .refine((b) => b.checkOut > b.checkIn, {
    message: ERROR.VALIDATION_DEPARTURE_AFTER_ARRIVAL,
    path: ['checkOut'],
  });

export type BookingCreateInput = z.infer<typeof bookingCreateSchema>;

/** A partner answering within the two-hour window (§6.4). */
export const partnerBookingDecisionSchema = z
  .object({
    decision: z.enum(['confirm', 'reject']),
    /** Required on rejection so SAFRA can tell the customer why and act on it. */
    reason: z.string().trim().max(1000).optional(),
  })
  .strict()
  .refine((v) => v.decision !== 'reject' || (v.reason?.length ?? 0) > 0, {
    message: ERROR.VALIDATION_REJECTION_REASON_REQUIRED,
    path: ['reason'],
  });

export type PartnerBookingDecisionInput = z.infer<typeof partnerBookingDecisionSchema>;

/**
 * The floor on a cancellation reason, EXPORTED so the form and the schema cannot disagree.
 *
 * Same reasoning as `ENFORCEMENT_REASON_MIN` and a different number: this reason is written on a
 * record the customer already has, beside dates and an amount that supply the context, so it does
 * not carry the whole explanation the way «مخالفة» would. What it must not be is empty.
 *
 * It was a literal inside the schema and a literal the console would have had to copy — two places
 * knowing one number, which is the shape `DEFAULT_TABLE_PAGE_SIZE` exists to avoid.
 */
export const BOOKING_CANCEL_REASON_MIN = 3;

/** Cancellation by the customer or by staff on their behalf. */
export const bookingCancelSchema = z
  .object({ reason: z.string().trim().min(BOOKING_CANCEL_REASON_MIN).max(1000) })
  .strict();

export type BookingCancelInput = z.infer<typeof bookingCancelSchema>;

/**
 * A staff note against a booking, never shown to the customer or the partner (§9.4).
 *
 * `min(2)` matches the call log's floor rather than the cancellation reason's `min(3)`: a note is
 * an aide-mémoire on a record somebody already has open, not a decision that has to explain itself
 * to the person it affects. `.trim()` first, so a note of spaces is refused rather than stored.
 */
export const bookingInternalNoteSchema = z
  .object({ note: z.string().trim().min(2).max(2000) })
  .strict();

export type BookingInternalNoteInput = z.infer<typeof bookingInternalNoteSchema>;

/**
 * SAFRA confirming a booking the partner should have confirmed (§6.3 step 7).
 *
 * The reason is REQUIRED, and it is the entire difference between this and the partner pressing
 * their own button. A confirmation made by the platform rather than by the business hosting the
 * stay is an exception; an exception nobody can explain afterwards is one nobody should be able to
 * make. Twenty characters, matching the enforcement floor rather than the cancellation one —
 * «تم الاتصال» is not an explanation, and unlike a cancellation reason this one is read by a
 * colleague reconstructing a decision rather than by the customer beside the dates and the amount.
 */
export const bookingStaffConfirmSchema = z
  .object({ reason: z.string().trim().min(20).max(1000) })
  .strict();

export type BookingStaffConfirmInput = z.infer<typeof bookingStaffConfirmSchema>;

/**
 * What SAFRA is willing to COMPENSATE in — the same three it fines in.
 *
 * Narrower than `currencies`, which holds five: that table says what the platform can price in, and
 * this is a policy about SAFRA's own goodwill. Widening it is one line.
 */
export const COMPENSATION_CURRENCIES = ['USD', 'EUR', 'SYP'] as const;

/**
 * What an amount is denominated in when the row does not say.
 *
 * ## Why a fallback exists at all
 *
 * Standing rule from Bashar (2026-08-25): **no amount is ever written without its currency,
 * anywhere in the system.** Several rows can carry a null currency — a coupon with no fixed value,
 * a wallet balance on a profile that has never transacted — and the code used to print
 * `{money(x)} {currency ?? ''}`, which renders a bare number precisely when nobody can tell what
 * it is.
 *
 * ## Why USD, and why this is a fallback rather than a guess
 *
 * Every one of those rows is null because NOTHING has been denominated yet — a zero balance, an
 * unset minimum — so there is no other currency it could be. `currencies` carries USD as the
 * platform's reference rail and every fine and compensation is levied in it. A row that has a
 * currency always uses its own; this is only ever reached where the alternative is printing
 * nothing.
 */
export const DEFAULT_MONEY_CURRENCY = 'USD';

/**
 * §9.4's «تعويض» — a wallet credit made because of a booking.
 *
 * ## Credit only, unlike the general wallet adjustment
 *
 * `walletAdjustSchema` takes a `direction`, because the realistic use of a general adjustment is
 * correcting a mistake and a system that can only credit forces finance to fix an over-credit by
 * crediting somebody else. Compensation is not that: it is a decision to give a customer money
 * because their stay went wrong, and «تعويض» has no debit. Taking money back is still possible —
 * through the wallet screen, where it reads as what it is rather than as a compensation of a
 * negative amount.
 *
 * The amount is a decimal STRING for the reason every money field here is: a JSON number is an
 * IEEE-754 double and this one is added to somebody's balance.
 */
export const bookingCompensationSchema = z
  .object({
    amount: z
      .string()
      .regex(/^\d{1,10}(\.\d{1,2})?$/, ERROR.VALIDATION_DECIMAL_STRING)
      .refine((value) => Number(value) > 0, ERROR.VALIDATION_AMOUNT_POSITIVE),
    /**
     * The ENUM, not a three-letter pattern — the lesson `FINE_CURRENCIES` records.
     *
     * A select offering three while the endpoint accepts any code is a restriction in appearance
     * only: the next caller to post `JOD` succeeds and the rule turns out to have been a decoration
     * on one screen. The same three SAFRA fines in are the three it compensates in, and the form
     * reads this constant so the two cannot drift.
     */
    currency: z.enum(COMPENSATION_CURRENCIES, {
      message: ERROR.VALIDATION_CURRENCY_CODE,
    }),
    /** Why. Ten characters, matching the wallet's own floor — an unreviewable credit is not one. */
    note: z.string().trim().min(10, ERROR.VALIDATION_REASON_REQUIRED).max(500),
  })
  .strict();

export type BookingCompensationInput = z.infer<typeof bookingCompensationSchema>;

/** A price quote for a unit and date range, with nothing created. */
export const bookingQuoteSchema = z
  .object({
    unitId: z.string().uuid(),
    checkIn: calendarDateSchema,
    checkOut: calendarDateSchema,
  })
  .strict()
  .refine((q) => q.checkOut > q.checkIn, {
    message: ERROR.VALIDATION_DEPARTURE_AFTER_ARRIVAL,
    path: ['checkOut'],
  });

export type BookingQuoteInput = z.infer<typeof bookingQuoteSchema>;

/**
 * How close §6.4's confirmation window has to be before it is "expiring soon".
 *
 * ## Why this is a constant and not a literal in three queries
 *
 * It was a literal in three: the dashboard's EC-008 counter, the review service's queue metric, and
 * the bookings registry's filter. Three copies of a threshold that has to AGREE — the alert says
 * "twelve expiring soon" and the filter it links to must return twelve, or the operator concludes one
 * of them is broken and stops trusting both.
 *
 * Thirty minutes is a product judgement: long enough that somebody can act, short enough that the
 * queue is not everything still pending.
 */
export const SLA_EXPIRY_WARNING_MINUTES = 30;

/**
 * How long after an arrival date a stay with no check-in becomes an administrative alert (EC-011).
 *
 * «الشريك نسي Check-in — تنبيه إداري بعد ٢٤ ساعة من موعد الوصول». Twenty-four hours is the SRS's
 * own number, and it is chosen rather than arbitrary: a guest arriving late in the evening may not
 * be recorded until the next morning, so anything shorter alerts on the ordinary case.
 *
 * Exported for the same reason `SLA_EXPIRY_WARNING_MINUTES` is — the dashboard counter and the
 * registry filter it links to must agree, or the operator is told twelve and shown nine.
 */
export const ARRIVAL_ALERT_HOURS = 24;

/**
 * EC-010 tier 1 — a customer asking where their booking reference went.
 *
 * ## The response says the same thing either way
 *
 * An email address is not a secret: it is on every invoice and in every forwarded confirmation.
 * So this endpoint must not become an oracle — «does this person have a booking» is exactly the
 * question it must refuse to answer. It replies identically whether or not anything was found,
 * and the reference travels to the MAILBOX, not to whoever typed the address. Same shape
 * `O-sec-2` established for registration.
 */
export const bookingRecoverySchema = z.object({ email: emailSchema }).strict();

export type BookingRecoveryInput = z.infer<typeof bookingRecoverySchema>;

/**
 * How long a staff-assisted verification code lives, and how many guesses it gets (tier 2).
 *
 * Five minutes because the agent is on the telephone with the customer — long enough to read a
 * code back, short enough that one left on a notepad is useless. Three attempts because six digits
 * is a million possibilities and a support call has no rate limit of its own: the ceiling is what
 * bounds the guessing, not the hash.
 */
export const BOOKING_VERIFICATION_MINUTES = 5;
export const BOOKING_VERIFICATION_ATTEMPTS = 3;

/** Redeeming that code. Six digits, and the code is never echoed back. */
export const bookingVerificationSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/, ERROR.VALIDATION_REQUIRED),
  })
  .strict();

export type BookingVerificationInput = z.infer<typeof bookingVerificationSchema>;

/**
 * The attention filters الحجوزات accepts, and the codes they answer to.
 *
 * A booking's registry needs a destination for every alert the dashboard raises, on the SAME
 * predicate — see `SLA_EXPIRY_WARNING_MINUTES`. These are the two added on 2026-08-25 with EC-004
 * and EC-011; `expiring=1` predates them and keeps its own parameter.
 */
export const BOOKING_ATTENTION = ['no_check_in', 'unconfirmed'] as const;

export type BookingAttention = (typeof BOOKING_ATTENTION)[number];
