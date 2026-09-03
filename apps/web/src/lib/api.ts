import { z } from 'zod';

/**
 * Server-side API client.
 *
 * Every call runs on the server, so the browser never talks to the API directly.
 * That keeps the access token out of client JavaScript entirely and means search
 * results are server-rendered — which §5.4 requires for the city pages to be
 * indexable at all.
 *
 * Responses are parsed with Zod rather than cast. The API is ours, but a shape
 * change would otherwise surface as an unreadable render error deep in a component
 * instead of a clear failure at the boundary.
 */
const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface FetchOptions {
  /**
   * ISR window in seconds. Reference data (cities, property types) changes rarely
   * and is cached; availability-dependent search never is, because a stale result
   * would offer a room that is already gone.
   */
  revalidate?: number | false;
  searchParams?: Record<string, string | string[] | number | boolean | undefined>;
}

async function apiFetch<T>(
  path: string,
  schema: z.ZodType<T>,
  options: FetchOptions = {},
): Promise<T> {
  const url = new URL(`${API_URL}/api/v1${path}`);

  for (const [key, value] of Object.entries(options.searchParams ?? {})) {
    if (value === undefined) continue;

    // Repeated params for arrays — the API normalises single vs repeated values.
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, item);
    } else {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    next:
      options.revalidate === false
        ? { revalidate: 0 }
        : { revalidate: options.revalidate ?? 60 },
  });

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    // The API returns generic messages by design; anything more detailed stays in
    // its logs. Surfacing the status lets the page choose a sensible fallback.
    // `'message' in body` already narrows, so no assertion is needed here.
    const message =
      typeof body === 'object' && body !== null && 'message' in body
        ? String(body.message)
        : `Request failed with ${response.status}`;

    throw new ApiError(message, response.status, body);
  }

  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    throw new ApiError(
      `Unexpected API response for ${path}: ${parsed.error.issues[0]?.message ?? 'shape mismatch'}`,
      response.status,
      body,
    );
  }

  return parsed.data;
}

// ─── Search ──────────────────────────────────────────────────────────────────

export const searchResultItemSchema = z.object({
  propertyReference: z.string(),
  slug: z.string(),
  nameAr: z.string(),
  nameEn: z.string(),
  nameDe: z.string(),
  citySlug: z.string(),
  cityNameAr: z.string(),
  cityNameEn: z.string(),
  cityNameDe: z.string(),
  propertyTypeCode: z.string(),
  rating: z.string().nullable(),
  reviewsCount: z.number(),
  badges: z.array(z.string()),
  recommendationScore: z.string(),
  cancellationPolicyCode: z.string(),
  unitId: z.string(),
  nightlyFrom: z.string(),
  stayTotal: z.string(),
  currencyCode: z.string(),
  nights: z.number(),
  /**
   * The photograph the card leads with, or `null` where the listing has none.
   *
   * `.nullable()`, never `.default()`. A default here would invent a plausible value for something
   * the API did not send, and the failure it hides is exactly the one that matters: a card drawing
   * an image element around a `fileKey` that does not exist renders a broken frame, where a real
   * `null` renders the card's own fallback.
   */
  cover: z
    .object({
      fileKey: z.string(),
      variantWidths: z.array(z.number()),
      width: z.number().nullable(),
      height: z.number().nullable(),
      alt: z.object({
        ar: z.string().nullable(),
        en: z.string().nullable(),
        de: z.string().nullable(),
      }),
    })
    .nullable(),
});

export type SearchResultItem = z.infer<typeof searchResultItemSchema>;

const searchResponseSchema = z.object({
  items: z.array(searchResultItemSchema),
  nextCursor: z.string().nullable(),
  /*
    `.nullable()`, never `.optional()` and never `.default(null)`. A default would invent a value
    for something the API did not send, and the failure it would hide is a «السابق» link that
    silently stops appearing after a deploy where the field was dropped.
  */
  previousCursor: z.string().nullable(),
  firstBookableDate: z.string(),
});

export interface SearchParams {
  checkIn: string;
  checkOut: string;
  adults: number;
  // `| undefined` is required by exactOptionalPropertyTypes: callers build these
  // from query strings where an absent parameter is genuinely undefined.
  children?: number | undefined;
  /* §5.2. Sent, and deliberately NOT counted toward occupancy — see `search.service.ts`. */
  infants?: number | undefined;
  citySlug?: string | undefined;
  propertyTypeCode?: string | undefined;
  attributes?: string[] | undefined;
  amenityCodes?: string[] | undefined;
  /**
   * The nightly range, the free-cancellation switch and the cursor.
   *
   * `searchQuerySchema` has accepted all four since it was written and this interface carried none
   * of them, so `/search` could not offer a price filter and — the part that broke a rule rather
   * than merely omitting a feature — **could not reach result 25**. `limit` caps at 60 and the page
   * asked for 24, which made the twenty-fifth stay unreachable by any means: not by scrolling, not
   * by paging, not by editing the URL. §2 requires every customer-facing list to be paginated, and
   * cursor is the only permitted mechanism for one.
   *
   * `minPrice`/`maxPrice` are in the LISTING's currency, which is what the API filters on. The card
   * converts for display; the filter cannot, because a range converted at the reader's rate would
   * silently exclude listings priced in a currency whose rate is stale.
   */
  minPrice?: number | undefined;
  maxPrice?: number | undefined;
  freeCancellationOnly?: boolean | undefined;
  sort?: string | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}

