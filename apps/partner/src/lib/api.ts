import 'server-only';

import { z } from 'zod';

import { getPartnerSession } from './session-server';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

export type ApiResult<T> = T | 'unauthenticated' | 'failed';

/**
 * The partner API client.
 *
 * Nothing here is ever cached: a cached listing is a stale review decision, and a cached booking
 * list is one partner's guests served to another the moment this runs behind a shared cache.
 * `cache: 'no-store'` is not an option callers can change.
 *
 * The access token is attached server-side from the HttpOnly cookie, which is the whole reason
 * this exists rather than the browser calling the API directly: no token ever reaches client
 * JavaScript.
 */
export async function partnerFetch<T>(
  path: string,
  schema: z.ZodType<T>,
  init: { method?: string; body?: unknown } = {},
): Promise<ApiResult<T>> {
  const session = await getPartnerSession();
  if (!session) return 'unauthenticated';

  let response: Response;

  try {
    response = await fetch(`${API_URL}/api/v1${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      cache: 'no-store',
    });
  } catch {
    return 'failed';
  }

  /*
    403 is reported as `unauthenticated` alongside 401, deliberately — the same choice the console
    makes. From a page's point of view they call for the same rendering, and distinguishing them
    would tempt a screen into explaining which permission is missing.
  */
  if (response.status === 401 || response.status === 403) return 'unauthenticated';
  if (!response.ok) return 'failed';

  const parsed = schema.safeParse(await response.json().catch(() => null));

  return parsed.success ? parsed.data : 'failed';
}

/**
 * A listing as `GET /partner/properties` returns it.
 *
 * Parsed rather than cast, and written against the RESPONSE rather than against the columns one
 * would expect. The first version of this asked for `address`, `city` and `units`; `listOwn`
 * selects none of them, so `safeParse` failed on every call and the page rendered "could not load"
 * with nothing in any log — the exact failure the console's client carries a warning about.
 *
 * What is absent is worth naming, because the handoff's §7.2 card wants it: there is no nightly
 * PRICE and no unit count here, so the card cannot show either until `listOwn` returns them.
 */
const propertySchema = z.object({
  reference: z.string(),
  slug: z.string(),
  nameAr: z.string(),
  nameEn: z.string().nullable(),
  status: z.string(),
  rating: z.string().nullable(),
  reviewsCount: z.number(),
  /** The shared trip-trait vocabulary — `TRIP_ATTRIBUTES`, not a list forked for this app. */
  attributes: z.array(z.string()),
  badges: z.array(z.string()),
  city: z.string().nullable(),
  propertyType: z.string().nullable(),
  coverKey: z.string().nullable(),
  coverWidths: z.array(z.number()),
  unitCount: z.number(),
  /** The CHEAPEST unit's nightly rate — the "from" price. See the note on `listOwn`. */
  fromPrice: z.string().nullable(),
  currencyCode: z.string().nullable(),
  createdAt: z.string(),
});

export type PartnerProperty = z.infer<typeof propertySchema>;

export async function getMyProperties() {
  return partnerFetch('/partner/properties', z.array(propertySchema));
}

/** The signed-in partner's own profile — the name §7 heads the sidebar with. */
const profileSchema = z.object({
  reference: z.string(),
  displayName: z.string(),
  legalName: z.string(),
  verification: z.string(),
  score: z.number(),
  tier: z.string(),
  city: z.string().nullable(),
  /* The §7 sidebar badges. Defaulted so an older API still renders the shell. */
  propertyCount: z.number().default(0),
  reviewAverage: z.string().nullable().default(null),
});

export type PartnerProfile = z.infer<typeof profileSchema>;

export async function getMyProfile() {
  return partnerFetch('/partner/me', profileSchema);
}

/**
 * لوحة التحكم, as `GET /partner/dashboard` returns it (design handoff §7.1).
 *
 * Every KPI is `.nullable()` because the API distinguishes "no data" from zero and the screen has
 * to as well — see the note on `PartnerDashboardService`. Parsing them as nullable rather than
 * defaulting to 0 here is what keeps that distinction alive across the wire; a `.default(0)` would
 * quietly turn "this partner has no units" into "this partner sold nothing".
 */
const dashboardSchema = z.object({
  kpis: z.object({
    earnings: z
      .object({
        amount: z.string(),
        currencyCode: z.string().nullable(),
        previousAmount: z.string(),
        changePercent: z.number().nullable(),
      })
      .nullable(),
    bookings: z.object({ active: z.number(), arrivingThisWeek: z.number() }),
    occupancy: z
      .object({
        percent: z.number(),
        bookedNights: z.number(),
        availableNights: z.number(),
      })
      .nullable(),
    response: z.object({ medianMinutes: z.number(), sampleSize: z.number() }).nullable(),
  }),
  pendingRequests: z.array(
    z.object({
      reference: z.string(),
      unitName: z.string(),
      propertyName: z.string(),
      checkIn: z.string(),
      checkOut: z.string(),
      nights: z.number(),
      guests: z.number(),
      amount: z.string(),
      currencyCode: z.string(),
      deadlineAt: z.string().nullable(),
    }),
  ),
  calendar: z
    .object({
      unitName: z.string(),
      defaultPrice: z.string(),
      currencyCode: z.string(),
      days: z.array(
        z.object({
          date: z.string(),
          status: z.string(),
          price: z.string().nullable(),
        }),
      ),
    })
    .nullable(),
  alerts: z.array(
    z.object({
      kind: z.string(),
      fineAmount: z.string().nullable(),
      currencyCode: z.string().nullable(),
      bookingReference: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
  /**
   * A real `partner_payouts` row, or null.
   *
   * Null means the line is ABSENT from the screen — not «$0 مجدول», which would describe a
   * transfer that is not happening. `status` travels with the amount so the page cannot render an
   * accruing balance as a scheduled transfer.
   */
  payout: z
    .object({
      reference: z.string(),
      netAmount: z.string(),
      currencyCode: z.string(),
      status: z.string(),
      scheduledFor: z.string().nullable(),
    })
    .nullable(),
});

export type PartnerDashboard = z.infer<typeof dashboardSchema>;

export async function getDashboard() {
  return partnerFetch('/partner/dashboard', dashboardSchema);
}

/**
 * The partner's own payouts, as `GET /partner/payouts` returns them.
 *
 * Scoped by the API to the `partnerId` in the verified token — this client sends no partner id,
 * because there is no parameter to send one in.
 */
const partnerPayoutSchema = z.object({
  reference: z.string(),
  partnerName: z.string().nullable(),
  currencyCode: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  grossAmount: z.string(),
  fineAmount: z.string(),
  netAmount: z.string(),
  status: z.string(),
  scheduledFor: z.string().nullable(),
  releasedAt: z.string().nullable(),
  paidAt: z.string().nullable(),
  paidReference: z.string().nullable(),
  holdReason: z.string().nullable(),
  bookingCount: z.number(),
});

export type PartnerPayout = z.infer<typeof partnerPayoutSchema>;

export async function getMyPayouts() {
  return partnerFetch('/partner/payouts', z.array(partnerPayoutSchema));
}

/** What one payout covers — the answer to "what is this $1,240 for". */
const payoutBookingSchema = z.object({
  bookingReference: z.string(),
  amount: z.string(),
  checkIn: z.string(),
  checkOut: z.string(),
  property: z.string().nullable(),
});

export type PayoutBooking = z.infer<typeof payoutBookingSchema>;

export async function getMyPayoutBookings(reference: string) {
  return partnerFetch(
    `/partner/payouts/${encodeURIComponent(reference)}/bookings`,
    z.array(payoutBookingSchema),
  );
}

/**
 * تقييمات ضيوفي, as `GET /partner/reviews` returns it (design handoff §7.3).
 *
 * The guest's NAME and nothing else about them. §7.2 forbids showing a partner any customer
 * contact detail, and a review screen is exactly where "so they can follow up" would creep in —
 * so the absence is asserted in `review.integration.test.ts` rather than left to this schema.
 */
const reviewSchema = z.object({
  reference: z.string(),
  guestName: z.string(),
  propertyName: z.string().nullable(),
  unitName: z.string().nullable(),
  rating: z.number(),
  body: z.string(),
  status: z.string(),
  partnerReply: z.string().nullable(),
  partnerRepliedAt: z.string().nullable(),
  reportStatus: z.string(),
  reportReason: z.string().nullable(),
  moderationNote: z.string().nullable(),
  createdAt: z.string(),
});

export type PartnerReview = z.infer<typeof reviewSchema>;

const reviewPageSchema = z.object({
  items: z.array(reviewSchema),
  total: z.number(),
  capped: z.boolean(),
  page: z.number(),
  pages: z.number(),
  /*
    No `limit`. `offsetPage` does not return it — written against the real response rather than
    against the fields one would expect, which is the trap that kept the console's listing queue
    permanently empty: `safeParse` fails, `partnerFetch` returns 'failed', and the page says
    "could not load" with nothing in any log.
  */
  summary: z.object({
    /** Null when the partner has no published reviews — the header then says so. */
    average: z.string().nullable(),
    published: z.number(),
  }),
});

export async function getMyReviews(params: { page: number; limit: number }) {
  const search = new URLSearchParams({
    page: String(params.page),
    limit: String(params.limit),
  });

  return partnerFetch(`/partner/reviews?${search.toString()}`, reviewPageSchema);
}

/**
 * The §7 sidebar badges, from the profile every page already fetches.
 *
 * Both are absent rather than zero when there is nothing to say: a partner with no published
 * reviews gets no ★ badge, because «★ 0» reads as a verdict rather than as an absence.
 */
export function sidebarBadges(profile: PartnerProfile | 'failed' | 'unauthenticated'): {
  properties?: string;
  reviews?: string;
} {
  if (profile === 'failed' || profile === 'unauthenticated') return {};

  return {
    ...(profile.propertyCount > 0 ? { properties: String(profile.propertyCount) } : {}),
    ...(profile.reviewAverage ? { reviews: `\u2605 ${profile.reviewAverage}` } : {}),
  };
}

/** The reference data the §7.2 add form's selects need. All public catalogue reads. */
const referenceSchema = z.object({
  cities: z.array(z.object({ slug: z.string(), nameAr: z.string() })),
  propertyTypes: z.array(z.object({ code: z.string(), nameAr: z.string() })),
  policies: z.array(z.object({ code: z.string(), nameAr: z.string() })),
});

export type PropertyFormReference = z.infer<typeof referenceSchema>;

/**
 * Cities, property types and cancellation policies, for the add form.
 *
 * Three PUBLIC endpoints, so this deliberately does not go through `partnerFetch` — attaching a
 * partner's access token to a catalogue read would be the only place in this app where a token
 * leaves for a request that does not need one.
 */
export async function getPropertyFormReference(): Promise<
  PropertyFormReference | 'failed'
> {
  try {
    const read = async (path: string): Promise<unknown> => {
      const response = await fetch(`${API_URL}/api/v1${path}`, { cache: 'no-store' });

      return response.json();
    };

    const [cities, types, policies] = await Promise.all([
      read('/cities'),
      read('/property-types'),
      read('/cancellation-policies'),
    ]);

    /*
      `.safeParse` over each list rather than a cast. These are three separate endpoints and the
      form's selects are only as good as their contents — a shape change in any of them should
      empty the form loudly rather than render options with undefined values.
    */
    const parsed = referenceSchema.safeParse({
      cities: Array.isArray(cities) ? cities : [],
      propertyTypes: Array.isArray(types) ? types : [],
      policies: Array.isArray(policies) ? policies : [],
    });

    return parsed.success ? parsed.data : 'failed';
  } catch {
    return 'failed';
  }
}
