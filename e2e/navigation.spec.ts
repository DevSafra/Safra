import { expect, test } from '@playwright/test';

import { ar as t } from '../packages/i18n/src/messages/admin/ar.js';
import { MISSING_CREDENTIALS, SKIP_REASON, STAFF_STATE } from './staff.js';

/**
 * Every link in the console goes somewhere real, and every detail screen offers a way back.
 *
 * ## Why a crawl rather than a list of routes
 *
 * `admin-sections.spec.ts` already asserts that the nineteen sections the design specifies exist
 * and render. That checks the routes somebody remembered to write down. This follows the links the
 * pages ACTUALLY render, which is where the rot appears: a row link built from a reference the API
 * stopped returning, a section renamed without its cross-links, a detail screen that renders but
 * strands the reader.
 *
 * Bashar asked for the whole console to be checked after the الشريك card was found returning to
 * the wrong registry (2026-08-06); one broken cross-link is a reason to doubt the rest.
 *
 * ## What counts as broken
 *
 * A 404 or a 5xx, an `href` that leaves the console, and a detail screen with no back control.
 * Everything is collected before asserting, so one run names every broken link rather than
 * stopping at the first.
 */
test.skip(MISSING_CREDENTIALS, SKIP_REASON);
test.use({ storageState: STAFF_STATE, viewport: { width: 1440, height: 900 } });

/** Every section reachable from the sidebar, plus the dashboard. */
const SECTIONS = [
  '/',
  '/bookings',
  '/partners',
  '/properties',
  '/customers',
  '/staff',
  '/payments',
  '/wallet',
  '/giftcards',
  '/coupons',
  '/ads',
  '/disputes',
  '/messages',
  '/comms',
  '/geo',
  '/reports',
  '/settings',
  '/audit',
  '/emergency',
] as const;

/**
 * A route SHAPE, so twenty booking rows are crawled once rather than twenty times.
 *
 * The interesting failure is "this kind of link is broken", not "this row is broken", and visiting
 * every row of every registry would take minutes to prove the same thing.
 */
function shape(pathname: string): string {
  return pathname.replace(/\/[A-Z]{3}-[A-Za-z0-9-]+/g, '/:reference');
}

