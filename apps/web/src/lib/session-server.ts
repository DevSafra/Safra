import 'server-only';

import { cookies } from 'next/headers';

import { SESSION_COOKIE, decodeSession, readClaim, type Session } from './session';

/**
 * Reading the ambient session, for server components.
 *
 * Split from `session.ts` because `next/headers` cannot be imported into middleware,
 * which needs the pure encode/decode helpers to rotate the cookie.
 *
 * Everything here is READ-ONLY by necessity: a server component cannot set a cookie.
 * Anything that rotates or clears the session happens in middleware or a route
 * handler, and by the time a page calls these, middleware has already refreshed a
 * stale token.
 */
export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  return decodeSession(jar.get(SESSION_COOKIE)?.value);
}

/**
 * The signed-in customer's profile id, or null.
 *
 * Reads the ACCESS TOKEN's claims rather than the `user` blob, because this is the
 * value the wallet path keys on and the token is the copy the API itself issued.
 * Still not a security boundary — the API re-derives it from the same token on every
 * request — but it keeps the UI from offering a balance the API will refuse.
 */
export async function getCustomerProfileId(): Promise<string | null> {
  const session = await getSession();
  if (!session) return null;

  return readClaim(session.accessToken, 'customerProfileId');
}
