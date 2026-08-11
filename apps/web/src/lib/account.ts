import 'server-only';

import { z } from 'zod';

import { getSession } from './session-server';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

/**
 * The customer's own data, fetched with their access token.
 *
 * Separate from `lib/api.ts` because everything there is anonymous and cacheable —
 * cities, search, property pages. Nothing here may EVER be cached: a booking list
 * cached across requests is one customer's bookings shown to the next, which is the
 * worst bug this app could ship. Hence `cache: 'no-store'` on every call, without an
 * option to change it.
 */
async function authedFetch<T>(
  path: string,
  schema: z.ZodType<T>,
): Promise<T | 'unauthenticated' | 'failed'> {
  const session = await getSession();
  if (!session) return 'unauthenticated';

  let response: Response;

  try {
    response = await fetch(`${API_URL}/api/v1${path}`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
      },
      cache: 'no-store',
    });
  } catch {
    return 'failed';
  }

  /**
   * A 401 here means the token expired between middleware's check and this fetch,
   * or was revoked mid-request. Reported as unauthenticated so the page renders a
   * sign-in prompt rather than an error — the customer's next navigation passes
   * through middleware and refreshes.
   */
  if (response.status === 401 || response.status === 403) return 'unauthenticated';

  if (!response.ok) return 'failed';

  const parsed = schema.safeParse(await response.json().catch(() => null));

  return parsed.success ? parsed.data : 'failed';
}

// ─── Bookings ────────────────────────────────────────────────────────────────

const bookingSchema = z.object({
  reference: z.string(),
  status: z.string(),
  checkIn: z.string(),
  checkOut: z.string(),
  nights: z.number(),
  guestsAdults: z.number(),
  totalAmount: z.string(),
  createdAt: z.union([z.string(), z.date()]).transform((v) => new Date(v).toISOString()),
});

export type CustomerBooking = z.infer<typeof bookingSchema>;

const bookingsSchema = z.object({
  items: z.array(bookingSchema),
  nextCursor: z.string().nullable(),
});

/**
 * The customer's bookings, one page at a time.
 *
 * `cursor` is why this takes an argument at all. It used to be a bare `?limit=20`, and the
 * `nextCursor` the API returns was parsed and then thrown away — so a customer with twenty-one
 * bookings could not reach the twenty-first by any means. `limit` stays a constant here rather than a
 * parameter: the page size is this screen's decision, not the caller's.
 */
export async function getMyBookings(cursor?: string) {
  const query = new URLSearchParams({ limit: '20' });

  if (cursor) query.set('cursor', cursor);

  return authedFetch(`/bookings?${query.toString()}`, bookingsSchema);
}

// ─── Wallet ──────────────────────────────────────────────────────────────────

const walletSchema = z.object({
  wallet: z.object({ balance: z.string(), currencyCode: z.string() }).nullable(),
});

export type WalletBalance = z.infer<typeof walletSchema>['wallet'];

export async function getMyWallet() {
  return authedFetch('/wallet', walletSchema);
}

const walletTransactionSchema = z.object({
  id: z.string(),
  direction: z.enum(['credit', 'debit']),
  reason: z.string(),
  amount: z.string(),
  balanceAfter: z.string(),
  bookingReference: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
});

export type WalletTransaction = z.infer<typeof walletTransactionSchema>;

const walletTransactionsSchema = z.object({
  items: z.array(walletTransactionSchema),
  nextCursor: z.string().nullable(),
});

/**
 * The wallet statement, one page at a time — and paged for the same reason as the bookings above.
 *
 * `limit` differs per caller here, unlike bookings: the overview shows a handful as a preview while
 * محفظتي shows a full page of them, and those are genuinely different questions.
 */
export async function getMyWalletTransactions(limit = 10, cursor?: string) {
  const query = new URLSearchParams({ limit: String(limit) });

  if (cursor) query.set('cursor', cursor);

  return authedFetch(
    `/wallet/transactions?${query.toString()}`,
    walletTransactionsSchema,
  );
}

// ─── Reviews (§7.3, P-006) ───────────────────────────────────────────────────

/**
 * A name in all three languages, for `localisedName` to pick from.
 *
 * The API used to pre-pick with `coalesce(name_ar, name_en)`, which answered Arabic to every reader —
 * so «شقق قصر الشرق المخدومة» appeared in the middle of the English and German account pages. Only the
 * client knows which language the reader actually chose, because that is their URL locale and it may
 * differ from the preference stored on their account.
 *
 * `nameAr` is not nullable: it is `NOT NULL` in the database and reached through an inner join, and
 * it is the fallback every other locale relies on.
 */
const translatedNameSchema = z.object({
  nameAr: z.string(),
  nameEn: z.string().nullable(),
  nameDe: z.string().nullable(),
});

