import { NextResponse, type NextRequest } from 'next/server';

import {
  SESSION_MAX_AGE_SECONDS,
  STAFF_SESSION_COOKIE,
  callAuth,
  decodeSession,
  encodeSession,
  hasTwoFactor,
  needsRefresh,
  sessionCookieOptions,
  type Session,
} from '@safra/session';
import { isStaffRole } from '@safra/contracts';

/**
 * The only paths reachable without a complete, enrolled staff session.
 *
 * `/invitation` is here because an invited staff member has no session yet and cannot
 * get one — their account has no password until they use this page. The invitation
 * token is the authentication, and the API validates it; this app only renders the
 * form. Without this entry the emailed link redirects to a sign-in they cannot pass.
 */
const PUBLIC_PATHS = ['/login', '/invitation'];

/** Reachable with a session that has not yet enrolled in 2FA — and nothing else. */
const ENROLMENT_PATHS = ['/enrol-2fa'];

/**
 * Everything that guards the staff app, in one place.
 *
 * Three gates in order, and the order matters:
 *
 *  1. **Session** — rotated if stale, exactly as in the public app.
 *  2. **Staff role** — a customer or partner cookie on this origin is treated as no
 *     session at all.
 *  3. **2FA enrolment** — a staff member who has not enrolled can reach the
 *     enrolment page and nothing else.
 *
 * The third is a change in posture rather than a new screen. The API only demands a
 * TOTP code from accounts that have ALREADY enabled it (see `AuthService.login`), so
 * a staff account that never enrolled signs in with a password alone. That is
 * tolerable for an API and not tolerable for the console that approves partners and
 * moves wallet balances, so this app refuses to be useful until enrolment is done.
 *
 * None of this is the security boundary — the API authorises every call on its own
 * authority. It is what stops the wrong person seeing the shape of the tooling, and
 * what makes the 2FA requirement real rather than advisory.
 */
export default async function middleware(request: NextRequest) {
  const rotated = await rotateIfStale(request);
  const session = currentSession(request, rotated);

  const response = route(request, session);

  // Applied to whichever response is going back, including a redirect — see the
  // note in the public app's middleware about the bug that came from not doing this.
  if (rotated) {
    response.cookies.set(
      STAFF_SESSION_COOKIE,
      rotated,
      sessionCookieOptions(SESSION_MAX_AGE_SECONDS),
    );
  } else if (rotated === null) {
    response.cookies.set(STAFF_SESSION_COOKIE, '', sessionCookieOptions(0));
  }

  return response;
}

function route(request: NextRequest, session: Session | null): NextResponse {
  const { pathname } = request.nextUrl;

  const onPublic = matches(pathname, PUBLIC_PATHS);
  const onEnrolment = matches(pathname, ENROLMENT_PATHS);

  if (!session) {
    // Already heading somewhere anonymous: let it render.
    if (onPublic) return NextResponse.next();

    const target = new URL('/login', request.url);

    /**
     * Where they were going, so the sign-in returns them there. Only the PATH is
     * carried, and it is re-validated on the login page — a full URL here would be
     * an open redirect on the one form most worth phishing.
     */
    target.searchParams.set('next', pathname + request.nextUrl.search);

    return NextResponse.redirect(target);
  }

  if (!hasTwoFactor(session)) {
    // Enrolment is the ONLY thing an unenrolled staff member may reach.
    return onEnrolment
      ? NextResponse.next()
      : NextResponse.redirect(new URL('/enrol-2fa', request.url));
  }

  // Fully authenticated: the sign-in and enrolment pages have nothing left to offer.
  if (onPublic || onEnrolment) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return NextResponse.next();
}

/**
 * The session this request should be treated as having.
 *
 * `rotated === null` means the refresh was refused and the cookie is being cleared,
 * so the incoming value must not count — otherwise the one request that discovers a
 * dead session is the one allowed through with it.
 */
function currentSession(
  request: NextRequest,
  rotated: string | null | undefined,
): Session | null {
  if (rotated === null) return null;

  const session = decodeSession(
    rotated ?? request.cookies.get(STAFF_SESSION_COOKIE)?.value,
  );

  if (!session) return null;

  return isStaffRole(session.user.role) ? session : null;
}

/**
 * Refreshes the session when the access token is spent.
 *
 * Identical in shape to the public app's, including the distinction that matters: a
 * 401 means the API refused the token and the session is dead, while a 502 means
 * this app could not reach the API and the session should survive. Treating an
 * outage as a logout would sign out every staff member the moment the API restarted.
 */
async function rotateIfStale(request: NextRequest): Promise<string | null | undefined> {
  const raw = request.cookies.get(STAFF_SESSION_COOKIE)?.value;
  if (!raw) return undefined;

  const session = decodeSession(raw);
  if (!session) return null;

  if (!needsRefresh(session)) return undefined;

  const outcome = await callAuth('/auth/refresh', { refreshToken: session.refreshToken });

  if (!outcome.ok || !outcome.session) {
    return outcome.status === 401 || outcome.status === 403 ? null : undefined;
  }

  const encoded = encodeSession(outcome.session);

  // The current render reads this, not the stale value it arrived with.
  request.cookies.set(STAFF_SESSION_COOKIE, encoded);

  return encoded;
}

function matches(pathname: string, paths: string[]): boolean {
  return paths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