export async function search(params: SearchParams) {
  return apiFetch('/search', searchResponseSchema, {
    // Never cached: availability is the entire point of the query.
    revalidate: false,
    searchParams: { ...params },
  });
}

/**
 * A CACHED search, for the teaser block on a city page only.
 *
 * §5.4 shows "available stays in this city" as marketing content beneath the city
 * photography — it is a taste of the inventory, not a bookable quote. Caching it
 * for five minutes is what lets the city page stay statically rendered, which §5.4
 * needs for SEO; an uncached fetch forces the page dynamic and Next rejects the
 * mix outright.
 *
 * The trade-off is explicit: a stay that was booked in the last few minutes may
 * still appear here. That is acceptable because the customer's next step —
 * /search or the property page — queries live availability, and the booking
 * endpoint re-validates against the exclusion constraint regardless. Never use
 * this function anywhere in the booking path.
 */
export async function searchForDisplay(params: SearchParams, revalidateSeconds = 300) {
  return apiFetch('/search', searchResponseSchema, {
    revalidate: revalidateSeconds,
    searchParams: { ...params },
  });
}

/**
 * A search that renders a page rather than throwing.
 *
 * A closed same-day cutoff comes back as a 400 with `firstBookableDate` — that is
 * a normal, expected outcome (§5.3) that the page must explain, not an error.
 */
export interface SearchOutcome {
  items: SearchResultItem[];
  nextCursor: string | null;
  previousCursor: string | null;
  firstBookableDate: string | null;
  notice: { reason: string; firstBookableDate: string } | null;
  failed: boolean;
}

export async function searchSafely(
  params: SearchParams,
  options: { cached?: boolean } = {},
): Promise<SearchOutcome> {
  try {
    const result = options.cached ? await searchForDisplay(params) : await search(params);
    return { ...result, notice: null, failed: false };
  } catch (error) {
    if (error instanceof ApiError && error.status === 400) {
      const body = error.body;

      if (
        typeof body === 'object' &&
        body !== null &&
        'firstBookableDate' in body &&
        'reason' in body
      ) {
        return {
          items: [],
          nextCursor: null,
          previousCursor: null,
          firstBookableDate: String(
            (body as { firstBookableDate: unknown }).firstBookableDate,
          ),
          notice: {
            reason: String((body as { reason: unknown }).reason),
            firstBookableDate: String(
              (body as { firstBookableDate: unknown }).firstBookableDate,
            ),
          },
          failed: false,
        };
      }
    }

    return {
      items: [],
      nextCursor: null,
      previousCursor: null,
      firstBookableDate: null,
      notice: null,
      failed: true,
    };
  }
}

// ─── Partner advertising (§9.3) ──────────────────────────────────────────────

const deliveredAdSchema = z.object({
  reference: z.string(),
  headline: z.string(),
  /* Null for a campaign whose operator wrote none — the card then draws nothing. */
  description: z.string().nullable(),
  advertiser: z.string(),
  kind: z.string(),
  /** The CLICK path on SAFRA — never the advertiser's own URL. See `AdDeliveryService`. */
  clickPath: z.string(),
  /*
    A resolvable URL on the media host, or null for a text ad.

    `.nullable()` rather than `.default(null)`: a default would invent «this ad has no picture» for
    a field the API stopped sending, which is the shape «a zod .default() hides a missing field»
    exists to forbid. Only ever set once the render has FINISHED — see the delivery service.
  */
  imageUrl: z.string().nullable(),
});

const deliveredAdsSchema = z.object({ items: z.array(deliveredAdSchema) });

export type DeliveredAdItem = z.infer<typeof deliveredAdSchema>;

/**
 * The live partner ads for one city, in the reader's language.
 *
 * ## Never cached, and never fatal
 *
 * Not cached because the API counts an IMPRESSION from what it actually returned: a cached response
 * would bill an advertiser for one view and serve it a hundred times, and could keep serving a
 * campaign whose window closed minutes ago. `revalidate: false` is the honest setting for a
 * response whose side effect is the measurement.
 *
 * Never fatal because an ad is the least important thing on any page that carries one. A refusal, a
 * timeout or a malformed body all resolve to an empty slate, which renders as nothing at all — the
 * page the customer came for is unaffected.
 */
export async function getCityAds(
  citySlug: string,
  locale: string,
): Promise<DeliveredAdItem[]> {
  try {
    const result = await apiFetch('/ads', deliveredAdsSchema, {
      revalidate: false,
      searchParams: { citySlug, locale },
    });

    return result.items;
  } catch {
    return [];
  }
}
