import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';

import { routing } from './i18n/routing';
import {
  CUSTOMER_SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  buildCsp,
  callAuth,
  createNonce,
  mediaOrigins,
  decodeSession,
  encodeSession,
  needsRefresh,
  sessionCookieOptions,
} from '@safra/session';

const intlMiddleware = createMiddleware(routing);

/**
 * Locale routing, plus session rotation.
 *
 * Rotation lives here because it has nowhere else to go: access tokens last fifteen
 * minutes, and a server component CANNOT set a cookie. Without this, a customer
 * reading a page sixteen minutes after signing in would find every authenticated
 * fetch returning 401 with no way to recover short of signing in again.
 *
 * Both jars are written, and that is the subtle part. Setting the cookie only on the
 * RESPONSE fixes the next request but leaves the current render reading the expired
 * token — so the page that triggered the refresh is the one page that still fails.
 * Writing the request jar first means this render sees the new token immediately.
 */
export default async function middleware(request: NextRequest) {
  /**
   * The CSP is built HERE, per request, rather than in `next.config.ts`, because it
   * carries a nonce. A static policy cannot: Next's hydration scripts are inline and
   * their contents are the page's own data, so no hash is stable. See `buildCsp` for
   * what the static version broke.
   *
   * Set on the forwarded REQUEST headers as well as the response — that is how Next
   * learns the nonce and stamps it onto the scripts it generates. Omitting it serves a
   * policy the browser enforces against scripts that carry no nonce.
   */
  const csp = buildCsp({
    nonce: createNonce(),
    // https: because property photography comes from object storage or a CDN whose
    // hostname is deployment configuration, not known at build time.
    imgSrc: [
      "'self'",
      'data:',
      'blob:',
      /*
        Named origins, replacing a blanket `https:`. That allowed every HTTPS host on the internet
        to be an image source, which is an exfiltration channel rather than a convenience — see
        `mediaOrigins`.
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

  /*
    The path the visitor is on, forwarded so a SERVER component can read it.

    Next gives a layout no access to the pathname — `usePathname` is a client hook — and the footer's
    language control needs it: a switcher that sends every reader to the home page is a switcher
    that loses their place, which on a property page is the whole visit. A header set here is the
    documented way to get it there without turning the footer into a client component.
  */
  request.headers.set('x-safra-pathname', request.nextUrl.pathname);

  const rotated = await rotateIfStale(request);

  /**
   * Bounce anonymous visitors off the account pages before rendering them.
   *
   * A convenience, not the security boundary — the page checks again, and the API
   * refuses unauthenticated reads regardless. What it buys is that a signed-out
   * customer lands on a sign-in form that returns them where they were, instead of
   * on an account page that renders empty.
   */
  const response = redirectOrContinue(request, rotated);

  response.headers.set('content-security-policy', csp);

  /**
   * Applied to WHICHEVER response is going back, including the redirect above.
   *
   * Doing this only on the normal path was a real bug: a customer whose refresh
   * token had been revoked got bounced to sign-in with the dead cookie still in
   * place, so every later request retried the same doomed refresh and the header
   * kept claiming they were signed in.
   */
  if (rotated) {
    response.cookies.set(
      CUSTOMER_SESSION_COOKIE,
      rotated,
      sessionCookieOptions(SESSION_MAX_AGE_SECONDS),
    );
  } else if (rotated === null) {
    /**
     * The refresh was REJECTED — the token was expired, revoked, or replayed (the
     * API burns a whole token family on replay). Clearing the cookie turns that into
     * a clean signed-out state instead of a session that fails every request while
     * still looking active.
     */
    response.cookies.set(CUSTOMER_SESSION_COOKIE, '', sessionCookieOptions(0));
  }

  return response;
}

/**
 * Bounce anonymous visitors off the account pages before rendering them.
 *
 * A convenience, not the security boundary — the page checks again, and the API
 * refuses unauthenticated reads regardless. What it buys is that a signed-out
 * customer lands on a sign-in form that returns them where they were, instead of on
 * an account page that renders empty.
 */
function redirectOrContinue(
  request: NextRequest,
  rotated: string | null | undefined,
): NextResponse {
  if (!isProtected(request.nextUrl.pathname) || hasSession(request, rotated)) {
    /**
     * `request` already carries the CSP header set by the caller, so next-intl
     * forwards it to the render and Next reads the nonce out of it.
     */
    return intlMiddleware(request);
  }

  const locale = localeOf(request.nextUrl.pathname);
  const target = new URL(`/${locale}/login`, request.url);

  target.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search);

  return NextResponse.redirect(target);
}

/**
 * Refreshes the session when the access token is spent.
 *
 * Returns the new cookie value, `null` when the session must be dropped, or
 * `undefined` when nothing needed doing — which is the overwhelmingly common case
 * and costs one cookie parse.
 */
async function rotateIfStale(request: NextRequest): Promise<string | null | undefined> {
  const raw = request.cookies.get(CUSTOMER_SESSION_COOKIE)?.value;
  if (!raw) return undefined;

  const session = decodeSession(raw);

  // Unparseable: a cookie from an older shape. Drop it rather than carry it.
  if (!session) return null;

  if (!needsRefresh(session)) return undefined;

  const outcome = await callAuth('/auth/refresh', { refreshToken: session.refreshToken });

  /**
   * A transient failure must NOT sign the customer out.
   *
   * 502 is this app failing to reach the API; 401 is the API refusing the token.
   * Only the second means the session is genuinely dead. Treating an outage as a
   * logout would empty every browser on the internet the moment the API restarted.
   */
  if (!outcome.ok || !outcome.session) {
    return outcome.status === 401 || outcome.status === 403 ? null : undefined;
  }

  const encoded = encodeSession(outcome.session);

  // The current render reads this, not the stale value it arrived with.
  request.cookies.set(CUSTOMER_SESSION_COOKIE, encoded);

  return encoded;
}

/**
 * Paths that need a session, matched after the locale segment.
 *
 * `/partners/join` is here because applying to become a partner requires an account (Bashar,
 * 2026-08-19) — the request is filed AGAINST the signed-in account, so there is nothing for an
 * anonymous visitor to submit.
 *
 * `/review` is here because writing about a stay is something only the person who took it may do.
 * Without it an anonymous visitor reached the page and got a "session expired" panel rendered with
 * a 200 — which is not wrong, but it is a worse answer than the sign-in redirect every other
 * account page gives, and it makes a booking reference in the URL look like it might mean
 * something to somebody who is not signed in.
 */
const PROTECTED = ['/account', '/review', '/partners/join'];

function isProtected(pathname: string): boolean {
  // Strip a leading locale segment so `/ar/account` and `/account` both match.
  const withoutLocale = pathname.replace(/^\/(ar|en|de)(?=\/|$)/, '');

  return PROTECTED.some(
    (path) => withoutLocale === path || withoutLocale.startsWith(`${path}/`),
  );
}

function localeOf(pathname: string): string {
  return /^\/(ar|en|de)(?=\/|$)/.exec(pathname)?.[1] ?? routing.defaultLocale;
}

/**
 * Whether the request carries a usable session.
 *
 * `rotated === null` means the refresh was rejected and the cookie is being cleared,
 * so the incoming cookie must NOT count — otherwise the one request that discovers a
 * dead session is the one request allowed through with it.
 */
function hasSession(request: NextRequest, rotated: string | null | undefined): boolean {
  if (rotated === null) return false;
  if (typeof rotated === 'string') return true;

  return decodeSession(request.cookies.get(CUSTOMER_SESSION_COOKIE)?.value) !== null;
}

export const config = {
  // Everything except API routes, Next internals and files with an extension.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
