import { NextResponse, type NextRequest } from 'next/server';

import {
  PARTNER_SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  buildCsp,
  callAuth,
  createNonce,
  decodeSession,
  encodeSession,
  hasTwoFactor,
  needsRefresh,
  sessionCookieOptions,
  type Session,
} from '@safra/session';

/** The only path reachable without a partner session. */
const PUBLIC_PATHS = ['/login'];

/** Reachable with a session that has not yet enrolled in 2FA — and nothing else. */
const ENROLMENT_PATHS = ['/enrol-2fa'];

/**
 * Everything that guards لوحة الشريك, in one place.
 *
 * Two gates, in order:
 *
 *  1. **Session** — rotated if the access token is spent, exactly as in the other two apps.
 *  2. **Partner role** — a staff or customer cookie on this origin counts as no session at all.
 *
 * ## The 2FA gate, mandatory since 2026-08-07
 *
 * Bashar decided partner 2FA is mandatory rather than optional, so an unenrolled partner reaches
 * `/enrol-2fa` and nothing else. Unlike the console's gate, this one is not a posture the app
 * adopts on its own: `TwoFactorGuard` on the API already refuses every partner call except
 * enrolment, so this redirect is the honest face of a refusal the server is making anyway. A
 * partner who skips the portal and calls the API directly gets the same answer.
 *
 * A partner who existed before the requirement signs in with their password exactly as before and
 * lands here. That is the migration: no account is locked out, and none is useful until enrolled.
 *
 * ## None of this is the security boundary
 *
 * The API authorises every call on its own authority and scopes every partner query to the
 * `partnerId` in the verified token. This middleware stops the wrong person seeing the SHAPE of
 * the tooling; it is not what keeps one partner out of another's bookings.
 */
export default async function middleware(request: NextRequest) {
  /*
    Built per request because it carries a nonce, and set on the forwarded REQUEST headers as well
    as the response — that is how Next learns the nonce and stamps it onto its own inline scripts.
    A static `script-src 'self'` blocks every hydration script Next emits, which is a failure no
    HTTP-level check can see: the page still returns 200 and no form in it works.
  */
  const csp = buildCsp({
    nonce: createNonce(),
    /* Listing photos come from the API and from data URIs; nothing remote is loaded. */
    imgSrc: "'self' data: blob:",
    upgradeInsecure: process.env.NODE_ENV === 'production',
  });

  request.headers.set('content-security-policy', csp);

  const rotated = await rotateIfStale(request);
  const session = currentSession(request, rotated);
  const response = route(request, session);

  // Applied to whichever response is going back, including a redirect.
  if (rotated) {
    response.cookies.set(
      PARTNER_SESSION_COOKIE,
      rotated,
      sessionCookieOptions(SESSION_MAX_AGE_SECONDS),
    );
  } else if (rotated === null) {
    response.cookies.set(PARTNER_SESSION_COOKIE, '', sessionCookieOptions(0));
  }

  response.headers.set('content-security-policy', csp);

  return response;
}

function route(request: NextRequest, session: Session | null): NextResponse {
  const { pathname } = request.nextUrl;
  const onPublic = matches(pathname, PUBLIC_PATHS);
  const onEnrolment = matches(pathname, ENROLMENT_PATHS);

  if (!session) {
    if (onPublic) return NextResponse.next();

    const target = new URL('/login', request.url);

    /*
      Where they were going, so signing in returns them there. Only the PATH is carried, and the
      login page re-validates it — a full URL here would be an open redirect on the one form most
      worth phishing.
    */
    target.searchParams.set('next', pathname + request.nextUrl.search);

    return NextResponse.redirect(target);
  }

  if (!hasTwoFactor(session)) {
    // Enrolment is the ONLY thing an unenrolled partner may reach.
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
 * `rotated === null` means the refresh was refused and the cookie is being cleared, so the
 * incoming value must not count — otherwise the one request that discovers a dead session is the
 * one allowed through with it.
 */
function currentSession(
  request: NextRequest,
  rotated: string | null | undefined,
): Session | null {
  if (rotated === null) return null;

  const session = decodeSession(
    rotated ?? request.cookies.get(PARTNER_SESSION_COOKIE)?.value,
  );

  if (!session) return null;

  return session.user.role === 'partner' ? session : null;
}

/**
 * Refreshes the session when the access token is spent.
 *
 * The distinction that matters: a 401 means the API refused the token and the session is dead,
 * while a 502 means this app could not reach the API and the session should survive. Treating an
 * outage as a logout would sign out every partner the moment the API restarted.
 */
async function rotateIfStale(request: NextRequest): Promise<string | null | undefined> {
  const raw = request.cookies.get(PARTNER_SESSION_COOKIE)?.value;
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
  request.cookies.set(PARTNER_SESSION_COOKIE, encoded);

  return encoded;
}

function matches(pathname: string, paths: string[]): boolean {
  return paths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
