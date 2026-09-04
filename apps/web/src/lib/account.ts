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
/**
 * What a refused status means to an account page — and specifically, what it does NOT mean.
 *
 * ## 401 and 403 are not the same thing, and treating them as one told the reader a lie
 *
 * They were folded together, so `customer.profile_missing` — an account with no customer profile,
 * which the API refuses precisely and correctly — reached محفظتي as «انتهت الجلسة، سجّل الدخول
 * مجدداً». That is false: the session is valid. Worse, it is a LOOP — signing in again produces
 * the same token, the same 403 and the same sentence, so the one action the page recommends is the
 * one action that cannot possibly help. There are 2,997 partner accounts on this platform, a
 * partner may sign in on the customer site (only staff are refused there), and none of them has a
 * customer profile. Found on 2026-08-21 by Bashar, on his own account.
 *
 * ## Why 403 becomes `failed` rather than a fourth outcome
 *
 * Deliberately the SMALL fix. `failed` makes the page say «تعذّر التحميل» — vague, but true —
 * instead of a specific claim that is false and points the reader the wrong way. Saying something
 * genuinely useful («هذا حساب شريك، ولوحة العميل ليست له») needs a page state that sixteen account
 * pages do not have; that is `O-web-1`, not something to smuggle in here.
 *
 * Exported for its test. The mapping is three lines and one of them was wrong for months, which is
 * the argument for testing it rather than for trusting it.
 */
export function refusalFor(status: number): 'unauthenticated' | 'failed' | null {
  /*
    401: the token expired between middleware's check and this fetch, or was revoked mid-request.
    A sign-in prompt is the right answer and the customer's next navigation refreshes.
  */
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'failed';

  return null;
}

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

  const refusal = refusalFor(response.status);

  if (refusal) return refusal;

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
  /*
    The code, so the amount can be written as money.

    Both booking payloads carried `totalAmount` and a `currencyId` UUID, so these screens printed
    the raw decimal — «191.990», three decimals and no symbol, where every other surface said
    «$191.99». `.nullable()` rather than a default: an absent code means the API stopped sending
    it, and inventing one would print a plausible currency over an unknown amount.
  */
  currency: z.object({ code: z.string() }).nullable().optional(),
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

/**
 * One booking, scoped to the caller by the API.
 *
 * A wider shape than the list's: a detail screen shows the guests and when the booking was placed,
 * which a row has no space for. `confirmationDeadlineAt` is the one a customer most needs while a
 * booking is pending — it is the two-hour promise, and a page that describes the promise without
 * saying when it runs out is describing nothing.
 *
 * Somebody else's reference answers 404 here exactly as an unknown one does; the caller cannot tell
 * the two apart, and references are sequential, so any difference would enumerate them.
 */
const bookingDetailSchema = z.object({
  reference: z.string(),
  status: z.string(),
  /* Where the stay is. A reference and a total describe a transaction, not a trip. */
  property: translatedNameSchema,
  unit: translatedNameSchema,
  checkIn: z.string(),
  checkOut: z.string(),
  nights: z.number(),
  guestsAdults: z.number(),
  guestsChildren: z.number().nullable().optional(),
  guestsInfants: z.number().nullable().optional(),
  totalAmount: z.string(),
  /*
    The code, so the amount can be written as money.

    Both booking payloads carried `totalAmount` and a `currencyId` UUID, so these screens printed
    the raw decimal — «191.990», three decimals and no symbol, where every other surface said
    «$191.99». `.nullable()` rather than a default: an absent code means the API stopped sending
    it, and inventing one would print a plausible currency over an unknown amount.
  */
  currency: z.object({ code: z.string() }).nullable().optional(),

  /*
    Where the stay is, as the city's public slug — for the partner ads §9.3 targets by city.

    An OBJECT rather than a bare string, because that is the shape the API's relation returns, and
    `.nullable()` rather than `.default()`: a booking's city is `NOT NULL` in the database, so a
    missing one means the API stopped sending it, and a default would invent a plausible city
    instead of showing no ads. See «A zod .default() hides a missing field».
  */
  city: z.object({ slug: z.string() }).nullable().optional(),
  confirmationDeadlineAt: z
    .union([z.string(), z.date(), z.null()])
    .optional()
    .transform((v) => (v ? new Date(v).toISOString() : null)),
  createdAt: z.union([z.string(), z.date()]).transform((v) => new Date(v).toISOString()),
});

export type CustomerBookingDetail = z.infer<typeof bookingDetailSchema>;

