import 'server-only';

import { cookies } from 'next/headers';

import { isPartnerAppRole } from '@safra/contracts';
import { PARTNER_SESSION_COOKIE, decodeSession, type Session } from '@safra/session';

/**
 * Reading the ambient partner session.
 *
 * The encode/decode itself lives in `@safra/session`, shared with the other two apps; this is the
 * thin part that needs `next/headers` and therefore cannot be imported into middleware's Edge
 * runtime.
 *
 * The cookie name is `safra_partner_session`, not the console's and not the customer's. Cookies
 * ignore the PORT, so on `localhost` all three apps share a domain — an identical name would mean
 * signing in here silently replaced whichever session was already there.
 */
export async function getPartnerSession(): Promise<Session | null> {
  const jar = await cookies();
  const session = decodeSession(jar.get(PARTNER_SESSION_COOKIE)?.value);

  if (!session) return null;

  /**
   * Any role but `partner` is treated as no session at all.
   *
   * A staff member or a customer who somehow obtained a cookie on this origin gets the sign-in
   * page rather than an empty dashboard. This is a UX gate and NOT the security boundary — the API
   * authorises every call on its own, and scopes every partner query to the token's `partnerId` —
   * but it keeps the wrong person from seeing the shape of the tooling.
   */
  /* Owners AND their employees — see `PARTNER_APP_ROLES`. */
  return isPartnerAppRole(session.user.role) ? session : null;
}