test.describe('console navigation', () => {
  test('every link on every section resolves, and none leaves the console', async ({
    page,
  }) => {
    const seen = new Set<string>();
    const broken: string[] = [];
    const external: string[] = [];
    const queue: { href: string; from: string }[] = [];

    for (const section of SECTIONS) {
      await page.goto(section);

      const hrefs = await page
        .locator('a[href]')
        .evaluateAll((anchors) =>
          anchors.map((anchor) => anchor.getAttribute('href') ?? ''),
        );

      for (const href of hrefs) {
        // A link that is not a same-origin path is the thing being checked for, not crawled.
        if (/^[a-z]+:/i.test(href) || href.startsWith('//')) {
          external.push(`${section} → ${href}`);
          continue;
        }

        if (!href.startsWith('/') || href.startsWith('/api/')) continue;

        const url = new URL(href, 'https://console.test');
        const key = shape(url.pathname);

        if (seen.has(key)) continue;

        seen.add(key);
        queue.push({ href, from: section });
      }
    }

    /*
      Fetched rather than navigated to. `page.goto` throws on `/bookings/export`, which answers
      with a CSV attachment — a perfectly good link that a navigation cannot land on. The request
      carries this context's session cookies, so it is the same authorisation the reader has, and
      it is an order of magnitude faster than rendering every route.

      A 200 does not prove a page is CORRECT — Next renders an error boundary with a 200 — so this
      is the floor. The section and detail specs assert what the pages actually contain.
    */
    for (const { href, from } of queue) {
      const response = await page.request.get(href, { maxRedirects: 5 });

      if (response.status() >= 400) {
        broken.push(`${from} → ${href} (${response.status()})`);
      }
    }

    expect(external).toStrictEqual([]);
    expect(broken).toStrictEqual([]);

    // A crawl that found almost nothing would pass while proving nothing.
    expect(seen.size).toBeGreaterThan(SECTIONS.length);
  });

  /**
   * Every detail screen has a back control, whichever way it was reached.
   *
   * Including via a cross-link, which is the case that was broken: the control was there, it just
   * went to the wrong place. So this checks it EXISTS and the next test checks where it goes.
   */
  test('no detail screen strands the reader', async ({ page }) => {
    const stranded: string[] = [];

    for (const [section, pattern] of [
      ['/bookings', /\/bookings\/BKG/],
      ['/partners', /\/partners\/PAR/],
      ['/properties', /\/properties\/PRO/],
    ] as const) {
      await page.goto(`${section}?size=5`);
      await page.locator('tbody tr a').first().click();
      await page.waitForURL(pattern);

      const back = page.locator('a[aria-label^="الرجوع"]');

      if ((await back.count()) === 0) stranded.push(`${page.url()} has no back control`);
    }

    // The thread screen is a `<ul>` of cards, so its rows are not `tbody tr`.
    await page.goto('/messages?size=5');

    const thread = page.locator('ul a[href^="/messages/"]').first();

    if ((await thread.count()) > 0) {
      await thread.click();
      await page.waitForURL(/\/messages\/.+/);

      if ((await page.locator('a[aria-label^="الرجوع"]').count()) === 0) {
        stranded.push(`${page.url()} has no back control`);
      }
    }

    expect(stranded).toStrictEqual([]);
  });

  /**
   * A cross-link into a detail screen names where it came from, and the way back honours it.
   *
   * Swept over every registry that links OUT, rather than only the two cards Bashar reported. The
   * defect was one missing parameter on one link, and nothing about it was specific to bookings.
   */
  test('every cross-link comes back to the screen it was opened from', async ({
    page,
  }) => {
    const wrong: string[] = [];

    /** Each: the screen with the outbound link, a locator for it, and where back should land. */
    const crossings = [
      {
        from: '/properties?size=10',
        link: 'td a[href^="/partners/"]',
        back: /^\/properties/,
        name: 'the العقارات partner column',
      },
      {
        from: '/disputes',
        link: 'a[href^="/bookings/"]',
        back: /^\/disputes/,
        name: 'the النزاعات booking link',
      },
      {
        from: '/',
        link: 'a[href^="/partners/"]',
        back: /^\/$/,
        name: 'the dashboard partner queue',
      },
    ] as const;

    for (const crossing of crossings) {
      await page.goto(crossing.from);

      const link = page.locator(crossing.link).first();

      if ((await link.count()) === 0) continue;

      await link.click();
      await page.waitForURL(/\/(partners|bookings)\/[A-Z]{3}-/);

      const back = page.locator('a[aria-label^="الرجوع"]').first();
      const href = (await back.getAttribute('href')) ?? '';
      const pathname = new URL(href, 'https://console.test').pathname;

      if (!crossing.back.test(pathname)) {
        wrong.push(`${crossing.name}: back goes to ${pathname}`);
      }
    }

    expect(wrong).toStrictEqual([]);
  });

  /**
   * A status wears one colour and speaks Arabic, on every screen that draws it.
   *
   * Bashar's instruction (2026-08-06). Before it, eleven tone functions and four hand-rolled pills
   * disagreed — `expired` was red in الدفع, grey in الإعلانات and amber in بطاقات الهدايا.
   *
   * Collected across all nineteen sections and asserted at the end, so one run names every
   * disagreement rather than stopping at the first. The comparison is the PAINTED colour, because
   * a class name can match while the paint does not.
   */
  test('one status is one colour, in Arabic, across every section', async ({ page }) => {
    /** status text → the colour it was first seen in, and where. */
    const seen = new Map<string, { color: string; where: string }>();
    const clashes: string[] = [];
    const sameScreen: string[] = [];
    const latin: string[] = [];

    for (const section of SECTIONS) {
      await page.goto(section);

      const pills = await page.locator('[data-status-pill]').evaluateAll((nodes) =>
        nodes.map((node) => ({
          text: (node.textContent ?? '').trim(),
          color: getComputedStyle(node).color,
        })),
      );

      for (const pill of pills) {
        if (!pill.text) continue;

        /*
          A pill whose text is a run of Latin letters is an untranslated enum. Brands are allowed —
          «Visa», «Sham Cash» — and are capitalised, so the test looks for the lower_snake_case
          shape an enum actually has.
        */
        if (/^[a-z][a-z_ ]*$/.test(pill.text)) latin.push(`${section}: ${pill.text}`);

        const first = seen.get(pill.text);

        if (first === undefined) {
          seen.set(pill.text, { color: pill.color, where: section });
        } else if (first.color !== pill.color) {
          clashes.push(
            `«${pill.text}» is ${first.color} on ${first.where} and ${pill.color} on ${section}`,
          );
        }
      }

      /*
        The other direction, and the one Bashar reported: on THIS screen, two different statuses
        must not look the same. Checked per section rather than globally — `confirmed` and
        `resolved` are both green and never appear together, which is fine and is what keeps the
        palette to fourteen colours instead of thirty-five.
      */
      const byColour = new Map<string, Set<string>>();

      for (const pill of pills) {
        if (!pill.text) continue;

        byColour.set(pill.color, (byColour.get(pill.color) ?? new Set()).add(pill.text));
      }

      for (const [color, texts] of byColour) {
        if (texts.size > 1) {
          sameScreen.push(`${section}: ${[...texts].join(' / ')} are all ${color}`);
        }
      }
    }

    expect(latin).toStrictEqual([]);
    expect(clashes).toStrictEqual([]);
    expect(sameScreen).toStrictEqual([]);

    // A sweep that found no pills would pass while proving nothing.
    expect(seen.size).toBeGreaterThan(5);
  });

  /**
   * The sidebar reaches every section, and marks the one being read.
   *
   * A nav that does not say where you are is a navigation bug too — it is the only orientation the
   * console offers once a detail screen has no breadcrumb.
   */
  test('the sidebar reaches every section and marks the current one', async ({
    page,
  }) => {
    await page.goto('/bookings');

    const links = page.locator(`#${'console-nav'} a[href]`);

    expect(await links.count()).toBeGreaterThanOrEqual(SECTIONS.length - 1);

    const current = page.locator(`#${'console-nav'} a[aria-current="page"]`);

    await expect(current).toHaveCount(1);
    await expect(current).toHaveAttribute('href', '/bookings');
    // `toContainText`: the link also carries its queue count badge, «الحجوزات 45».
    await expect(current).toContainText(t.nav.bookings);
  });
});