export async function getMyBooking(reference: string) {
  return authedFetch(`/bookings/${encodeURIComponent(reference)}`, bookingDetailSchema);
}

// ─── Wallet ──────────────────────────────────────────────────────────────────

const walletSchema = z.object({
  wallet: z
    .object({
      balance: z.string(),
      /**
       * How much of the balance arrived from a gift card.
       *
       * Derived by the API, never stored — see `WalletService.composition`. Required rather than
       * optional: if the field ever stops arriving, محفظتي should fail its parse loudly instead of
       * quietly reporting every balance as entirely non-gift.
       */
      giftBalance: z.string(),
      /**
       * How much of the balance may never be paid out — gift money and compensation together.
       *
       * Required, and never `.default('0')`: a default would invent «none of this is restricted»
       * for a payload that stopped carrying it, which is the one wrong answer that looks right on
       * every screen it reaches.
       */
      restrictedBalance: z.string(),
      currencyCode: z.string(),
    })
    .nullable(),
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
  /*
    The official CLASSIFICATION, 1-5, not the guest review score beside it. `.nullable()` because
    2,703 listings predate the field — a `.default()` would invent one for every hotel on the
    platform, which is exactly the failure `docs/i18n.md`'s sibling note about defaults describes.
  */
  starRating: z.number().int().min(1).max(5).nullable(),
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

// ─── الفواتير (handoff §6) ────────────────────────────────────────────────────

/**
 * A receipt.
 *
 * Every amount is a STRING, and stays one all the way to `formatMoney`. `numeric(14,2)` does not fit a
 * JavaScript number without losing the last cent at the far end of the range, and a money figure that
 * is occasionally wrong is worse than one that is always a string.
 */
const invoiceSummarySchema = z.object({
  reference: z.string(),
  bookingStatus: z.string(),
  issuedAt: z.string(),
  paidAt: z.string().nullable(),
  checkIn: z.string(),
  checkOut: z.string(),
  nights: z.number(),
  property: translatedNameSchema.extend({ slug: z.string() }),
  city: translatedNameSchema,
  currencyCode: z.string(),
  totalAmount: z.string(),
});

export type InvoiceSummaryRow = z.infer<typeof invoiceSummarySchema>;

const invoicesSchema = z.object({
  items: z.array(invoiceSummarySchema),
  nextCursor: z.string().nullable(),
});

/**
 * The line keys the API is allowed to send.
 *
 * An enum rather than a string, because each key becomes a LOOK-UP in the copy catalogue: an unknown
 * key would render as a missing-message placeholder in the middle of a financial document. Rejecting
 * the response is the louder and more honest failure.
 */
const invoiceLineSchema = z.object({
  key: z.enum(['accommodation', 'serviceFee', 'discount', 'giftCard', 'wallet']),
  amount: z.string(),
  deduction: z.boolean(),
});

export type InvoiceLineRow = z.infer<typeof invoiceLineSchema>;

const invoicePaymentSchema = z.object({
  reference: z.string(),
  method: z.string(),
  status: z.string(),
  amount: z.string(),
  currencyCode: z.string(),
  capturedAt: z.string().nullable(),
});

export type InvoicePaymentRow = z.infer<typeof invoicePaymentSchema>;

const invoiceDetailSchema = invoiceSummarySchema.extend({
  lines: z.array(invoiceLineSchema),
  payments: z.array(invoicePaymentSchema),
});

export type InvoiceDetailRow = z.infer<typeof invoiceDetailSchema>;

export async function getMyInvoices(cursor?: string) {
  const query = new URLSearchParams({ limit: '10' });

  if (cursor) query.set('cursor', cursor);

  return authedFetch(`/invoices?${query.toString()}`, invoicesSchema);
}

/**
 * One receipt.
 *
 * The API answers 404 for a reference that is not this customer's, indistinguishably from one that
 * does not exist — the same reasoning as `getReviewForBooking`, and it matters more here because a
 * receipt names what somebody paid.
 */
export async function getInvoice(reference: string) {
  return authedFetch(`/invoices/${encodeURIComponent(reference)}`, invoiceDetailSchema);
}

// ─── بطاقات الهدايا (handoff §6) ──────────────────────────────────────────────

/**
 * A card as its purchaser sees it. There is no code field, and there must never be one.
 *
 * `gift_cards` stores only `code_hash` and `code_last4`, so a code is unrecoverable after the
 * purchase response that carried it. If a schema here ever grows a `code`, something upstream has
 * started returning a spendable secret on a read.
 */
const giftCardSchema = z.object({
  reference: z.string(),
  codeLast4: z.string(),
  originalAmount: z.string(),
  remainingAmount: z.string(),
  currencyCode: z.string(),
  status: z.string(),
  expiresAt: z.string().nullable(),
  recipientName: z.string().nullable(),
  recipientEmail: z.string().nullable(),
  createdAt: z.string(),
});

export type GiftCardRow = z.infer<typeof giftCardSchema>;

const giftCardsSchema = z.object({
  items: z.array(giftCardSchema),
  nextCursor: z.string().nullable(),
});

export async function getMyGiftCards(cursor?: string) {
  const query = new URLSearchParams({ limit: '10' });

  if (cursor) query.set('cursor', cursor);

  return authedFetch(`/gift-cards?${query.toString()}`, giftCardsSchema);
}

// ─── الدعم (Bashar, 2026-08-12) ───────────────────────────────────────────────

/**
 * A support message as its sender may see it.
 *
 * There is no `internal` field, and there must never be one: staff write their assessment of a complaint
 * into the same thread, and the API filters those out. A schema that accepted the flag would make a leak
 * upstream invisible here rather than loud.
 */
const supportMessageSchema = z.object({
  id: z.string(),
  sender: z.enum(['customer', 'partner', 'staff', 'system']),
  body: z.string(),
  /** How many contact-detail spans were masked, so the sender learns it happened. */
  redactedCount: z.number(),
  createdAt: z.string(),
});

export type SupportMessageRow = z.infer<typeof supportMessageSchema>;

const supportTicketSchema = z.object({
  reference: z.string(),
  openedAt: z.string(),
  lastMessageAt: z.string().nullable(),
  closed: z.boolean(),
  messageCount: z.number(),
  lastMessage: z.string().nullable(),
});

export type SupportTicketRow = z.infer<typeof supportTicketSchema>;

const supportThreadSchema = supportTicketSchema.extend({
  messages: z.array(supportMessageSchema),
});

export type SupportThreadRow = z.infer<typeof supportThreadSchema>;

const supportListSchema = z.object({
  items: z.array(supportTicketSchema),
  nextCursor: z.string().nullable(),
});

export async function getMySupportTickets(cursor?: string) {
  const query = new URLSearchParams({ limit: '10' });

  if (cursor) query.set('cursor', cursor);

  return authedFetch(`/support?${query.toString()}`, supportListSchema);
}

/**
 * One thread.
 *
 * The API answers 404 for somebody else's ticket indistinguishably from one that does not exist, so this
 * returns 'failed' for both and the page renders not-found — references are sequential.
 */
export async function getSupportThread(reference: string) {
  return authedFetch(`/support/${encodeURIComponent(reference)}`, supportThreadSchema);
}

// ─── النزاعات ────────────────────────────────────────────────────────────────

/**
 * A dispute, as the asking side is told about it.
 *
 * Parsed rather than trusted, like every other read here. `kind` and `status` are checked against
 * the enums the catalogue has labels for — an unknown value would otherwise render as a missing
 * translation, which is how a machine identifier reaches a screen.
 */
const disputeSchema = z.object({
  reference: z.string(),
  bookingReference: z.string(),
  kind: z.enum([
    'property_unavailable',
    'not_as_described',
    'partner_no_response',
    'complaint',
  ]),
  status: z.enum(['open', 'investigating', 'resolved', 'rejected']),
  title: z.string(),
  openedAt: z.string(),
  closedAt: z.string().nullable(),
  resolution: z.string().nullable(),
  redactedCount: z.number(),
});

export type DisputeRow = z.infer<typeof disputeSchema>;

const disputeListSchema = z.object({
  items: z.array(disputeSchema),
  nextCursor: z.string().nullable(),
});

export async function getMyDisputes(cursor?: string) {
  const query = new URLSearchParams({ limit: '10' });

  if (cursor) query.set('cursor', cursor);

  return authedFetch(`/disputes?${query.toString()}`, disputeListSchema);
}

/**
 * The bookings a dispute could be raised about.
 *
 * Asked of the API rather than filtered from the booking list in the browser: the rule for what is
 * disputable is enforced server-side when the dispute is opened, and a picker that decided it
 * separately would drift — offering a booking the API then refuses.
 */
const disputableSchema = z.object({
  items: z.array(
    z.object({
      reference: z.string(),
      property: z.string().nullable(),
      checkIn: z.string(),
      status: z.string(),
    }),
  ),
});

export async function getDisputableBookings() {
  return authedFetch('/disputes/disputable-bookings', disputableSchema);
}
