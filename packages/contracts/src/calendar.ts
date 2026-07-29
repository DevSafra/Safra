import { z } from 'zod';

import { calendarDateSchema } from './search.js';

/**
 * Availability calendar contract (SRS §8.4).
 *
 * A unit's calendar is the partner's responsibility (principle P-006), so these
 * are the only write operations they need: set a date range's state, override a
 * nightly price, or adjust minimum nights.
 */

export const DAY_STATUSES = ['available', 'booked', 'closed', 'maintenance'] as const;
export const dayStatusSchema = z.enum(DAY_STATUSES);
export type DayStatus = z.infer<typeof dayStatusSchema>;

/**
 * `booked` is deliberately NOT settable by a partner.
 *
 * It is derived from real bookings, and letting a partner write it by hand would
 * let them mark a unit booked without a booking existing — hiding inventory from
 * SAFRA while appearing compliant. To take a unit off sale they use `closed`
 * (§8.4: "if the unit was rented outside SAFRA, close it immediately") or
 * `maintenance`.
 */
export const partnerSettableStatusSchema = z.enum(['available', 'closed', 'maintenance']);

/** Bulk range update — the calendar UI edits spans, not single days. */
export const calendarRangeUpdateSchema = z
  .object({
    from: calendarDateSchema,
    to: calendarDateSchema,
    status: partnerSettableStatusSchema.optional(),
    /**
     * Nightly override. `null` clears it and falls back to units.basePrice —
     * distinct from omitting the field, which leaves any existing price alone.
     */
    price: z.union([z.number().min(0).max(1_000_000), z.null()]).optional(),
    minNights: z.union([z.number().int().min(1).max(365), z.null()]).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((v) => v.to >= v.from, {
    message: 'End date must not be before the start date.',
    path: ['to'],
  })
  .refine(
    (v) =>
      v.status !== undefined ||
      v.price !== undefined ||
      v.minNights !== undefined ||
      v.note !== undefined,
    { message: 'Provide at least one field to update.' },
  )
  .refine(
    (v) => {
      // A range longer than roughly two years is almost certainly a client bug,
      // and each day is a row — so it is rejected rather than silently written.
      const days =
        (Date.parse(`${v.to}T00:00:00Z`) - Date.parse(`${v.from}T00:00:00Z`)) /
        86_400_000;
      return days <= 730;
    },
    { message: 'A calendar range may not exceed 730 days.', path: ['to'] },
  );

export type CalendarRangeUpdate = z.infer<typeof calendarRangeUpdateSchema>;

export const calendarQuerySchema = z
  .object({
    from: calendarDateSchema,
    to: calendarDateSchema,
  })
  .strict()
  .refine((v) => v.to >= v.from, {
    message: 'End date must not be before the start date.',
    path: ['to'],
  });

export type CalendarQuery = z.infer<typeof calendarQuerySchema>;

export interface CalendarDay {
  date: string;
  status: DayStatus;
  /** Effective nightly price: the override if set, otherwise the unit's base. */
  price: string;
  isPriceOverridden: boolean;
  minNights: number;
  note: string | null;
}