const pendingReviewSchema = z.object({
  bookingReference: z.string(),
  property: translatedNameSchema,
  unit: translatedNameSchema,
  checkIn: z.string(),
  checkOut: z.string(),
});

export type PendingReview = z.infer<typeof pendingReviewSchema>;

/** The stays this customer may still write about — the account page's prompt. */
export async function getPendingReviews() {
  return authedFetch('/reviews/pending', z.array(pendingReviewSchema));
}

/**
 * Whether this customer may review one booking, and what they wrote if they did.
 *
 * The API answers 404 for a booking that is not theirs, indistinguishably from one that does not
 * exist — so this returns 'failed' in both cases and the page renders not-found. That is
 * deliberate: a different answer would let a reference be probed for existence, and references are
 * sequential (§13.2).
 */
const reviewEligibilitySchema = z.object({
  property: translatedNameSchema,
  unit: translatedNameSchema,
  stayCompleted: z.boolean(),
  alreadyReviewed: z.boolean(),
  eligible: z.boolean(),
  review: z
    .object({
      reference: z.string(),
      rating: z.number(),
      body: z.string(),
      status: z.string(),
      partnerReply: z.string().nullable(),
      createdAt: z.string(),
    })
    .nullable(),
});

export type ReviewEligibility = z.infer<typeof reviewEligibilitySchema>;

export async function getReviewForBooking(reference: string) {
  return authedFetch(
    `/reviews/booking/${encodeURIComponent(reference)}`,
    reviewEligibilitySchema,
  );
}

// ─── Account summary (handoff §6: the greeting and the sidebar badges) ────────

const accountSummarySchema = z.object({
  reference: z.string(),
  fullName: z.string(),
  email: z.string(),
  phone: z.string(),
  preferredLocale: z.string(),
  counters: z.object({
    bookings: z.number(),
    pendingReviews: z.number(),
    walletBalance: z.string().nullable(),
    walletCurrency: z.string().nullable(),
  }),
});

export type AccountSummary = z.infer<typeof accountSummarySchema>;

/**
 * The reader's own profile and the three counters §6 puts on the sidebar.
 *
 * ONE read per account page, which is the point: the sidebar is on every section, and three separate
 * counter reads per navigation is the cost the console refused. It also carries the name, which no
 * session claim holds — the greeting «أهلاً رامي» and الملف الشخصي both had nothing to show without it.
 */
export async function getAccountSummary() {
  return authedFetch('/auth/me/profile', accountSummarySchema);
}

/**
 * تقييماتي — the reviews this customer has written.
 *
 * A hidden review is still returned to its author, carrying its status: somebody who cannot see the
 * review staff hid cannot tell "SAFRA removed this" from "it never saved", and the second reading
 * produces a duplicate attempt the unique index then refuses.
 */
const myReviewSchema = z.object({
  reference: z.string(),
  bookingReference: z.string(),
  rating: z.number(),
  body: z.string(),
  status: z.string(),
  partnerReply: z.string().nullable(),
  createdAt: z.string(),
  property: translatedNameSchema,
  unit: translatedNameSchema,
});

export type MyReview = z.infer<typeof myReviewSchema>;

const myReviewsSchema = z.object({
  items: z.array(myReviewSchema),
  nextCursor: z.string().nullable(),
});

export async function getMyReviews(cursor?: string) {
  const query = new URLSearchParams({ limit: '10' });

  if (cursor) query.set('cursor', cursor);

  return authedFetch(`/reviews/mine?${query.toString()}`, myReviewsSchema);
}

// ─── المفضلة (handoff §6) ─────────────────────────────────────────────────────

const favouriteSchema = z.object({
  slug: z.string(),
  savedAt: z.string(),
  /**
   * Whether the listing can still be booked.
   *
   * A saved property that was later unpublished is REPORTED rather than dropped: silently removing it
   * would look like the save had failed.
   */
  isAvailable: z.boolean(),
  property: translatedNameSchema,
  /* `properties.city_id` is NOT NULL behind a foreign key, so a favourite always has a city. */
  city: translatedNameSchema,
  rating: z.string().nullable(),
  reviewsCount: z.number(),
  fromPrice: z.string().nullable(),
  currencyCode: z.string().nullable(),
});

export type Favourite = z.infer<typeof favouriteSchema>;

const favouritesSchema = z.object({
  items: z.array(favouriteSchema),
  nextCursor: z.string().nullable(),
});

export async function getMyFavourites(cursor?: string) {
  const query = new URLSearchParams({ limit: '12' });

  if (cursor) query.set('cursor', cursor);

  return authedFetch(`/favourites?${query.toString()}`, favouritesSchema);
}
