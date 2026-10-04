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

/**
 * Client-side navigation actually works — no page may fall back to a full browser load.
 *
 * `upgrade-insecure-requests` was emitted whenever the BUILD was production, which `pnpm start` is.
 * Served over plain `http://localhost` the directive rewrote Next's own RSC payload fetches to
 * `https://`, where nothing listens: every fetch failed with `ERR_SSL_PROTOCOL_ERROR` and every
 * link silently became a full page load. Reported as a language switch changing the theme and
 * losing the page (Bashar, 2026-08-18) — a full navigation re-derives `data-theme` and the footer's
 * pathname, so the switch was the trigger rather than the cause.
 *
 * Invisible to `pnpm verify` by construction: every page still returned 200 the whole time. Only a
 * browser sees the console error and the lost client-side routing, which is why it lives here.
 */
/**
 * The destinations Bashar asked for, in his order, each reaching a real page.
 *
 * «الرئيسية + سياحة علاجية + الإقامات + المدن + جروبات + تواصل معنا» (2026-09-27); «المدن» removed
 * with its page on 2026-10-04.
 *
 * ## Why this is not covered by the crawl above
 *
 * That test follows every link and refuses a 4xx — so it would catch one of these pointing at a
 * route that does not exist, and it is what makes the build fail if somebody adds a seventh item
 * with no page behind it. What it cannot see is an item DISAPPEARING: a nav with five links whose
 * five pages all answer 200 is a passing crawl and a broken instruction.
 *
 * The ORDER is asserted too, and deliberately. سياحة علاجية sits second, ahead of الإقامات, which
 * is not where a search engine would put it — it is where he put it, and that is a business
 * decision about what SAFRA leads with. An assertion is how it survives somebody later
 * «improving» it.
 *
 * ## Read from the markup, not from the catalogue
 *
 * The labels are written out rather than imported from `web/ar.json`. A test that reads the same
 * constant the component renders passes whatever that constant says — including after somebody
 * renames جروبات to something else — which is exactly the change this exists to notice.
 */
test('the navbar carries the five destinations, in order', async ({ page }) => {
  await page.goto('/ar');

  const items = await page
    .locator('header nav a')
    .evaluateAll((links) => links.map((link) => (link.textContent ?? '').trim()));

  expect(items).toStrictEqual([
    'الرئيسية',
    'سياحة علاجية',
    'الإقامات',
    'جروبات',
    'تواصل معنا',
  ]);

  /*
    And the same five on a phone, where they live in the drawer rather than on the bar. The bar is
    `hidden` below `lg`, so a reader on a telephone reaches them only through the menu — a set that
    is complete on a desktop and short on a phone is the failure this second half catches.
  */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page
    .getByRole('button', { name: /القائمة|افتح/ })
    .first()
    .click();

  const inDrawer = await page
    .locator('a')
    .evaluateAll((links) => links.map((link) => (link.textContent ?? '').trim()));

  for (const label of ['الرئيسية', 'سياحة علاجية', 'الإقامات', 'جروبات', 'تواصل معنا']) {
    expect(inDrawer, `«${label}» is reachable on a phone`).toContain(label);
  }
});

/**
 * A popup opened from the STICKY header covers the viewport, not the header.
 *
 * ## The bug
 *
 * Bashar, 2026-09-27: «When I scroll and click on navbar on language the bug appear». At the top of
 * the page the language picker was centred correctly; once the page had scrolled it hung out of the
 * top of the bar.
 *
 * The header gains `backdrop-filter: blur(18px)` when it sticks — the translucent bar he asked for
 * on 2026-09-03 — and **a `backdrop-filter` other than `none` makes an element a containing block
 * for `position: fixed` descendants.** So the popup's `fixed inset-0` backdrop resolved against the
 * header instead of the viewport: measured at 1440×900 it was **1440×84**, and the panel sat at
 * `y = -10`.
 *
 * ## Why it is asserted here rather than in a unit test
 *
 * There is nothing to unit-test. The markup was correct, the classes were correct, and
 * `position: fixed` did exactly what the specification says — against the wrong box. Only a real
 * layout answers it, and only while SCROLLED, which is the state no screenshot of the top of the
 * page contains.
 *
 * ## It asserts the containing block, not the pixel
 *
 * A backdrop the size of the viewport is the whole claim: it is what makes the popup centred, what
 * makes the scrim cover the page, and what makes a click outside close it. Comparing it to
 * `innerHeight` says that in one number, and it would catch any ancestor growing a `transform`,
 * `filter` or `contain` in future — the same fault with a different cause.
 */
test('a popup opened from the stuck header still covers the viewport', async ({
  page,
}) => {
  await page.goto('/ar');

  /* Past the sentinel, so the header is stuck and blurred. */
  await page.evaluate(() => window.scrollTo(0, 900));
  await expect(page.locator('header[data-stuck]')).toBeVisible();

  await page.locator('header [data-menu="language"]').first().click();

  const dialog = page.locator('[role="dialog"]');

  await expect(dialog).toBeVisible();

  const measured = await page.evaluate(() => {
    const panel = document.querySelector('[role="dialog"]');
    const backdrop = panel?.parentElement;
    const box = backdrop?.getBoundingClientRect();

    return {
      backdropHeight: Math.round(box?.height ?? 0),
      panelTop: Math.round(panel?.getBoundingClientRect().top ?? 0),
      viewportHeight: window.innerHeight,
      /* The header must still be COVERED, or the nav is clickable under a modal. */
      overNav: (() => {
        const link = document.querySelector('header nav a');
        const rect = link?.getBoundingClientRect();

        if (!rect) return null;

        const hit = document.elementFromPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
        );

        return hit?.closest('header') ? 'header' : 'overlay';
      })(),
    };
  });

  expect(
    measured.backdropHeight,
    'the backdrop resolved against the header instead of the viewport',
  ).toBe(measured.viewportHeight);

  expect(measured.panelTop, 'the panel is inside the viewport').toBeGreaterThan(0);

  expect(measured.overNav, 'a modal that leaves the navbar clickable is not modal').toBe(
    'overlay',
  );
});

test('navigates on the client, without falling back to a full page load', async ({
  page,
}) => {
  const refused: string[] = [];

  page.on('console', (message) => {
    const text = message.text();

    if (/ERR_SSL_PROTOCOL_ERROR|Failed to fetch RSC payload/i.test(text)) {
      refused.push(text.slice(0, 120));
    }
  });

  await page.goto('/ar', { waitUntil: 'networkidle' });

  /* Follow a few in-app links, which is when the RSC fetches happen. */
  for (const label of ['الإقامات', 'الرئيسية']) {
    const link = page.getByRole('link', { name: label }).first();

    if (await link.count()) {
      await link.click();
      await page.waitForTimeout(1200);
    }
  }

  expect(refused, 'the browser refused Next’s own requests').toStrictEqual([]);

  /*
    And the directive itself: correct over TLS, wrong over plain http. Asserted on the RESPONSE
    rather than on the middleware, because the bug was in the condition rather than in the policy.
  */
  const response = await page.goto('/ar', { waitUntil: 'domcontentloaded' });
  const csp = response?.headers()['content-security-policy'] ?? '';

  expect(csp, 'the policy is still applied').toContain("default-src 'self'");
  expect(csp, 'nothing to upgrade to over http').not.toContain(
    'upgrade-insecure-requests',
  );
});
