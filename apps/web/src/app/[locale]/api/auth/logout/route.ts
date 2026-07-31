import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { callLogout } from '@/lib/auth-api';
import { SESSION_COOKIE, decodeSession, sessionCookieOptions } from '@/lib/session';

/**
 * Ends the session (SRS §4).
 *
 * Two halves, and both matter. Clearing the local cookie signs the customer out of
 * this browser; telling the API revokes the refresh family server-side, so a token
 * captured earlier cannot be replayed to mint new access tokens. Doing only the
 * first would leave a live session behind on a shared or stolen device.
 *
 * The cookie is cleared even when the API call fails — see `callLogout`. A customer
 * who clicked "sign out" must end up signed out of the browser in front of them,
 * whatever the network did.
 */
export async function POST(): Promise<NextResponse> {
  const jar = await cookies();
  const session = decodeSession(jar.get(SESSION_COOKIE)?.value);

  await callLogout(session?.refreshToken);

  const response = new NextResponse(null, { status: 204 });

  /**
   * Overwritten with an empty value and a zero lifetime rather than deleted by name.
   * The attributes must match the ones it was set with — path in particular — or the
   * browser keeps the original cookie and the customer stays signed in.
   */
  response.cookies.set(SESSION_COOKIE, '', sessionCookieOptions(0));

  return response;
}
