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
  /* «إضافة» — a create says create, the same word the three forms on المدن use. */
  await form.getByRole('button', { name: t.sections.geo.create }).click();

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

/**
 * Editing a category opens a POPUP, and its code is fixed (Bashar, 2026-08-30).
 *
 * The code is what the seed, the three catalogues and every existing filter key on, so it is
 * chosen once and shown thereafter. A form under the table pushed the whole list down; the popup
 * is the same `Modal` the country, currency and city editors open into — one shell, so Escape,
 * the focus trap and the scroll lock are not learnt four times.
 */
test('editing a category is a popup, with the code shown and not editable', async ({
  page,
}) => {
  await page.goto('/city-categories');
  await page.locator('[data-category-edit="coastal"]').click();

  const dialog = page.getByRole('dialog');

  await expect(dialog, 'editing a category must open a popup').toBeVisible();

  const form = page.locator('[data-category-form="coastal"]');

  await expect(form.locator('input').first()).toBeDisabled();
  await expect(form.locator('input').first()).toHaveValue('coastal');

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

/**
 * The arrows reorder the list, and the order STICKS.
 *
 * `sort_order` decides the order every picker offers these in — the city editor, the add-city
 * form and the public filter — and it had no control at all: the column existed, the API accepted
 * it, and nothing could write it. Asserted across a RELOAD, because a client-side swap that never
 * reached the database would look identical until somebody came back to the page.
 *
 * It also moves the row BACK, so the spec leaves the order it found. The suite shares one account
 * and one database; a spec that quietly reorders a reference list changes what a later spec sees.
 */
test('the arrows reorder the categories, and the order survives a reload', async ({
  page,
}) => {
  await page.goto('/city-categories');

  const codes = async (): Promise<string[]> =>
    page
      .locator('[data-category-edit]')
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-category-edit') ?? ''),
      );

  const before = await codes();

  test.skip(before.length < 2, 'reordering needs at least two categories.');

  const second = before[1] ?? '';

  await page.locator(`[data-category-up="${second}"]`).click();

  await expect.poll(async () => (await codes())[0], { timeout: 20_000 }).toBe(second);

  await page.reload();
  expect((await codes())[0], 'the new order must have reached the database').toBe(second);

  /* Put it back, so the next spec and the next RUN see the order this one found. */
  await page.locator(`[data-category-down="${second}"]`).click();
  await expect.poll(async () => (await codes())[1], { timeout: 20_000 }).toBe(second);
});

/** The same height complaint as المدن, on this screen — see `geo.spec.ts`. */
test('every field on the category form is the same height', async ({ page }) => {
  await page.goto('/city-categories');
  await page.locator('[data-category-add]').click();

  const heights = await page
    .locator('[data-category-form="add"] input:not([type=checkbox])')
    .evaluateAll((nodes) =>
      nodes.map((node) => Math.round(node.getBoundingClientRect().height)),
    );

  expect(heights.length).toBeGreaterThan(2);
  expect([...new Set(heights)], 'one height, not a height per neighbour').toHaveLength(1);
});