/**
 * Rows per page: ten by default, and a change is remembered against the ACCOUNT.
 *
 * Bashar's instruction (2026-08-06). The account part is the half a unit test cannot reach — it
 * spans a form POST, an API write, a database column and a later render, and every one of those
 * is a place the value can be dropped silently and leave a table that simply looks fine.
 */
test.describe('rows per page', () => {
  /** Restored afterwards, so this test does not leave the seed account on a different size. */
  const SECTIONS = ['/bookings', '/partners', '/properties', '/payments'] as const;

  test('every table starts at ten rows', async ({ page }) => {
    const wrong: string[] = [];

    /*
      Reset first, because the size is now saved against the ACCOUNT and this suite shares one —
      `pagination.spec.ts` submits the bar, so a previous run can leave a section on fifty and this
      test would fail for a reason that has nothing to do with the default. Resetting is not
      cheating: a stored ten and a stored nothing render identically, which is the property being
      checked. What ten IS, is pinned deterministically in `table-preferences.test.ts`.
    */
    for (const section of SECTIONS) {
      await page.request.post('/api/table-page-size', {
        form: { section: section.slice(1), size: '10' },
      });
    }

    for (const section of SECTIONS) {
      await page.goto(section);

      const rows = await page.locator('tbody tr').count();
      const chosen = await page.getByLabel(t.table.pageSizeLabel).first().inputValue();

      if (chosen !== '10') wrong.push(`${section}: the size control reads ${chosen}`);
      if (rows > 10) wrong.push(`${section}: rendered ${rows} rows`);
    }

    expect(wrong).toStrictEqual([]);
  });

  /**
   * The whole round trip: change it, leave, come back, and it is still what was chosen.
   *
   * Navigating AWAY and back is the point — re-reading the same URL would pass on a value that
   * only ever lived in the query string.
   */
  test('remembers a change on the account, per table', async ({ page }) => {
    await page.goto('/bookings');
    await page.getByLabel(t.table.pageSizeLabel).first().selectOption('50');
    await page.getByRole('button', { name: t.table.apply }).first().click();
    await page.waitForURL(/\/bookings/);

    // Away, and back with no query string at all.
    await page.goto('/partners');
    await page.goto('/bookings');

    await expect(page.getByLabel(t.table.pageSizeLabel).first()).toHaveValue('50');

    // Per table: الشركاء was never changed, so it is still ten.
    await page.goto('/partners');
    await expect(page.getByLabel(t.table.pageSizeLabel).first()).toHaveValue('10');

    // Put it back, so the run leaves the account as it found it.
    await page.goto('/bookings');
    await page.getByLabel(t.table.pageSizeLabel).first().selectOption('10');
    await page.getByRole('button', { name: t.table.apply }).first().click();
    await page.waitForURL(/\/bookings/);

    await page.goto('/bookings');
    await expect(page.getByLabel(t.table.pageSizeLabel).first()).toHaveValue('10');
  });

  /**
   * A `?size=` in the URL still wins, so a shared link looks the same to both people.
   *
   * And it does NOT overwrite the preference: following somebody's link is not choosing anything.
   */
  test('a shared link wins without changing what was saved', async ({ page }) => {
    await page.goto('/bookings?size=25');

    await expect(page.getByLabel(t.table.pageSizeLabel).first()).toHaveValue('25');

    await page.goto('/bookings');

    await expect(page.getByLabel(t.table.pageSizeLabel).first()).toHaveValue('10');
  });
});
