/**
 * The origin this site is served from, as one answer rather than three.
 *
 * `NEXT_PUBLIC_SITE_URL` was read in three places with three shapes: `sitemap.ts` stripped a
 * trailing slash, the invoice PDF route did not, and nothing normalised the value at all. A base
 * URL that disagrees with itself produces `https://safra.sy//ar/…` in one document and
 * `https://safra.sy/ar/…` in another — two addresses for one page, which is precisely what a
 * canonical exists to prevent.
 *
 * The localhost fallback is for development only. In production the variable is set, and a wrong
 * origin here is visible immediately: every canonical on the site names it.
 */
export function siteOrigin(): string {
  return (process.env['NEXT_PUBLIC_SITE_URL'] ?? 'http://localhost:3000').replace(
    /\/+$/,
    '',
  );
}

/**
 * The same value as a `URL`, for `metadataBase`.
 *
 * Next resolves every RELATIVE `alternates.canonical`, `alternates.languages` and `openGraph.url`
 * against this, so setting it once in the locale layout turns the whole site's canonicals absolute
 * without a single page building a string. That is the point: a canonical assembled per page is a
 * canonical that can be forgotten on the next page somebody adds.
 */
export function siteUrl(): URL {
  return new URL(siteOrigin());
}
