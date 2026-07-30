import { z } from 'zod';

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
