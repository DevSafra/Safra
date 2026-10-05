import { z } from 'zod';

import { ERROR } from './error-codes.js';
import { westernDigits } from './digits.js';
import { calendarDateSchema } from './search.js';

/**
 * جروبات — the trips SAFRA puts together (Bashar, 2026-09-27; built 2026-09-28).
 *
 * ## One write surface, because there is one author
 *
 * *«only the admin can create a group trip for this»*. There is no partner schema and no customer
 * one, which is how the authorization is expressed: not as a check that could be forgotten, but as
 * the absence of any shape somebody else could post. The same argument the FAQ's general entries
 * make one file over.
 *
 * ## An announcement, not a booking
 *
 * `seats` and `priceFrom` are things a reader is TOLD. Nothing here reconciles a seat against a
 * payment, because the booking engine books a unit with a quantity and a group trip is a different
 * object — see the schema note. When it becomes bookable, that arrives beside this rather than
 * inside it.
 */

/** Lowercase Latin, digits and hyphens — the shape every public slug on this platform takes. */
const slug = z
  .string()
  .trim()
  .min(3)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, ERROR.CATALOGUE_CODE_FORMAT);

const title = z.string().trim().min(3).max(160);
/** One line on a card. Long enough to say what the trip is, short enough not to become the body. */
const summary = z.string().trim().min(3).max(300);
const description = z.string().trim().min(10).max(8000);

/**
 * An optional translation: `null` clears it, and OMITTING it leaves it alone.
 *
 * The distinction is load-bearing and was wrong: `.transform((v) => (v ? v : null))` maps an absent
 * field to `null`, so a PATCH carrying only a title would have WIPED the English and German copy it
 * never mentioned — and the service's `=== undefined ? before : input` merge could never see the
 * `undefined` it tests for. Preserving it keeps «not mentioned» and «cleared» different requests.
 */
const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => value || null)
    /* LAST, so the KEY itself is optional — a transform inside `.nullish()` makes it required. */
    .optional();

/**
 * `YYYY-MM-DD`, a REAL date, typed in either digit set (audit 2026-10-04).
 *
 * Through `calendarDateSchema` so «2026-02-30» is refused with a code rather than reaching Postgres
 * and coming back as a 500, and through `westernDigits` so «٢٠٢٦-١٠-٠٤» from an Arabic keyboard is
 * the date it says.
 */
const day = z.string().trim().transform(westernDigits).pipe(calendarDateSchema);

export const GROUP_TRIP_STATUSES = ['draft', 'published', 'archived'] as const;
export type GroupTripStatus = (typeof GROUP_TRIP_STATUSES)[number];

/**
 * The most trips a public page will ever carry.
 *
 * The same backstop the FAQ has, for the same reason: how many trips exist is an operator decision
 * with nothing bounding it, and the customer list is the one place that unboundedness becomes a
 * payload. `group-trip-bounds.integration.test.ts` is the ALARM and fires lower; this is the stop.
 */
export const PUBLIC_GROUP_TRIPS_LIMIT = 60;

/**
 * A price and its currency arrive together or not at all.
 *
 * «المبلغ 200» is not a smaller version of the right answer — SYP and USD differ by four orders of
 * magnitude, and `.claude/CLAUDE.md` forbids the shape outright. The database carries the same rule
 * as a CHECK constraint; this one exists so the form can name the field instead of surfacing a
 * constraint violation.
 */
const pricedTogether = <T extends { priceFrom?: unknown; currencyCode?: unknown }>(
  value: T,
) => (value.priceFrom == null) === (value.currencyCode == null);

const priceBase = {
  /** A decimal string, because money is never a float on this platform. */
  priceFrom: z
    .string()
    .trim()
    .transform(westernDigits)
    .pipe(z.string().regex(/^\d{1,12}(\.\d{1,3})?$/, ERROR.REQUEST_VALIDATION_FAILED))
    .nullable()
    .transform((value) => value || null)
    .optional(),
  currencyCode: z
    .string()
    .trim()
    .length(3)
    .nullable()
    .transform((value) => (value ? value.toUpperCase() : null))
    .optional(),
};

export const groupTripCreateSchema = z
  .object({
    slug,
    citySlug: z.string().trim().min(1).max(80),
    titleAr: title,
    titleEn: optional(160),
    titleDe: optional(160),
    summaryAr: summary,
    summaryEn: optional(300),
    summaryDe: optional(300),
    descriptionAr: description,
    descriptionEn: optional(8000),
    descriptionDe: optional(8000),
    startsOn: day,
    endsOn: day,
    ...priceBase,
    seats: z.number().int().min(1).max(10_000).nullish(),
  })
  .strict()
  .refine((v) => v.endsOn >= v.startsOn, {
    message: ERROR.GROUP_TRIP_DATES_ORDER,
    path: ['endsOn'],
  })
  .refine(pricedTogether, {
    message: ERROR.GROUP_TRIP_PRICE_NEEDS_CURRENCY,
    path: ['currencyCode'],
  });

export const groupTripUpdateSchema = z
  .object({
    citySlug: z.string().trim().min(1).max(80).optional(),
    titleAr: title.optional(),
    titleEn: optional(160),
    titleDe: optional(160),
    summaryAr: summary.optional(),
    summaryEn: optional(300),
    summaryDe: optional(300),
    descriptionAr: description.optional(),
    descriptionEn: optional(8000),
    descriptionDe: optional(8000),
    startsOn: day.optional(),
    endsOn: day.optional(),
    ...priceBase,
    seats: z.number().int().min(1).max(10_000).nullish(),
    /**
     * The slug is NOT updatable, and that is the same decision `code` takes in كتالوج المنصّة: it
     * is what a public URL keys on, so renaming it looks like a rename and behaves like a deletion
     * to everybody who bookmarked or shared the old one.
     */
    status: z.enum(GROUP_TRIP_STATUSES).optional(),
    /**
     * What the cover photograph SAYS, in each language it serves.
     *
     * Here rather than on the upload endpoint, for the reason `city_images` learnt the hard way:
     * every city photograph the platform ever served went out with an EMPTY alt because the
     * columns existed and nothing could write them. Alt text is COPY — it belongs beside the title
     * and the summary, where a translator looks, not attached to a multipart byte upload nobody
     * revisits.
     *
     * `optional()` maps a present-but-null to null and an ABSENT key to undefined, so «clear the
     * alt» and «do not touch the alt» stay different requests. A decorative cover legitimately has
     * none; the CHECK constraint only forbids alt text with no picture, never a picture with no
     * alt.
     */
    coverAltAr: optional(300),
    coverAltEn: optional(300),
    coverAltDe: optional(300),
  })
  .strict()
  .refine(
    (v) => v.startsOn === undefined || v.endsOn === undefined || v.endsOn >= v.startsOn,
    {
      message: ERROR.GROUP_TRIP_DATES_ORDER,
      path: ['endsOn'],
    },
  )
  .refine(pricedTogether, {
    message: ERROR.GROUP_TRIP_PRICE_NEEDS_CURRENCY,
    path: ['currencyCode'],
  });

export type GroupTripCreateInput = z.infer<typeof groupTripCreateSchema>;
export type GroupTripUpdateInput = z.infer<typeof groupTripUpdateSchema>;
