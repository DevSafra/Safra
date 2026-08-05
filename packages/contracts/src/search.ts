import { z } from 'zod';
import { ERROR } from './error-codes.js';

/**
 * Search contract and the same-day booking cutoff (SRS §5.2, §5.3).
 *
 * Lives in contracts because BOTH sides need it: the API rejects a closed
 * same-day arrival, and the web date picker must grey out the same date. If these
 * disagreed the customer would pick a date the server then refuses.
 */

/** Calendar date, `YYYY-MM-DD`. Deliberately a string, never a Date. */
export const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, ERROR.VALIDATION_DATE_FORMAT)
  .refine((v) => {
    const [y, m, d] = v.split('-').map(Number) as [number, number, number];
    const probe = new Date(Date.UTC(y, m - 1, d));
    // Rejects 2026-02-30 and similar, which the regex alone accepts.
    return (
      probe.getUTCFullYear() === y &&
      probe.getUTCMonth() === m - 1 &&
      probe.getUTCDate() === d
    );
  }, ERROR.VALIDATION_DATE_UNREAL);

/**
 * §5.2 makes arrival, departure and guest count MANDATORY — "searching or booking
 * without them is not permitted" — while city and trip attributes are optional.
 * That asymmetry is encoded here rather than left to the UI.
 */
export const TRIP_ATTRIBUTES = [
  'sea',
  'mountain',
  'history',
  'nature',
  'families',
  'honeymoon',
  'pool',
  'parking',
  'internet',
  'business',
] as const;

export const tripAttributeSchema = z.enum(TRIP_ATTRIBUTES);
export type TripAttribute = z.infer<typeof tripAttributeSchema>;

/**
 * A repeatable query parameter arrives as a STRING when supplied once and an
 * ARRAY when supplied twice (`?a=x` vs `?a=x&a=y`). Express does not normalise
 * this, so the schema has to: without it, filtering by a single amenity or
 * attribute fails validation while two of them succeed.
 */
const queryArray = <T extends z.ZodTypeAny>(element: T) =>
  z.preprocess((value: unknown): unknown[] => {
    if (value === undefined) {
      return [];
    }

    // Array.isArray narrows to any[], so the cast is explicit rather than implied.
    // The element schema validates each entry immediately afterwards.
    return Array.isArray(value) ? (value as unknown[]) : [value];
  }, z.array(element));

export const searchQuerySchema = z
  .object({
    checkIn: calendarDateSchema,
    checkOut: calendarDateSchema,
    adults: z.coerce.number().int().min(1).max(30),
    children: z.coerce.number().int().min(0).max(20).default(0),
    infants: z.coerce.number().int().min(0).max(10).default(0),

    /** Optional: §5.2 allows searching with no city selected. */
    citySlug: z.string().trim().min(1).max(80).optional(),
    propertyTypeCode: z.string().trim().min(1).max(40).optional(),
    attributes: queryArray(tripAttributeSchema).default([]),
    amenityCodes: queryArray(z.string().trim().min(1).max(40)).default([]),

    minPrice: z.coerce.number().min(0).max(1_000_000).optional(),
    maxPrice: z.coerce.number().min(0).max(1_000_000).optional(),
    freeCancellationOnly: z.coerce.boolean().default(false),

    /** §5.5: default order is "SAFRA recommends", NOT cheapest-first. */
    sort: z
      .enum(['recommended', 'price_asc', 'price_desc', 'rating_desc'])
      .default('recommended'),

    limit: z.coerce.number().int().min(1).max(60).default(20),
    cursor: z.string().max(200).optional(),
  })
  .strict()
  .refine((q) => q.checkOut > q.checkIn, {
    message: ERROR.VALIDATION_DEPARTURE_AFTER_ARRIVAL,
    path: ['checkOut'],
  })
  .refine(
    (q) =>
      q.minPrice === undefined || q.maxPrice === undefined || q.minPrice <= q.maxPrice,
    {
      message: ERROR.VALIDATION_PRICE_RANGE,
      path: ['minPrice'],
    },
  );

export type SearchQuery = z.infer<typeof searchQuerySchema>;

// ─── Same-day cutoff (§5.3) ──────────────────────────────────────────────────

export const DEFAULT_SAME_DAY_CUTOFF_HOUR = 17;

/**
 * The calendar date and hour *in a given city*, at a given instant.
 *
 * Uses Intl with an explicit timeZone rather than manual UTC-offset arithmetic.
 * Offsets are not constant — Asia/Beirut observes DST while Asia/Damascus and
 * Asia/Amman no longer do — so any hardcoded offset would be wrong for part of
 * the year in Lebanon. Intl reads the IANA database and stays correct.
 */
export function cityLocalNow(
  instant: Date,
  timeZone: string,
): { date: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(instant);

  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';

  // Intl renders midnight as hour "24" in some engines/locales; normalise it.
  const rawHour = Number(get('hour'));
  const hour = rawHour === 24 ? 0 : rawHour;

  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour,
    minute: Number(get('minute')),
  };
}

/** Adds whole days to a `YYYY-MM-DD` string, handling month and year rollover. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(y, m - 1, d + days));

  // UTC arithmetic is safe here: this is pure calendar maths on a date-only value,
  // with no wall-clock or DST component involved.
  return [
    String(shifted.getUTCFullYear()).padStart(4, '0'),
    String(shifted.getUTCMonth() + 1).padStart(2, '0'),
    String(shifted.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

/**
 * §5.3: same-day booking is allowed ONLY if the booking is created before 17:00
 * in the city's local time. At or after the cutoff, today closes and the earliest
 * arrival becomes tomorrow.
 *
 * The boundary is deliberately exclusive — the spec permits booking "before
 * 17:00", so exactly 17:00:00 is already closed.
 */
export function isSameDayClosed(
  instant: Date,
  timeZone: string,
  cutoffHour: number = DEFAULT_SAME_DAY_CUTOFF_HOUR,
): boolean {
  return cityLocalNow(instant, timeZone).hour >= cutoffHour;
}

/**
 * The earliest arrival date a customer may select, as a `YYYY-MM-DD` string in the
 * city's local calendar. Feeds both the API guard and the date picker's minimum.
 */
export function firstBookableDate(
  instant: Date,
  timeZone: string,
  cutoffHour: number = DEFAULT_SAME_DAY_CUTOFF_HOUR,
): string {
  const local = cityLocalNow(instant, timeZone);
  return local.hour >= cutoffHour ? addDays(local.date, 1) : local.date;
}

export interface CutoffVerdict {
  allowed: boolean;
  firstBookableDate: string;
  /** Set only when rejected, so the API can return a translated message. */
  reason?: 'same_day_closed' | 'date_in_past';
}

/**
 * Validates a requested arrival against the cutoff.
 *
 * Distinguishes "today is closed" from "that date has already passed", because
 * the customer-facing messages differ: §5.3 requires telling them today's
 * bookings have ended and naming the next available date.
 */
export function evaluateArrival(
  requestedCheckIn: string,
  instant: Date,
  timeZone: string,
  cutoffHour: number = DEFAULT_SAME_DAY_CUTOFF_HOUR,
): CutoffVerdict {
  const earliest = firstBookableDate(instant, timeZone, cutoffHour);
  const today = cityLocalNow(instant, timeZone).date;

  if (requestedCheckIn < today) {
    return { allowed: false, firstBookableDate: earliest, reason: 'date_in_past' };
  }

  if (requestedCheckIn < earliest) {
    return { allowed: false, firstBookableDate: earliest, reason: 'same_day_closed' };
  }

  return { allowed: true, firstBookableDate: earliest };
}
