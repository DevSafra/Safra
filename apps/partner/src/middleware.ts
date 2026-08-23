import { NextResponse, type NextRequest } from 'next/server';

import { isPartnerAppRole } from '@safra/contracts';

import {
  PARTNER_SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  buildCsp,
  callAuth,
  createNonce,
  mediaOrigins,
  decodeSession,
  encodeSession,
  needsRefresh,
  sessionCookieOptions,
  type Session,
} from '@safra/session';

/** The only path reachable without a partner session. */
/*
  Reachable without a session.

  `/invitation` joined `/login` on 2026-08-20 with the page that redeems a partner invitation. It
  HAS to be public: the whole point of the page is that the account is not yet a partner account
  and cannot sign in, which is exactly why the middleware bouncing it to `/login` left every
  accepted partner stranded.

  `/employee-invitation` joined them on 2026-08-23 for exactly the same reason, one step down: the
  account redeeming it is still a CUSTOMER and becomes `partner_employee` only when the form is
  submitted. Left out of this list it would have reproduced the 2026-08-20 dead end precisely —
  a working endpoint, a mail pointing at a page, and a redirect to a sign-in that refuses the
  account. Both entries are prefixes, so the `[token]` segment is covered.
*/
const PUBLIC_PATHS = ['/login', '/invitation', '/employee-invitation'];

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
 * Bashar decided partner 2FA is mandatory rather than optional, so an unenrolled partner reached
 * `/enrol-2fa` and nothing else. THAT ENDED ON 2026-08-20: a partner's second factor is now a code
 * emailed at every sign-in, proved before the session exists, and enrolling an authenticator is an
 * upgrade they may choose. The paragraphs below describe the gate as it was. Unlike the console's
 * gate, this one is not a posture the app
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
    imgSrc: [
      "'self'",
      'data:',
      'blob:',
      /*
        The object store, or the API's development media route — whichever this deployment points
        the URL builders at. Without it the gallery is blank: see `mediaOrigins`.
      */
      ...mediaOrigins([
        process.env['NEXT_PUBLIC_MEDIA_URL'],
        process.env['API_URL'] ?? 'http://localhost:4000',
      ]),
    ].join(' '),
    /*
      TLS, not the BUILD MODE.

      This was `process.env.NODE_ENV === 'production'`, and `pnpm start` is production mode — so a
      production build served over plain `http://localhost` sent `upgrade-insecure-requests` and
      then broke itself with it. The directive rewrites every `http://` request as `https://`, so
      Next's RSC payload fetches went to a port with no TLS, failed with `ERR_SSL_PROTOCOL_ERROR`,
      and every link fell back to a full browser navigation. Reported as a language switch changing
      the theme and losing the page (Bashar, 2026-08-18); the switch was only the trigger, because a
      full navigation re-derives `data-theme` and the footer's pathname from scratch.

      Keyed on the protocol of the request, so it is emitted exactly when there is TLS to keep and
      omitted when there is none to upgrade to. Taken from `nextUrl` rather than a forwarded header
      read by hand — a spoofed value could only ever remove the directive from the spoofer's own
      response, and there is nothing to gain from that.
    */
    upgradeInsecure: request.nextUrl.protocol === 'https:',
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

  /*
    Enrolment is OFFERED, never forced (Bashar, 2026-08-20).

    This used to redirect every unenrolled partner to `/enrol-2fa` and let them reach nothing else.
    That was right while an authenticator was the partner's only second factor; it is wrong now
    that the second factor is a code emailed at every sign-in and already proved before this
    session existed. Left in place it would trap every partner on the platform on an enrolment
    screen they were never asked to complete — the 78 whose enrolments the 0035 migration cleared
    most of all.

    A partner who WANTS an authenticator can still open `/enrol-2fa` and set one up, which is why
    the route stays and why an enrolled partner is no longer bounced away from it: it is where they
    would go to look at it.
  */
  if (onPublic) {
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

  /* Owners AND their employees — see `PARTNER_APP_ROLES`. */
  return isPartnerAppRole(session.user.role) ? session : null;
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
