import type { Locale } from '@/i18n/routing';

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
} as const;

export type ReturnOrigin = keyof typeof ORIGINS;

/** The parameter name, shared by whoever writes it and whoever reads it. */
export const RETURN_PARAM = 'from';

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
): string {
  const key = typeof from === 'string' && isOrigin(from) ? from : fallback;

  return `/${locale}${ORIGINS[key]}`;
}

/**
 * What a list appends to a row's href so the detail screen knows where the reader came from.
 *
 * Written by the list because the list is the only thing that knows. A detail screen cannot work it
 * out — `Referer` is unreliable, strippable and not available during a server render.
 */
export function returnParam(origin: ReturnOrigin): string {
  return `${RETURN_PARAM}=${origin}`;
}
