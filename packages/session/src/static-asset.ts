/**
 * Whether a request is for a file the app ships as-is, which the middleware has no business with.
 *
 * ## Why this replaced `.*\..*` in the matcher
 *
 * All three apps excluded every path containing a DOT from the middleware, a shorthand for "a
 * static file". But a dot is ordinary in a route segment: `/bookings/BKG.1`, `/partners/a.b`, a
 * typed or tampered URL. Each of those rendered a page with no session check, no refresh and no
 * Content-Security-Policy, because the middleware is where the nonce and the header are made
 * (go-live audit, 2026-10-06). The pages still authorise their own reads, so the exposure was the
 * missing headers rather than data, and that is precisely the defence a page should never lose to
 * the shape of its URL.
 *
 * So the test is now WHAT the file is, not whether a dot appears: a named public directory with a
 * file name that has an extension, or one of the few files Next serves from the root. Anything
 * else goes through the middleware, dot or no dot.
 */
const PUBLIC_DIRECTORIES = ['map', 'payments'] as const;

/** The metadata files Next serves from the app root (`app/icon.png`, `app/robots.ts`, …). */
const ROOT_FILES = new Set([
  '/favicon.ico',
  '/icon.png',
  /* The favicon since the logo of 2026-10-07: his pin on a night tile, as vector. */
  '/icon.svg',
  '/apple-icon.png',
  '/robots.txt',
  '/sitemap.xml',
]);

const PUBLIC_FILE = new RegExp(
  `^/(?:${PUBLIC_DIRECTORIES.join('|')})/(?:[A-Za-z0-9_-]+/)*[A-Za-z0-9_.-]+\\.[A-Za-z0-9]+$`,
);

export function isStaticAsset(pathname: string): boolean {
  return ROOT_FILES.has(pathname) || PUBLIC_FILE.test(pathname);
}

/**
 * The middleware matcher for all three apps: everything except Next's own assets and the API
 * routes, which answer for themselves. Static files are then let through by `isStaticAsset`
 * inside the middleware, where the decision can be tested. Next requires `config.matcher` to be
 * a literal it can read at build time, so each app writes this string out; `static-asset.test.ts`
 * holds the three copies to it.
 */
export const MIDDLEWARE_MATCHER = '/((?!api/|_next/|_vercel/).*)';
