import { NextResponse } from 'next/server';

import { PARTNER_SESSION_COOKIE, sessionCookieOptions } from '@safra/session';

/**
 * Signs the partner out by clearing the cookie, then sends them to the sign-in page.
 *
 * A POST, not a GET: a link that logged somebody out could be embedded in an `<img>` on any page
 * they visit.
 *
 * And a REDIRECT, not JSON. The control is a plain HTML form so it works without JavaScript, which
 * means the browser NAVIGATES to whatever this returns — a JSON body leaves the partner staring at
 * `{"ok":true}`. 303 specifically, so the follow-up is a GET rather than a repeated POST.
 *
 * The refresh token is not revoked upstream, so this ends the SESSION rather than every session —
 * the same limitation the console's logout carries.
 */
export function POST(): NextResponse {
  /*
    A RELATIVE `Location`, and a NextResponse because this clears the session cookie.

    An absolute URL built from `request.url` is `http://0.0.0.0:3002` on the standalone runtime the
    container ships — a different origin, so signing out would land the partner on a page their
    (now cleared) cookie never reached anyway. See `seeOther` in `@safra/session`.
  */
  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: '/login' },
  });

  response.cookies.set(PARTNER_SESSION_COOKIE, '', sessionCookieOptions(0));

  return response;
}
