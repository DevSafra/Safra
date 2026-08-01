import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import {
  STAFF_SESSION_COOKIE,
  callLogout,
  decodeSession,
  sessionCookieOptions,
} from '@safra/session';

/**
 * Ends the staff session locally and revokes the refresh family at the API.
 *
 * The cookie is cleared even when the API call fails: someone who clicked sign out —
 * plausibly because they are on a shared machine — must end up signed out of the
 * browser in front of them whatever the network did.
 */
export async function POST(): Promise<NextResponse> {
  const jar = await cookies();
  const session = decodeSession(jar.get(STAFF_SESSION_COOKIE)?.value);

  await callLogout(session?.refreshToken);

  const response = new NextResponse(null, { status: 204 });

  response.cookies.set(STAFF_SESSION_COOKIE, '', sessionCookieOptions(0));

  return response;
}
