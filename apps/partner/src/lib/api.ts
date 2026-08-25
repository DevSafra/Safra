import 'server-only';

import { cache } from 'react';
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

    ONE 403 will be different once it is wired: `ERROR.PARTNER_SUSPENDED` is not a missing
    permission but a state the reader can see the reason for on the same screen, so it becomes its
    own `ApiResult` variant. That widening makes the compiler enumerate all 18 call sites that must
    then handle it — which is the point of doing it that way, and why it is its own change rather
    than a line smuggled in beside others.
  */
  if (response.status === 401 || response.status === 403) return 'unauthenticated';

  /*
    404 is folded into `failed`, deliberately.

    Every caller asks for something it already has a handle on — a property it listed, a contract it
    linked to — so "not there" and "the request broke" call for the same rendering, and a fourth
    variant would have made 18 call sites handle a case none of them can reach. §6.5's search does
    not need one either: a search that finds nothing answers 200 with an empty list.
  */
  if (response.status === 404) return 'failed';
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
  /** «رقم الغرفة/الوحدة». Null on every listing created before 2026-08-19, and on any villa. */
  roomNumber: z.string().nullable(),
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
  /**
   * The hold on this account, or `null` when there is none.
   *
   * `reason` is the PARTNER-facing sentence and is always present when suspended. The record also
   * carries staff-only `notes`, and those are deliberately absent from this payload — the one field
   * in a suspension with a different audience. Not parsing them here means a future API that
   * leaked them could not reach a screen through this schema.
   *
   * Defaulted to `null` so an API that predates suspension still renders the portal rather than
   * failing the whole profile parse on a missing key.
   */
  /*
    NULLABLE, not defaulted — and the `.default(null)` that was here is the whole story.

    `GET /partner/me` did not select `suspended_at` or `suspended_reason`, so it never sent this
    object at all. The default turned that silence into "not suspended", every page parsed cleanly,
    and `Shell` — which renders the suspension notice from exactly this field — had nothing to
    render. The notice could not appear on any screen for any suspended partner, and المحفظة's
    «التحويلات موقوفة» line, computed from the same field, was equally unreachable.

    The comment that justified the default said it let an API predating suspension still render the
    portal. It did. It also made the entire partner-facing half of the policy inert while every
    test, type check and page load stayed green — which is why `O-staff-4` could record it as
    "compile-verified" in good faith.

    Required-but-nullable now: the key must be present. An API that stops sending it fails the parse
    where the mistake is, instead of quietly telling a suspended business that nothing is wrong.
  */
  suspension: z.object({ reason: z.string(), since: z.string() }).nullable(),
});

export type PartnerProfile = z.infer<typeof profileSchema>;

/**
 * Deduplicated per request, so the SHELL can read it without costing a second fetch.
 *
 * Every page already loads the profile through `requireVerifiedPartner()` and hands the shell a
 * name and badges. The suspension notice cannot be a prop on that list: it has to appear on every
 * screen, and a prop is the thing the ninth page forgets — the shell's own docblock makes that
 * argument about the employee permission and it applies here with more at stake, because the page
 * that forgets is the one where a suspended partner is left guessing.
 *
 * `cache()` is React's per-request memo, so the shell's call and the page's call are one request.
 */
