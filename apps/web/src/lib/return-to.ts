import type { Locale } from '@/i18n/routing';
import { isBookingReference } from '@/lib/booking-reference';

/**
 * Where a detail screen's «رجوع» sends the reader.
 *
 * Bashar, 2026-08-11: pressing back should return you to the page you came from — the booking
 * confirmation said «العودة للرئيسية» and dropped you on the home page even when you had arrived from
 * your own bookings list.
 *
 * ## Why the query carries a KEY and never a path
 *
 * The obvious version — `?return=/ar/account/bookings`, read and followed — is an open redirect. A
 * crafted link would turn the back control on our own page into a hop to somewhere else, and the
 * reader would have no reason to distrust it. So the parameter carries one of the KEYS below and
 * nothing else, and the href is built from a literal in this file. The worst a forged value can do is
 * be ignored.
 *
 * This is the customer-side twin of the console's rule about `returnHref`: "the detail screen rebuilds
 * the list URL from a LITERAL base path, never a path taken from the URL". Same threat, same answer.
 *
 * ## Every origin is a place the reader can actually have been
 *
 * The list is deliberately short. It is not a general router — adding an entry means a screen that
 * genuinely links into a detail page, which is also the moment to ask whether coming back to it makes
 * sense.
 */
const ORIGINS = {
  /** The public home page — the only truthful fallback for a page a guest can reach. */
  home: '',
  search: '/search',
  account: '/account',
  bookings: '/account/bookings',
  reviews: '/account/reviews',
  wallet: '/account/wallet',
  /* الفواتير: a receipt links to the booking it describes, so the booking must be able to come back. */
  invoices: '/account/invoices',
  /**
   * ONE receipt, not the list.
   *
   * Bashar, 2026-08-18: «عرض الحجز» on a receipt, then back, landed on الفواتير rather than on the
   * receipt he was reading. The origin key alone cannot express that — it names a SCREEN, and this
   * screen needs a row. So this entry takes a reference, and `returnTo` appends it.
   */
  invoice: '/account/invoices',
  support: '/account/support',
} as const;

/**
 * Origins that address ONE record, and therefore need a reference to be complete.
 *
 * The reference travels in its own parameter and is checked against `isBookingReference` before it
 * is appended — so the path is still a literal from this file plus a value of a known SHAPE, and a
 * crafted `ref` cannot become a path segment of its own. Without a usable reference the origin
 * degrades to its list, which is wrong-but-harmless rather than broken.
 */
const REFERENCED: ReadonlySet<string> = new Set(['invoice']);

export type ReturnOrigin = keyof typeof ORIGINS;

/** The parameter name, shared by whoever writes it and whoever reads it. */
export const RETURN_PARAM = 'from';

/** Which record to come back TO, for the origins that address one. */
export const RETURN_REF_PARAM = 'ref';

function isOrigin(value: string): value is ReturnOrigin {
  return Object.prototype.hasOwnProperty.call(ORIGINS, value);
}

/**
 * The href a detail screen's back control should point at.
 *
 * An unknown, absent or repeated value falls back rather than erroring: arriving at a booking from an
 * email, a bookmark or a payment redirect is ordinary, and the right response is the useful default
 * for that screen — not a broken link and not a 404.
 */
export function returnTo(
  locale: Locale,
  from: string | string[] | undefined,
  fallback: ReturnOrigin,
  reference?: string | string[],
): string {
  const key = typeof from === 'string' && isOrigin(from) ? from : fallback;
  const base = `/${locale}${ORIGINS[key]}`;

  if (!REFERENCED.has(key)) return base;

  /* A referenced origin without a usable reference falls back to its own list. */
  return typeof reference === 'string' && isBookingReference(reference)
    ? `${base}/${reference}`
    : base;
}

/**
 * What a list appends to a row's href so the detail screen knows where the reader came from.
 *
 * Written by the list because the list is the only thing that knows. A detail screen cannot work it
 * out — `Referer` is unreliable, strippable and not available during a server render.
 */
export function returnParam(origin: ReturnOrigin, reference?: string): string {
  const from = `${RETURN_PARAM}=${origin}`;

  return reference
    ? `${from}&${RETURN_REF_PARAM}=${encodeURIComponent(reference)}`
    : from;
}
