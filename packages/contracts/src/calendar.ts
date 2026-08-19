import { z } from 'zod';

import { calendarDateSchema } from './search.js';
import { cursorQuerySchema } from './pagination.js';
import { ERROR } from './error-codes.js';

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
    message: ERROR.VALIDATION_END_BEFORE_START,
    path: ['to'],
  })
  .refine(
    (v) =>
      v.status !== undefined ||
      v.price !== undefined ||
      v.minNights !== undefined ||
      v.note !== undefined,
    { message: ERROR.VALIDATION_ONE_FIELD_REQUIRED },
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
    { message: ERROR.VALIDATION_RANGE_TOO_LONG, path: ['to'] },
  );

export type CalendarRangeUpdate = z.infer<typeof calendarRangeUpdateSchema>;

export const calendarQuerySchema = z
  .object({
    from: calendarDateSchema,
    to: calendarDateSchema,
  })
  .strict()
  .refine((v) => v.to >= v.from, {
    message: ERROR.VALIDATION_END_BEFORE_START,
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

/**
 * `YYYY-MM` — exactly one calendar month.
 *
 * The portfolio calendar takes a MONTH rather than a `from`/`to` pair, and that is a BOUND rather
 * than a convenience. `calendarQuerySchema` above accepts any range at all, and the read expands
 * units × days, so `from=1900-01-01&to=2100-01-01` is a 73,000-row answer per unit to a request
 * that costs nothing to make. Across a portfolio that is the shape of a denial-of-service. A month
 * caps every unit at 31 rows by construction, and the screen shows one month anyway.
 */
export const calendarMonthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, ERROR.VALIDATION_DATE_FORMAT)
  /*
    And bounded to years the platform could plausibly trade in, so a mistyped year is a 400 rather
    than a generated series a century away.
  */
  .refine((v) => {
    const year = Number(v.slice(0, 4));

    return year >= 2000 && year <= 2100;
  }, ERROR.VALIDATION_DATE_UNREAL);

/**
 * The whole portfolio's month, paginated by PROPERTY.
 *
 * Paginated by property rather than by unit because the screen groups units under the property they
 * belong to: a cursor over units could split a hotel's rooms across a page boundary, and a group
 * header with three of its five rooms under it is a worse answer than a second page.
 *
 * `limit` and `expand` are two different questions: how many properties to LIST, and which single
 * one to EXPAND. Separating them is what keeps the cost of the screen flat — the list is four
 * columns per property, and only the open property pays for its units times every day of the month.
 */
export const portfolioCalendarQuerySchema = cursorQuerySchema
  .extend({
    month: calendarMonthSchema,
    /**
     * How many properties to LIST. Not how many to expand — see `expand`.
     *
     * The ceiling was 10 because a page used to expand every day of every unit of every property it
     * returned, so the unit of cost was enormous. Listing a property is four columns and one indexed
     * seek, so the list can hold a whole portfolio: 200 is a bound rather than a budget, and a
     * partner with more properties than that has a conversation coming anyway.
     */
    limit: z.coerce.number().int().min(1).max(200).default(200),
    /**
     * Which property's month to EXPAND — the one the reader has open.
     *
     * Days are the expensive part: one property times its units times every day of the month. Only
     * the open one is expanded, so the cost of the screen stops growing with the portfolio, and the
     * ceiling that used to hide a partner's eleventh property is gone (Bashar, 2026-08-19).
     *
     * Absent means the first property in the page, so the screen still opens on a calendar.
     */
    expand: z.string().trim().max(40).optional(),
  })
  .strict();

export type PortfolioCalendarQuery = z.infer<typeof portfolioCalendarQuerySchema>;

export interface PortfolioCalendarUnit {
  unitId: string;
  nameAr: string;
  /**
   * «رقم الوحدة» — the physical identifier the partner uses at check-in, e.g. `204` or `A-12`.
   *
   * Carried on this screen because it is where a partner picks WHICH room to work on, and a name
   * like «غرفة مزدوجة» is shared by every double room in the building. Null where none was given.
   */
  unitLabel: string | null;
  /** The unit's own base price, for the editor's "unchanged" placeholder. */
  basePrice: string;
  currencyCode: string;
  minNights: number;
  /**
   * Whether the unit is on sale at all.
   *
   * Inactive units are RETURNED, unlike the dashboard's portfolio counters which exclude them. The
   * two answer different questions: the dashboard says what a customer can book, where an off-sale
   * unit would overstate supply; this screen lists what the partner OWNS, and silently omitting a
   * room would read as the page having lost it.
   */
  isActive: boolean;
  days: CalendarDay[];
}

export interface PortfolioCalendarProperty {
  reference: string;
  nameAr: string;
  /**
   * Every unit of the property, always — but `days` is filled only for the EXPANDED property.
   *
   * The metadata is cheap and the folder needs it closed: a summary that could not say «5 وحدة»
   * until it was opened would make the reader open every folder to find out where anything is.
   */
  units: PortfolioCalendarUnit[];
}

export interface PortfolioCalendar {
  /** Echoed back so a client cannot render one month's grid under another month's heading. */
  month: string;
  properties: PortfolioCalendarProperty[];
  nextCursor: string | null;
}
