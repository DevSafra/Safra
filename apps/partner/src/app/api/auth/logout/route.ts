import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import {
  PARTNER_SESSION_COOKIE,
  callLogout,
  decodeSession,
  internalCallerHeaders,
  sessionCookieOptions,
} from '@safra/session';

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
 * The refresh token is revoked at the API first, as the console and the customer site do. Clearing
 * only the cookie left that token exchangeable for fresh access for the rest of its thirty days, so
 * a partner signing out of a shared reception computer was not signed out of anything a copied
 * token could reach. It ends THIS session's family, not every session the partner holds.
 *
 * The cookie is cleared even when the API call fails: somebody who pressed sign out must end up
 * signed out of the browser in front of them whatever the network did. `callLogout` swallows its
 * own failure for that reason.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const jar = await cookies();
  const session = decodeSession(jar.get(PARTNER_SESSION_COOKIE)?.value);

  await callLogout(session?.refreshToken, internalCallerHeaders(request.headers));

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
