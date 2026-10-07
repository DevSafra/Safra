import { expect, test, type Page } from '@playwright/test';

import ar from '../packages/i18n/src/messages/web/ar.json' with { type: 'json' };

/**
 * «عرض المزيد» and the sidebar badges on the customer's account (Bashar, 2026-10-07).
 *
 * Two things only a browser can see. The list must GROW in place: the rows on screen stay, the
 * next ones join them, and the page does not move. And every sidebar badge sits at the far end
 * of its row, the way the console draws them; it sat beside its label because the badge carried
 * `dir="ltr"`, which flipped which side its `ms-auto` margin was on.
 *
 * Favourites are the list: the one a test can fill without touching money or another person, and
 * through the site's own route, so the rows are real. Only the ones this test added are removed.
 */
const WEB = 'http://localhost:3000';
const API = 'http://localhost:4000/api/v1';
const PASSWORD = process.env.TESTBED_PASSWORD ?? 'a-testbed-password-1';

test.use({ baseURL: WEB });

async function signIn(page: Page) {
  await page.goto('/ar/login?next=%2Far%2Faccount');
  await page.locator('input[type="email"]').first().fill('customer@safra.test');
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.locator('form button[type="submit"]').first().click();
  await page.waitForURL(/\/ar\/account/);
}

/** Twenty published stays, from the public search, a month out so they are bookable. */
async function slugsToSave(page: Page): Promise<string[]> {
  const day = (offset: number) =>
    new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const response = await page.request.get(
    `${API}/search?checkIn=${day(30)}&checkOut=${day(32)}&adults=1&limit=20`,
  );
  const body = (await response.json()) as { items?: { slug: string }[] };

  return (body.items ?? []).map((item) => item.slug);
}

test('a long list grows in place, and every badge sits at the end of its row', async ({
  page,
}) => {
  await signIn(page);

  /* ── The badges ─────────────────────────────────────────────────────────── */
  const placement = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('aside nav a')).flatMap((row) => {
      const badge = row.querySelector<HTMLElement>('span.rounded-full');

      if (!badge) return [];

      const rowBox = row.getBoundingClientRect();
      const badgeBox = badge.getBoundingClientRect();

      /* RTL: the end of the row is its LEFT edge, inside the row's own padding. */
      return [Math.round(badgeBox.left - rowBox.left)];
    }),
  );

  test.skip(placement.length === 0, 'This account shows no badge to place.');
  for (const gap of placement)
    expect(gap, 'badge at the far end of its row').toBeLessThan(20);

  /* ── «عرض المزيد» ───────────────────────────────────────────────────────── */
  const added: string[] = [];

  try {
    for (const slug of await slugsToSave(page)) {
      const status = await page.request.get(`/ar/api/favourites?slug=${slug}`);

      if (((await status.json()) as { saved?: boolean }).saved) continue;

      const saved = await page.request.post('/ar/api/favourites', {
        data: { slug },
        headers: { origin: WEB },
      });

      if (saved.ok()) added.push(slug);
    }

    await page.goto('/ar/account/favourites');

    const rows = page.locator('[data-favourite]');
    const more = page.getByRole('link', { name: ar.account.loadMore });

    test.skip(
      (await more.count()) === 0,
      'Fifteen favourites or fewer; nothing more to show.',
    );

    /* The first screenful is exactly one step. */
    await expect(rows).toHaveCount(15);

    const before = await rows.evaluateAll((items) =>
      items.map((item) => item.getAttribute('data-favourite')),
    );

    await more.scrollIntoViewIfNeeded();

    const scrolled = await page.evaluate(() => window.scrollY);

    await more.click();
    await page.waitForURL(/shown=30/);
    await expect(rows).not.toHaveCount(15);

    const after = await rows.evaluateAll((items) =>
      items.map((item) => item.getAttribute('data-favourite')),
    );

    /* Grown, not replaced: the same fifteen first, in order, then new ones, none twice. */
    expect(after.slice(0, 15)).toStrictEqual(before);
    expect(after.length).toBeGreaterThan(15);
    expect(new Set(after).size).toBe(after.length);

    /* And the reader is where they were: the new rows arrive below them. */
    expect(Math.abs((await page.evaluate(() => window.scrollY)) - scrolled)).toBeLessThan(
      4,
    );

    /* `replace`, not `push`: back leaves the list rather than stepping through its lengths. */
    await page.goBack();
    await expect(page).not.toHaveURL(/favourites/);
  } finally {
    for (const slug of added) {
      await page.request.delete('/ar/api/favourites', {
        data: { slug },
        headers: { origin: WEB },
      });
    }
  }
});
