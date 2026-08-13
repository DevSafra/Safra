import 'server-only';

import { NextResponse } from 'next/server';

import {
  CURRENCY_COOKIE,
  DEFAULT_DISPLAY_CURRENCY,
  isDisplayCurrency,
} from '@/lib/currency';
import { isLocale } from '@/i18n/routing';

/**
 * Records which currency a visitor wants prices shown in.
 *
 * ## A POST, and a redirect back
 *
 * The same shape the console's rows-per-page bar uses, for the same reason: **a GET that writes
 * would let a prefetch, a crawler or a pasted link change somebody's preference.** Next prefetches
 * links in the viewport, so a `<Link>` that set a cookie would fire on hover.
 *
 * ## The destination is rebuilt, never taken from the request
 *
 * `next` is a PATH the form supplies, so it is the classic open-redirect input. It is accepted only
 * when it starts with a single `/` and no backslash — anything else falls back to the locale root.
 * `new URL(target, request.url)` then resolves it against this origin, so even a survivor of that
 * check cannot leave the site.
 *
 * ## An unknown currency is ignored, not an error
 *
 * A visitor whose form posted something unexpected gets the default and their page back. Refusing
 * with a 400 would replace a working page with an error screen over a display preference — and the
 * cookie is only ever read back through `isDisplayCurrency` anyway.
 */
export const dynamic = 'force-dynamic';

/** A year. Long enough to be a preference rather than a session, short enough to lapse. */
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ locale: string }> },
): Promise<Response> {
  const { locale } = await params;
  const home = isLocale(locale) ? `/${locale}` : '/';

  const form = await request.formData();
  const chosen = form.get('currency');
  const next = form.get('next');

  const currency = isDisplayCurrency(chosen) ? chosen : DEFAULT_DISPLAY_CURRENCY;

  /* Same-origin, absolute, no protocol-relative `//evil.test` and no `\` for a lenient parser. */
  const target =
    typeof next === 'string' &&
    next.startsWith('/') &&
    !next.startsWith('//') &&
    !next.includes('\\')
      ? next
      : home;

  const response = NextResponse.redirect(new URL(target, request.url), 303);

  response.cookies.set(CURRENCY_COOKIE, currency, {
    path: '/',
    maxAge: ONE_YEAR_SECONDS,
    sameSite: 'lax',
    /* Not HttpOnly: this is a display preference, not a credential. */
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
  });

  return response;
}
