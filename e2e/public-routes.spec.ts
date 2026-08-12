import { expect, test } from '@playwright/test';

/**
 * Every public customer route answers, and none of them 500s.
 *
 * ## Why this exists
 *
 * All nine city pages returned **500 in production** — every locale, every city — and both suites were
 * green throughout. `pnpm verify` is HTTP-level against the API and never renders a page; `pnpm e2e`
 * requested the home page, search, login, register and one property, and no spec had ever asked for a
 * city page. A whole indexable route was broken and nothing noticed (2026-08-12).
 *
 * The cause was specific — `generateStaticParams` on a route whose layout reads `headers()` for the CSP
 * nonce — but the GAP was general: nothing asserted that the public site's own links go anywhere. So
 * this crawls rather than listing paths, which is what `navigation.spec.ts` already does for the console:
 * a test written against a fixed list only ever covers what somebody remembered.
 *
 * ## It signs in for nothing
 *
 * Public routes only, so it costs nothing from the sign-in budget that shapes the rest of this suite. A
 * link into حسابي redirects to the login page, and a redirect is a perfectly good answer — what this
 * refuses to accept is a 4xx or 5xx.
 */
test.use({ baseURL: 'http://localhost:3000' });

/** Where the crawl starts. Arabic, because it is the default locale and the RTL rendering path. */
const ROOTS = ['/ar', '/ar/search'];

/**
 * A ceiling, so a content change cannot turn this into a hundred-request test.
 *
 * If it is ever hit, the log line below says so rather than the suite quietly covering less than it
 * appears to — a silent cap reads as "everything passed".
 */
const MAX_PAGES = 40;

/**
 * Links the public site offers to pages that do not exist yet.
 *
 * Both are PRODUCT gaps rather than faults, and both are recorded in `docs/FUTURE-WORK.md` — the home
 * page's «سجّل كشريك» call to action and the property page's report-a-listing link. They are listed here
 * rather than skipped so that the crawl still fails the moment a NEW dead link appears: an unexplained
 * exclusion would grow quietly into "the crawl passes and half the site 404s".
 *
 * Deleting an entry from this list is how the fix gets noticed.
 */
const KNOWN_MISSING = new Set(['/ar/partner', '/ar/support']);

test.describe('public routes', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('every link the public site offers resolves', async ({ page, baseURL }) => {
    const seen = new Set<string>();
    const queue: string[] = [...ROOTS];
    const broken: string[] = [];
    let visited = 0;

    while (queue.length > 0 && visited < MAX_PAGES) {
      const path = queue.shift() as string;

      if (seen.has(path)) continue;

      seen.add(path);
      visited += 1;

      const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
      const status = response?.status() ?? 0;

      /*
        A redirect is fine — a link into حسابي sends a signed-out visitor to sign in, which is the
        correct behaviour rather than a fault. Anything from 400 up is not.
      */
      if (status >= 400) {
        if (!KNOWN_MISSING.has(path)) broken.push(`${path} → ${status}`);

        continue;
      }

      /* Collect further internal links, same origin and same locale prefix only. */
      /*
        `Array.from`, not a spread: the e2e tsconfig targets a library without `NodeList` iteration, so
        spreading a `NodeListOf<Element>` does not typecheck even though every browser supports it.
      */
      const links = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a[href]'))
          .map((a) => (a as HTMLAnchorElement).href)
          .filter((href) => href.startsWith(location.origin))
          .map((href) => new URL(href).pathname),
      );

      for (const link of links) {
        /* One locale, and no endless pagination or fragment loops. */
        if (!link.startsWith('/ar')) continue;
        if (!seen.has(link) && !queue.includes(link)) queue.push(link);
      }
    }

    /* What was actually covered, so a passing run cannot be mistaken for a complete one. */
    console.log(
      `public crawl: ${visited} page(s)${queue.length > 0 ? `, ${queue.length} left unvisited at the ${MAX_PAGES}-page ceiling` : ''}`,
    );

    expect(broken, 'these public routes did not resolve').toStrictEqual([]);

    /*
      A crawl that found almost nothing would pass while proving nothing. The site has a home page,
      search, city pages and property pages, so anything under ten means the crawl itself broke.
    */
    expect(visited, 'the crawl covered too little to be meaningful').toBeGreaterThan(9);

    /*
      The known-missing list must stay accurate in BOTH directions. If one of those pages gets built,
      this fails and the entry comes out — otherwise the list rots into a permanent excuse.
    */
    for (const missing of KNOWN_MISSING) {
      const response = await page.goto(missing, { waitUntil: 'domcontentloaded' });

      expect(
        response?.status(),
        `${missing} now resolves — remove it from KNOWN_MISSING`,
      ).toBeGreaterThanOrEqual(400);
    }

    /* And the city pages specifically, because that is the route this test was written for. */
    const cityPages = [...seen].filter((p) => p.includes('/city/'));

    expect(cityPages.length, 'the crawl never reached a city page').toBeGreaterThan(0);
    void baseURL;
  });
});
