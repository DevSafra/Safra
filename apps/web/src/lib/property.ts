import { z } from 'zod';

import { CUSTOMER_FACING_METHODS, type CustomerFacingMethod } from '@safra/contracts';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

const translated = z.object({
  ar: z.string().nullable(),
  en: z.string().nullable(),
  de: z.string().nullable(),
});

const propertyDetailSchema = z.object({
  reference: z.string(),
  slug: z.string(),
  name: translated,
  description: translated,
  addressApproximate: z.string(),
  latitude: z.string().nullable(),
  longitude: z.string().nullable(),
  exactLocationAfterBooking: z.boolean(),
  city: z.object({
    slug: z.string(),
    nameAr: z.string(),
    nameEn: z.string(),
    nameDe: z.string(),
    timezone: z.string(),
    countryCode: z.string(),
  }),
  propertyTypeCode: z.string(),
  rating: z.string().nullable(),
  reviewsCount: z.number(),
  badges: z.array(z.string()),
  attributes: z.array(z.string()),
  cancellationPolicy: z.object({
    code: z.string(),
    nameAr: z.string(),
    nameEn: z.string(),
    nameDe: z.string(),
    descriptionAr: z.string(),
    descriptionEn: z.string(),
    descriptionDe: z.string(),
    tiers: z.array(
      z.object({ hoursBeforeCheckIn: z.number(), refundPercent: z.number() }),
    ),
    minRefundPercent: z.number(),
  }),
  units: z.array(
    z.object({
      id: z.string(),
      name: translated,
      maxGuests: z.number(),
      bedrooms: z.number(),
      beds: z.number(),
      bathrooms: z.number(),
      basePrice: z.string(),
      currencyCode: z.string(),
      minNights: z.number(),
      maxNights: z.number().nullable(),
      roomTypeCode: z.string().nullable(),
      amenityCodes: z.array(z.string()),
    }),
  ),
  images: z.array(
    z.object({
      fileKey: z.string(),
      alt: translated,
      width: z.number().nullable(),
      height: z.number().nullable(),
      variantWidths: z.array(z.number()),
      isCover: z.boolean(),
    }),
  ),
  calendar: z.array(
    z.object({
      date: z.string(),
      status: z.enum(['available', 'booked', 'closed', 'maintenance']),
      fromPrice: z.string().nullable(),
    }),
  ),
  fees: z.object({
    customerFeeMode: z.string(),
    customerFeeValue: z.number(),
  }),
  /**
   * The ten most recent PUBLISHED reviews.
   *
   * A sample, not the whole set — `reviewsCount` above says how many there are, so the list is
   * never mistaken for the total. Hidden reviews are excluded by the API's WHERE clause, not by
   * anything here: a client-side filter would be one reorder away from publishing something staff
   * decided to remove.
   *
   * `.default([])` so a property page built against an older API still renders. The listing is the
   * point of the screen; its reviews are not worth failing the whole parse over.
   */
  reviews: z
    .array(
      z.object({
        reference: z.string(),
        /** A first name, or null. Never a surname — see the note on the API's `reviews()`. */
        author: z.string().nullable(),
        rating: z.number(),
        body: z.string(),
        unitName: z.object({ ar: z.string().nullable(), en: z.string().nullable() }),
        partnerReply: z.string().nullable(),
        partnerRepliedAt: z.string().nullable(),
        createdAt: z.string(),
      }),
    )
    .default([]),
});

export type PropertyDetail = z.infer<typeof propertyDetailSchema>;

/**
 * Property detail (§5.6).
 *
 * Cached for a minute rather than not at all: the page is a shop window, and its
 * calendar is illustrative. The booking flow re-validates availability against the
 * exclusion constraint, so a minute of staleness cannot oversell anything.
 */
export async function getProperty(slug: string): Promise<PropertyDetail | null> {
  try {
    const response = await fetch(
      `${API_URL}/api/v1/properties/${encodeURIComponent(slug)}`,
      { headers: { Accept: 'application/json' }, next: { revalidate: 60 } },
    );

    if (!response.ok) return null;

    const parsed = propertyDetailSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Builds a media URL for the best variant that ACTUALLY exists.
 *
 * The pipeline never upscales, so a 1200 px source has no 1600 px variant.
 * Requesting one produced a 404 and a broken gallery. Picking from the stored
 * `variantWidths` keeps the frontend honest about what was rendered.
 */
export function imageUrl(
  image: { fileKey: string; variantWidths: number[] },
  desiredWidth: number,
  format: 'avif' | 'webp' = 'avif',
): string {
  const base = process.env['NEXT_PUBLIC_MEDIA_URL'] ?? `${API_URL}/api/v1/media`;

  const available = [...image.variantWidths].sort((a, b) => a - b);
  const chosen =
    available.filter((w) => w <= desiredWidth).pop() ?? available[0] ?? desiredWidth;

  return `${base}/${image.fileKey}-${chosen}.${format}`;
}

const quoteSchema = z.object({
  nights: z.number(),
  baseAmount: z.string(),
  customerFeeAmount: z.string(),
  totalAmount: z.string(),
  currencyCode: z.string(),
  nightly: z.array(z.object({ date: z.string(), amount: z.string() })),
});

export type Quote = z.infer<typeof quoteSchema>;

/**
 * A live price quote for a specific unit and date range.
 *
 * Never cached. The checkout total is what the customer is about to be charged, and a
 * stale figure there is a dispute waiting to happen. Returns null when the unit is no
 * longer bookable, so the page can say so rather than showing a price for something
 * unavailable.
 */
export async function quote(input: {
  unitId: string;
  checkIn: string;
  checkOut: string;
}): Promise<Quote | null> {
  const url = new URL(`${API_URL}/api/v1/bookings/quote`);
  url.searchParams.set('unitId', input.unitId);
  url.searchParams.set('checkIn', input.checkIn);
  url.searchParams.set('checkOut', input.checkOut);

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });

    if (!response.ok) return null;

    const parsed = quoteSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const methodsSchema = z.object({
  methods: z.array(z.enum(CUSTOMER_FACING_METHODS)),
});

/**
 * Which payment methods checkout may offer for this property's country (§7.1).
 *
 * Asked of the API rather than hardcoded in the UI, because "is this rail actually
 * available?" depends on provider routing that a super admin controls (P-005).
 * Hardcoding the four approved logos would show a customer a Klarna button months
 * before Klarna is contracted.
 *
 * An empty array is a real answer, not a failure: no external rail is live until an
 * acquirer or Klarna agreement exists. On a network error it also returns empty —
 * offering nothing is the safe failure, since offering a method that cannot be
 * served strands the customer mid-checkout.
 */
export async function availablePaymentMethods(
  countryCode: string,
): Promise<CustomerFacingMethod[]> {
  const url = new URL(`${API_URL}/api/v1/payments/methods`);
  url.searchParams.set('country', countryCode);

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      // Short cache: this changes only when an admin edits routing, and checkout
      // must not pay a round trip for it on every render (§3).
      next: { revalidate: 60 },
    });

    if (!response.ok) return [];

    const parsed = methodsSchema.safeParse(await response.json());
    return parsed.success ? [...parsed.data.methods] : [];
  } catch {
    return [];
  }
}
