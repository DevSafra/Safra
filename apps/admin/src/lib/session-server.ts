import 'server-only';

import { cookies } from 'next/headers';

import {
  STAFF_SESSION_COOKIE,
  decodeSession,
  hasTwoFactor,
  type Session,
} from '@safra/session';
import { isStaffRole } from '@safra/contracts';

/**
 * Reading the ambient staff session.
 *
 * The pure encode/decode lives in `@safra/session`, shared with the public app; this
 * is the thin part that needs `next/headers` and therefore cannot be imported into
 * middleware's Edge runtime.
 *
 * Note the cookie name: `safra_admin_session`, not the customer one. Cookies ignore
 * the port, so on `localhost` the two apps share a domain — identical names would
 * mean signing into this app silently replaced the customer's session, or the public
 * site rendering with staff claims.
 */
export async function getStaffSession(): Promise<Session | null> {
  const jar = await cookies();
  const session = decodeSession(jar.get(STAFF_SESSION_COOKIE)?.value);

  if (!session) return null;

  /**
   * A non-staff role is treated as no session at all.
   *
   * A customer who somehow obtained a cookie on this origin gets the sign-in page
   * rather than an empty dashboard. This is a UX gate — every API call is still
   * authorised on its own — but it keeps the wrong person from ever seeing the shape
   * of the staff tooling.
   */
  return isStaffRole(session.user.role) ? session : null;
}

/** Whether the signed-in staff member has completed 2FA enrolment. */
export async function isEnrolled(): Promise<boolean> {
  const session = await getStaffSession();

  return session !== null && hasTwoFactor(session);
}
