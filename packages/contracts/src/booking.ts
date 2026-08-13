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

/** Cancellation by the customer or by staff on their behalf. */
export const bookingCancelSchema = z
  .object({ reason: z.string().trim().min(3).max(1000) })
  .strict();

export type BookingCancelInput = z.infer<typeof bookingCancelSchema>;

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
