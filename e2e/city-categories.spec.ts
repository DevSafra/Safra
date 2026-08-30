import { expect, test } from '@playwright/test';

import { ar as t } from '../packages/i18n/src/messages/admin/ar.js';
import { MISSING_CREDENTIALS, SKIP_REASON, STAFF_STATE } from './staff.js';

/**
 * الفئات — city categories on their own screen (Bashar, 2026-08-30).
 *
 * ## What a browser adds
 *
 * `geo-category.integration.test.ts` proves the writes and their audit rows against a real
 * database. What it cannot see is the thing this feature is FOR: that a category added on this
 * page becomes selectable on a city. Both halves were hardcoded four-member lists — a `pgEnum` in
 * the schema and a `const` in the editor — so a page that created rows nothing could select would
 * have looked complete and changed nothing.
 *
 * ## It leaves a category behind, deliberately
 *
 * Categories are retired rather than deleted, so a spec cannot tidy up after itself. The code
 * carries a random suffix so repeated runs do not collide; `db:testbed` clears them.
 */
test.skip(MISSING_CREDENTIALS, SKIP_REASON);
test.use({ storageState: STAFF_STATE });

const c = t.sections.cityCategories;

test('sits under المدن in the sidebar, and lists the categories with their cities', async ({
  page,
}) => {
  await page.goto('/geo');

  const links = await page.locator('.console-sidebar nav a').allInnerTexts();
  const geo = links.findIndex((one) => one.includes(t.nav.geo));

  expect(geo, 'المدن is in the nav').toBeGreaterThan(-1);
  /* Directly under it: a category is a property OF a city, and the order says so. */
  expect(links[geo + 1]).toContain(t.nav.cityCategories);

  await page.locator('.console-sidebar nav a[href="/city-categories"]').click();
  await page.waitForURL(/city-categories/);

  const table = page.locator('table');

  await expect(table).toContainText('coastal');
  await expect(table).toContainText('ساحلية');
  /* The city count is what makes retiring one a visible decision rather than a flag. */
  await expect(table).toContainText(c.colCities);
});

/**
 * A category added here is selectable on a city — the whole point of the page.
 *
 * It has no `city_category` enum member and never will, so it exists in `city_category_links`
 * alone. The editor read a four-member `const` until this shipped, which would have made the page
 * a screen that creates rows nothing can use.
 */
test('a category added here can be put on a city', async ({ page }) => {
  const code = `probe-${Math.random().toString(36).slice(2, 7)}`;
  const name = `فئة ${code}`;

  await page.goto('/city-categories');
  await page.locator('[data-category-add]').click();

  const form = page.locator('[data-category-form="add"]');
  const fields = form.locator('input');

  await fields.nth(0).fill(code);
  await fields.nth(1).fill(name);
  await fields.nth(2).fill('Probe');
  await fields.nth(3).fill('Probe');
  await form.getByRole('button', { name: t.sections.geo.save }).click();

  await expect(page.locator(`[data-category-edit="${code}"]`)).toBeVisible({
    timeout: 20_000,
  });

  /* And it reaches the city editor, by the name it was given. */
  await page.goto('/geo');
  await page.locator('[data-city-edit="damascus"]').click();

  const option = page.locator(`[data-category-option="${code}"]`);

  await expect(option, 'a new category must be selectable on a city').toBeVisible();
  await expect(page.locator('[data-city-form="damascus"]')).toContainText(name);
});
