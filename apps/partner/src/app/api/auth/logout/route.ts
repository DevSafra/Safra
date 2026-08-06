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
export function POST(request: Request): NextResponse {
  const response = NextResponse.redirect(new URL('/login', request.url), 303);

  response.cookies.set(PARTNER_SESSION_COOKIE, '', sessionCookieOptions(0));

  return response;
}
