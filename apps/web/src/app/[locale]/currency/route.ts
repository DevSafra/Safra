import 'server-only';

import { NextResponse } from 'next/server';

import { isSameOrigin } from '@safra/session';

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

  /*
    Same-origin only.

    This endpoint takes no session, so `SameSite` on the session cookie does not protect it: a form
    on another site could POST here and change a visitor's display currency. The impact is small —
    it is a preference, not money — but a state-changing endpoint that accepts a cross-site
    submission is the shape of a CSRF, and refusing one costs a header comparison.

    `Origin` is sent on every cross-origin POST by every browser that matters, and same-origin
    requests either send it or send none at all; a missing header is therefore accepted.
  */
  /*
    Compared against the `Host` HEADER, not against `request.url`.

    It was `origin !== new URL(request.url).origin`, and on the standalone runtime the container
    actually ships, `request.url` carries the address the server is BOUND to — `0.0.0.0`. So the
    comparison was `http://safra.example` against `http://0.0.0.0:3000` and never matched: every
    real browser sends `Origin` on a POST, so this guard answered **403 to everybody**. Measured
    2026-08-20: 403 with a correct same-origin header, 303 with the header removed. A check that
    refuses everyone is an outage wearing a security check's clothes.
  */
  if (!isSameOrigin(request)) {
    return new Response('Cross-site request refused.', { status: 403 });
  }

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

  /*
    A NextResponse, because this sets a cookie — but with a RELATIVE `Location`.

    `NextResponse.redirect()` insists on an absolute URL and would build it from `request.url`, which
    is `http://0.0.0.0:3000` on the runtime the container ships. Constructing the response directly
    keeps the cookie API and lets the browser resolve the target against the URL it already asked
    for. Same reasoning as `seeOther` in `@safra/session`, which the routes that set no cookie use.
  */
  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: target },
  });

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
