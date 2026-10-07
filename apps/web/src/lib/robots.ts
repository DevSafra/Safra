import type { MetadataRoute } from 'next';

/**
 * What `/robots.txt` says, decided from the deployment rather than written for one (audit
 * 2026-10-06).
 *
 * ## There was no robots.txt at all
 *
 * `/robots.txt` answered 404, so a crawler had no sitemap link to follow and nothing to keep it out
 * of a staging host.
 *
 * ## Production and staging, without naming a domain
 *
 * The real domain is not decided, so nothing here contains one. The ORIGIN comes from
 * `NEXT_PUBLIC_SITE_URL` through `siteOrigin()`, the same value every canonical and the sitemap are
 * built from, and two things decide whether this deployment may be crawled:
 *
 * - **A local or plain-http origin is never indexable.** `localhost`, `127.0.0.1` and a bare `http:`
 *   address are development, whatever else is set.
 * - **`SITE_INDEXING=off` closes any other deployment.** Staging sets it; production does not.
 *
 * The default for a real https origin is OPEN, deliberately. The two failures are not symmetric: a
 * staging host left crawlable is a duplicate that its own canonicals (which name the staging origin)
 * keep separate, while a production site shipped with «Disallow: /» is invisible to every search
 * engine until somebody notices, and nobody looks at a robots.txt that is working. So the safe
 * mistake is the one a missing variable produces.
 *
 * ## What an open deployment still keeps crawlers out of
 *
 * Paths that are private by nature or carry a credential in the URL: the account, the checkout, a
 * booking reached by its access link, the payment return, review links, password reset and email
 * verification, and the internal API routes. They are `noindex` or behind a session already; this
 * stops a crawler spending its budget on them. `/search` stays crawlable on purpose: it answers
 * `noindex, follow`, and a crawler that cannot fetch it cannot follow its links either.
 */
const PRIVATE_PATHS = [
  '/api/',
  '/*/api/',
  '/*/account',
  '/*/checkout',
  '/*/booking/',
  '/*/payments/',
  '/*/review/',
  '/*/reset-password',
  '/*/verify-email',
];

/** Whether this origin is a development address no crawler should ever be pointed at. */
function isLocalOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);

    return (
      url.protocol !== 'https:' ||
      url.hostname === 'localhost' ||
      url.hostname.endsWith('.localhost') ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '[::1]'
    );
  } catch {
    /* An origin that does not parse is not one anybody should be indexing. */
    return true;
  }
}

export function robotsPolicy(
  origin: string,
  indexing: string | undefined,
): MetadataRoute.Robots {
  if (isLocalOrigin(origin) || indexing?.trim().toLowerCase() === 'off') {
    return { rules: { userAgent: '*', disallow: '/' } };
  }

  return {
    rules: { userAgent: '*', allow: '/', disallow: PRIVATE_PATHS },
    sitemap: `${origin}/sitemap.xml`,
  };
}
