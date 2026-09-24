import { expect, test } from '@playwright/test';

// The catalogue source directly — see the note in `admin-sections.spec.ts` about CommonJS.
import { ar as t } from '../packages/i18n/src/messages/admin/ar.js';
import { MISSING_CREDENTIALS, SKIP_REASON, STAFF_STATE } from './staff.js';

/**
 * العقارات: «على الخريطة», and the filter staff use to chase the listings a guest cannot find.
 *
 * ## Why this is driven rather than trusted
 *
 * `property-placement.integration.test.ts` proves the service filters and counts correctly. It
 * cannot see any of what this asserts: that the column reached the table, that the select reached
 * the toolbar, that choosing a value survives the round trip, and — the one that has bitten this
 * codebase repeatedly — that the filter is carried by the PAGER. A filter the arrows drop leaves
 * the reader believing they are on page two of the unplaced listings and on page two of all 2,017.
 *
 * ## It asserts the SHAPE, not the numbers
 *
 * The seed changes whenever the integration suite runs, so «67 unplaced» would fail every morning
 * for a reason unrelated to the console. What is pinned is that the two filters disagree with each
 * other and that every row on each page reads the one word it should.
 */
test.skip(MISSING_CREDENTIALS, SKIP_REASON);

test.use({ storageState: STAFF_STATE, baseURL: 'http://localhost:3001' });

const REGISTRY = '/properties';

test('the registry names whether each listing is on the map', async ({ page }) => {
  await page.goto(REGISTRY);

  await expect(
    page.getByText(t.sections.properties.colOnMap, { exact: true }).first(),
  ).toBeVisible();

  /* The filter is a control, not a URL somebody has to know about. */
  await expect(page.locator('select[name="placed"]')).toBeVisible();
});

test('filtering to unplaced shows only unplaced listings', async ({ page }) => {
  await page.goto(`${REGISTRY}?placed=no`);

  /*
    `[data-on-map]` rather than the words. The same two words are the filter's own options, and an
    assertion written against the TEXT matched fourteen `<option>` elements before it matched a
    single row — a green test measuring the select it had just set.
  */
  await expect(page.locator('[data-on-map="no"]').first()).toBeVisible();
  await expect(page.locator('[data-on-map="yes"]')).toHaveCount(0);
  await expect(page.locator('[data-on-map="no"]').first()).toHaveText(
    t.sections.properties.onMapNo,
  );
});

test('filtering to placed shows only placed listings', async ({ page }) => {
  await page.goto(`${REGISTRY}?placed=yes`);

  await expect(page.locator('[data-on-map="yes"]').first()).toBeVisible();
  await expect(page.locator('[data-on-map="no"]')).toHaveCount(0);
  await expect(page.locator('[data-on-map="yes"]').first()).toHaveText(
    t.sections.properties.onMapYes,
  );
});

/**
 * The two halves must disagree about how many rows there are.
 *
 * This is the count assertion, expressed without pinning a number: whatever the seed holds, a
 * registry where «الكل», «محدَّد» and «غير محدَّد» all report the same total is one whose count is
 * ignoring the filter — the exact defect the standing rule on tables calls worse than no total.
 */
test('the total follows the filter', async ({ page }) => {
  const totalOn = async (url: string) => {
    await page.goto(url);

    /*
      `data-table-total`, which the bar carries for precisely this — matching the Arabic text found
      the page-size control's own «صفًا» first, and the attribute exists so a sweep can find the
      TOTAL and nothing else. There are two paged tables on this route; the registry's is the first.
    */
    return (await page.locator('[data-table-total]').first().innerText()).trim();
  };

  const all = await totalOn(REGISTRY);
  const unplaced = await totalOn(`${REGISTRY}?placed=no`);
  const placed = await totalOn(`${REGISTRY}?placed=yes`);

  expect(all, 'the registry must state a total').not.toBe('');
  expect(unplaced, 'unplaced and all must not report the same total').not.toBe(all);
  expect(placed, 'placed and unplaced must not report the same total').not.toBe(unplaced);
});

/**
 * The pager carries it. This is the failure the standing rule exists to prevent, and it is quiet:
 * nothing looks broken, the reader simply leaves their filter behind at the page boundary.
 */
test('paging keeps the filter', async ({ page }) => {
  await page.goto(`${REGISTRY}?placed=no`);

  const carried = page.locator('a[href*="placed=no"]');

  await expect(carried.first()).toBeAttached();

  /* The form under the table repeats it too, or submitting a page number drops it. */
  await expect(
    page.locator('form input[name="placed"], form select[name="placed"]').first(),
  ).toBeAttached();
});

/**
 * A crafted value renders the registry, it does not break it.
 *
 * The API's schema is `.strict()` and answers 400 to an unknown value, which is right for an API
 * and wrong for a page — so the console narrows the parameter to the two values it accepts before
 * it ever reaches a request. A reader who edits the URL meets a table, not an error.
 */
test('a crafted filter value falls back to showing everything', async ({ page }) => {
  const response = await page.goto(`${REGISTRY}?placed=banana`);

  expect(response?.status()).toBe(200);
  await expect(page.locator('select[name="placed"]')).toHaveValue('');
});