export const getMyProfile = cache(async () => partnerFetch('/partner/me', profileSchema));

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
  /* The whole portfolio's month, aggregated per day — not one unit's. */
  calendar: z
    .object({
      unitCount: z.number(),
      propertyCount: z.number(),
      fromPrice: z.string(),
      currencyCode: z.string(),
      days: z.array(
        z.object({
          date: z.string(),
          booked: z.number(),
          blocked: z.number(),
          available: z.number(),
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
   * The open-violation count and the furthest rung any of them reached.
   *
   * Not `.optional()` and not defaulted — the lesson from `violationSchema` two hundred lines down,
   * where three defaulted fields the API never sent made every violation read as merely recorded
   * for as long as nobody looked. If the endpoint stops sending this, the dashboard should fail
   * where the mistake is rather than quietly report zero violations to somebody who has four.
   */
  violations: z.object({
    open: z.number(),
    furthestStage: z.enum(['recorded', 'warned', 'fined', 'suspension']).nullable(),
  }),
  /**
   * What the platform has TOLD this partner — the in-app half of every enforcement notice.
   *
   * `templateKey` is a string rather than an enum on purpose. An API that starts sending a sixth
   * notice must not break this page: the panel prints the raw key for one it does not recognise,
   * which is visibly wrong and therefore gets fixed, where an enum would refuse the whole payload
   * and take the dashboard down over a notice nobody had translated yet.
   */
  notices: z.array(z.object({ templateKey: z.string(), at: z.string() })),
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

/** One photograph, as `GET /partner/properties/:reference/images` returns it. */
const propertyImageSchema = z.object({
  id: z.string(),
  fileKey: z.string(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  variantWidths: z.array(z.number()),
  isCover: z.boolean(),
  sortOrder: z.number(),
  /*
    Where the photograph is in the pipeline. `catch` rather than a bare enum: an API that gained a
    fourth state must not blank this screen, and treating an unknown one as ready is the behaviour
    the manager had before the column existed.
  */
  status: z.enum(['processing', 'ready', 'failed']).catch('ready'),
  /** An ERROR code when it failed, resolved against the catalogue — never a sentence. */
  failureCode: z.string().nullable().default(null),
  alt: z.object({
    ar: z.string().nullable(),
    en: z.string().nullable(),
    de: z.string().nullable(),
  }),
  urls: z.object({ thumbnail: z.string(), medium: z.string(), large: z.string() }),
});

export type PropertyImage = z.infer<typeof propertyImageSchema>;

/**
 * ONE listing, with everything تعديل prefills from and التقويم chooses a unit by.
 *
 * Every field the form writes is `.nullable()` rather than optional where the column is nullable:
 * a schema that made an absent description optional would parse a response that lost it, and the
 * form would render an empty textarea over copy that still exists. Nullable says "the API sent
 * nothing here" and optional says "the API may not have sent this at all" — only the first is true.
 */
const partnerPropertySchema = z.object({
  reference: z.string(),
  slug: z.string(),
  status: z.string(),
  name: z.object({
    ar: z.string(),
    en: z.string().nullable(),
    de: z.string().nullable(),
  }),
  description: z.object({
    ar: z.string().nullable(),
    en: z.string().nullable(),
    de: z.string().nullable(),
  }),
  address: z.string(),
  /** «رقم الغرفة/الوحدة». Null where the partner had nothing to put. */
  roomNumber: z.string().nullable(),
  latitude: z.string().nullable(),
  longitude: z.string().nullable(),
  attributes: z.array(z.string()),
  citySlug: z.string(),
  cityNameAr: z.string(),
  propertyTypeCode: z.string(),
  cancellationPolicyCode: z.string(),
  reviewNotes: z.string().nullable(),
  isStructurallyEditable: z.boolean(),
  units: z.array(
    z.object({
      id: z.string(),
      nameAr: z.string(),
      unitLabel: z.string().nullable(),
      maxGuests: z.number(),
      bedrooms: z.number(),
      beds: z.number(),
      bathrooms: z.number(),
      basePrice: z.string(),
      currencyCode: z.string(),
      minNights: z.number(),
      maxNights: z.number().nullable(),
      isActive: z.boolean(),
    }),
  ),
});

export type PartnerPropertyDetail = z.infer<typeof partnerPropertySchema>;

export async function getProperty(reference: string) {
  return partnerFetch(
    `/partner/properties/${encodeURIComponent(reference)}`,
    partnerPropertySchema,
  );
}

/** One unit's month. The API derives every day, so a quiet month still returns its squares. */
const calendarDaySchema = z.object({
  date: z.string(),
  status: z.string(),
  price: z.string(),
  isPriceOverridden: z.boolean(),
  minNights: z.number(),
  note: z.string().nullable(),
});

export type UnitCalendarDay = z.infer<typeof calendarDaySchema>;

/*
  The API answers `{ unitId, days }`, not a bare array — the envelope is what a mismatched schema
  costs: `safeParse` fails, `partnerFetch` returns 'failed', and the screen says it could not reach
  the server while the request sat in the log as a 200. Parsing the real shape is the only way that
  discrepancy is ever visible.
*/
const unitCalendarSchema = z.object({
  unitId: z.string(),
  days: z.array(calendarDaySchema),
});

export async function getUnitCalendar(unitId: string, from: string, to: string) {
  return partnerFetch(
    `/partner/units/${encodeURIComponent(unitId)}/calendar?from=${from}&to=${to}`,
    unitCalendarSchema,
  );
}

/**
 * The whole portfolio's month, grouped by property — التقويمات.
 *
 * One request for every room rather than one per room: the API expands the month for a page of
 * properties in two queries, so this screen costs the same whether the partner owns two units or
 * twenty. Parsing the real envelope for the reason recorded above.
 */
const portfolioCalendarUnitSchema = z.object({
  unitId: z.string(),
  nameAr: z.string(),
  /** «رقم الوحدة» — the physical identifier used at check-in. Null where none was given. */
  unitLabel: z.string().nullable(),
  basePrice: z.string(),
  currencyCode: z.string(),
  minNights: z.number(),
  isActive: z.boolean(),
  days: z.array(calendarDaySchema),
});

export type PortfolioCalendarUnit = z.infer<typeof portfolioCalendarUnitSchema>;

const portfolioCalendarSchema = z.object({
  month: z.string(),
  properties: z.array(
    z.object({
      reference: z.string(),
      nameAr: z.string(),
      units: z.array(portfolioCalendarUnitSchema),
    }),
  ),
  nextCursor: z.string().nullable(),
});

export type PortfolioCalendar = z.infer<typeof portfolioCalendarSchema>;

/**
 * @param expand Which عقار's month to fetch. Every property is LISTED whatever this is; only the
 *   named one has its days expanded, because days are the expensive part — a property times its
 *   units times every day of the month.
 *
 * That is what removed the ceiling. التقويمات has no «عرض عقارات أخرى» (Bashar, 2026-08-19), and a
 * page that expanded everything had to stop at ten, which put a partner's eleventh property out of
 * reach with no control to get there. Expanding one keeps the cost flat however large the
 * portfolio, so the list can hold all of it.
 */
export async function getPortfolioCalendar(month: string, expand?: string) {
  const query = new URLSearchParams({ month });

  if (expand) query.set('expand', expand);

  return partnerFetch(`/partner/calendars?${query.toString()}`, portfolioCalendarSchema);
}

export async function getPropertyImages(reference: string) {
  return partnerFetch(
    `/partner/properties/${encodeURIComponent(reference)}/images`,
    z.array(propertyImageSchema),
  );
}

// ─── العقود والمستندات (Bashar, 2026-08-19) ──────────────────────────────────

/**
 * A contract as its partner may see it.
 *
 * No `fileKey` and no `uploadedBy`. The storage key is an internal address and the staff member
 * who filed it is SAFRA's business, not the partner's — a schema that accepted either would make a
 * leak upstream invisible here rather than loud.
 */
/**
 * One entry in a contract's version history: which side sent a copy, when, and whether it stands.
 *
 * Deliberately three fields. The API has the uploader, their IP and the file hash next to these in
 * the same row and sends none of them — see `PartnerContractReadService.list`.
 */
const contractHistorySchema = z.object({
  party: z.string(),
  at: z.string(),
  superseded: z.boolean(),
});

const partnerContractSchema = z.object({
  id: z.string(),
  kind: z.string(),
  status: z.string(),
  fileName: z.string(),
  sizeBytes: z.number(),
  uploadedAt: z.string(),
  signedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  /* Defaulted, so a server that has not been redeployed yet renders a card without a history
     rather than failing the whole list to a «تعذّر» screen. */
  history: z.array(contractHistorySchema).default([]),
});

export type PartnerContractEvent = z.infer<typeof contractHistorySchema>;

export type PartnerContract = z.infer<typeof partnerContractSchema>;

export async function getMyContracts() {
  return partnerFetch(
    '/partner/contracts',
    z.object({ contracts: z.array(partnerContractSchema) }),
  );
}

const partnerDocumentSchema = z.object({
  id: z.string(),
  kind: z.string(),
  status: z.string(),
  fileName: z.string(),
  reviewNotes: z.string().nullable(),
  createdAt: z.string(),
});

export type PartnerDocument = z.infer<typeof partnerDocumentSchema>;

export async function getMyDocuments() {
  return partnerFetch(
    '/partner/documents',
    z.object({ documents: z.array(partnerDocumentSchema) }),
  );
}

// ─── الدعم (Bashar, 2026-08-12) ───────────────────────────────────────────────

/**
 * A support thread as its partner may see it.
 *
 * No `internal` field, and there must never be one: staff write to each other inside the same thread and
 * the API filters those out. A schema that accepted the flag would make a leak upstream invisible here
 * rather than loud.
 */
const supportMessageSchema = z.object({
  id: z.string(),
  sender: z.enum(['customer', 'partner', 'staff', 'system']),
  body: z.string(),
  redactedCount: z.number(),
  createdAt: z.string(),
});

const supportTicketSchema = z.object({
  reference: z.string(),
  openedAt: z.string(),
  lastMessageAt: z.string().nullable(),
  closed: z.boolean(),
  messageCount: z.number(),
  lastMessage: z.string().nullable(),
});

export type PartnerSupportTicket = z.infer<typeof supportTicketSchema>;

const supportThreadSchema = supportTicketSchema.extend({
  messages: z.array(supportMessageSchema),
});

export type PartnerSupportThread = z.infer<typeof supportThreadSchema>;

export async function getMySupportTickets() {
  return partnerFetch(
    '/support?limit=20',
    z.object({
      items: z.array(supportTicketSchema),
      nextCursor: z.string().nullable(),
    }),
  );
}

/**
 * One thread.
 *
 * A reference that is not this partner's answers 404, indistinguishably from one that does not exist —
 * `CNV-` references are sequential, so any difference would let one partner count another's requests.
 */
export async function getSupportThread(reference: string) {
  return partnerFetch(`/support/${encodeURIComponent(reference)}`, supportThreadSchema);
}

/**
 * الموظفون — this partner's own staff.
 *
 * ## Two facts, not one
 *
 * `activated` says the person has redeemed their invitation and can sign in; `invitationPending`
 * says a live link is still outstanding. They are separate because they answer different
 * questions, and a screen that showed only one lies in a way this project has already paid for:
 * the in-person onboarding flow reported five green steps while the person could not sign in at
 * all. An invitation that has EXPIRED unredeemed is `activated: false, invitationPending: false` —
 * the state that needs a resend, and the state a single "invited?" flag cannot express.
 */
const employeeSchema = z.object({
  id: z.string(),
  fullName: z.string(),
  email: z.string(),
  roleId: z.string(),
  roleName: z.string(),
  permissions: z.array(z.string()),
  status: z.string(),
  activated: z.boolean(),
  invitationPending: z.boolean(),
  createdAt: z.string(),
});

export type PartnerEmployee = z.infer<typeof employeeSchema>;

const employeePageSchema = z.object({
  items: z.array(employeeSchema),
  nextCursor: z.string().nullable(),
});

export type PartnerEmployeePage = z.infer<typeof employeePageSchema>;

/**
 * One page of the team, newest first.
 *
 * Cursor-paged rather than showing everyone: a partner's headcount is bounded by THEIR business,
 * not by SAFRA's roadmap, so the "it stays small" assumption the geography screens rely on is a
 * guess about a stranger's organisation. A hotel group with three hundred staff is an ordinary
 * customer. See `pagination.ts` for why customer-facing lists keep the cursor.
 */
export async function getMyEmployees(cursor?: string) {
  const query = new URLSearchParams({ limit: '20' });

  if (cursor) query.set('cursor', cursor);

  return partnerFetch(`/partner/employees?${query.toString()}`, employeePageSchema);
}

/**
 * THIS partner's own roles, for the invite form's picker.
 *
 * Roles belong to the partner who defined them (Bashar, 2026-08-23) — a super admin has nothing to
 * do with them. The endpoint scopes to the partner id on the token, so the picker cannot offer
 * another business's role and `invite` refuses one it is handed anyway.
 *
 * A separate read rather than a field on the profile because the profile answers about the
 * BUSINESS and every screen fetches it; a list that only two screens need does not belong on the
 * call every page makes.
 */
const employeeRoleSchema = z.object({
  id: z.string(),
  name: z.string(),
  permissions: z.array(z.string()),
});

export type PartnerEmployeeRole = z.infer<typeof employeeRoleSchema>;

export async function getEmployeeRoles() {
  return partnerFetch(
    '/partner/employees/roles',
    z.object({ roles: z.array(employeeRoleSchema) }),
  );
}

/**
 * أدوار الموظفين — the roles this partner has defined, with how many people hold each.
 *
 * `employeeCount` rides on the row so the screen can refuse a delete BEFORE offering the button.
 * The API refuses it too (`employee_role.in_use`), and that is the boundary; this is so an operator
 * learns the constraint from the screen rather than from a failure.
 */
const employeeRoleDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  permissions: z.array(z.string()),
  employeeCount: z.number(),
  createdAt: z.string(),
});

export type PartnerEmployeeRoleDetail = z.infer<typeof employeeRoleDetailSchema>;

/**
 * Not paged, and that is the one documented exception's reasoning rather than an oversight.
 *
 * Unlike the EMPLOYEE list — where a headcount is bounded by a stranger's business and a bounds
 * test would fire after their screen broke — a role is a category of person, not a person. A
 * business has a handful, the screen exists to show the COMPLETE set so somebody can see what
 * already exists before naming another, and a pager over four rows is worse than four rows.
 */
export async function getMyEmployeeRoles() {
  return partnerFetch(
    '/partner/employee-roles',
    z.object({ roles: z.array(employeeRoleDetailSchema) }),
  );
}

/**
 * The capabilities a role may carry, SERVED rather than imported.
 *
 * `PARTNER_EMPLOYEE_PERMISSIONS` is the bound the API validates against, and the screen builds its
 * checkboxes from the same source rather than from a copy — a form offering a capability the API
 * rejects is a form that produces a refusal nobody can act on.
 */
export async function getAssignableCapabilities() {
  return partnerFetch(
    '/partner/employee-roles/assignable',
    z.object({ permissions: z.array(z.string()) }),
  );
}

/**
 * الوصول اليوم — the confirmed bookings whose date has come, plus today's check-ins.
 *
 * No money on the row, and that is the endpoint's decision rather than this client's: a rate here
 * would hand the business's earnings to whoever works the desk, and `booking.check_in` does not
 * carry `payout.read_own`.
 */
const arrivalSchema = z.object({
  reference: z.string(),
  guestName: z.string(),
  propertyName: z.string(),
  unitName: z.string(),
  checkIn: z.string(),
  checkOut: z.string(),
  nights: z.number(),
  guests: z.number(),
  status: z.string(),
  checkedInAt: z.string().nullable(),
});

export type PartnerArrival = z.infer<typeof arrivalSchema>;

export async function getMyArrivals(cursor?: string) {
  const query = new URLSearchParams({ limit: '20' });

  if (cursor) query.set('cursor', cursor);

  return partnerFetch(
    `/partner/arrivals?${query.toString()}`,
    z.object({ items: z.array(arrivalSchema), nextCursor: z.string().nullable() }),
  );
}

/**
 * §6.5's search: a booking reference OR a guest's name.
 *
 * A LIST, because a name is not unique — two guests called محمد at the same property is the
 * ordinary case, and returning the first would check in the wrong one.
 */
export async function searchArrivals(term: string) {
  return partnerFetch(
    `/partner/arrivals/search?q=${encodeURIComponent(term)}`,
    z.array(arrivalSchema),
  );
}

/**
 * المخالفات — what SAFRA has charged, read-only.
 *
 * `moneyHidden` says the three amounts were withheld rather than absent, and the screen must render
 * that as a STATEMENT. A «—» in a money column claims the fine was zero, which is a different fact
 * from "you may not see it" and the opposite of the truth.
 */
const violationSchema = z.object({
  id: z.string(),
  kind: z.string(),
  occurrenceNumber: z.number(),
  bookingReference: z.string().nullable(),
  /*
    `score_penalty` is in the API's payload and is deliberately NOT read here.

    This screen used to render it as «خصم {n} من التقييم» — "{n} deducted from your rating" — and
    that sentence was false in both directions. Nothing ever applied `score_penalty` to anything;
    the deduction a violation really caused went through `partners.score`, a column the partner
    never saw. So the portal named a number with no effect and hid the one with an effect.

    Since 2026-08-24 there is no deduction at all to describe (Bashar): "creating a violation must
    not automatically modify ranking", and `score - 2` / `score - 5` are gone from the two services
    that wrote them. `score_penalty` now records only the severity the platform assigned, applied
    to nothing.

    Left out of the schema rather than parsed and ignored, so re-displaying it takes a deliberate
    edit here and a read of this comment first.
  */
  fineAmount: z.string().nullable(),
  fineCurrency: z.string().nullable(),
  customerCompensationAmount: z.string().nullable(),
  waived: z.boolean(),
  waivedReason: z.string().nullable(),
  /**
   * The formal ladder: recorded → warned → fined → suspension, forward only.
   *
   * ## No `.default()`, and that is the fix
   *
   * These three carried `.default('recorded')`, `.default(null)` and `.default(null)` — and the API
   * did not select any of them. Nothing failed: every violation a partner read reported «سُجّلت»
   * whatever had really happened to it, and the warning somebody wrote FOR them reached nobody. A
   * default turned a missing field into a plausible one, which is the quietest way for a screen to
   * lie. Required-but-nullable now: the API must send the key, and if it stops the parse fails
   * loudly instead of inventing a stage.
   */
  stage: z.enum(['recorded', 'warned', 'fined', 'suspension']),
  warnedAt: z.string().nullable(),
  /** What the partner was TOLD. Null until somebody actually warned them. */
  warningNote: z.string().nullable(),
  /**
   * WHAT HAPPENED, and why the fine — the two sentences written for this reader.
   *
   * Both were required by the console's forms, labelled «الوصف (يقرأه الشريك)», audited, and never
   * stored — so this screen showed a kind, a stage, a number and a figure, and no words. Null on
   * rows filed before 2026-08-24; `fineReason` is also null for a reader without `payout.read_own`,
   * because a sentence explaining a fine is about the fine and follows the figures' own rule.
   */
  description: z.string().nullable(),
  fineReason: z.string().nullable(),
  /**
   * The forgiveness, when there is one — and it carries its own MONEY.
   *
   * `amount` obeys the same `moneyHidden` rule as `fineAmount`: an employee without
   * `payout.read_own` gets the waiver's existence, its date and its reason, and `null` for the
   * figures. The rule was never about which column the money came from.
   */
  waiver: z
    .object({
      at: z.string(),
      reason: z.string(),
      amount: z.string().nullable(),
      currency: z.string().nullable(),
    })
    .nullable()
    .default(null),
  collectedAt: z.string().nullable(),
  createdAt: z.string(),
});

export type PartnerViolation = z.infer<typeof violationSchema>;

export async function getMyViolations(cursor?: string) {
  const query = new URLSearchParams({ limit: '20' });

  if (cursor) query.set('cursor', cursor);

  return partnerFetch(
    `/partner/violations?${query.toString()}`,
    z.object({
      items: z.array(violationSchema),
      nextCursor: z.string().nullable(),
      moneyHidden: z.boolean(),
    }),
  );
}

/**
 * ONE violation, for the detail screen (Bashar, 2026-08-24).
 *
 * Sends no partner id — the API scopes the row to the partnerId in the verified token, in its WHERE
 * clause, so another business's violation answers as one that does not exist. There is no parameter
 * here to pass one, which is the point.
 *
 * The SAME `violationSchema` the list parses. A second, looser schema for the detail screen is how
 * one of the two comes to render a field the other hides — the money rule in particular is applied
 * by the API for both, and a detail-only schema would be the place to forget it.
 */
export async function getMyViolation(id: string) {
  return partnerFetch(
    `/partner/violations/${encodeURIComponent(id)}`,
    z.object({ violation: violationSchema, moneyHidden: z.boolean() }),
  );
}
