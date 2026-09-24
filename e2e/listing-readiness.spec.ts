import { expect, test } from '@playwright/test';

import { LISTING_READINESS_CHECKS } from '../packages/contracts/src/readiness.js';
// The catalogue source directly — see the note in `admin-sections.spec.ts` about CommonJS.
import { ar as t } from '../packages/i18n/src/messages/admin/ar.js';
import { MISSING_CREDENTIALS, SKIP_REASON, STAFF_STATE } from './staff.js';

/**
 * العقارات: «الاكتمال», and the filter staff use to work through what listings are missing.
 *
 * ## Why this is driven rather than trusted
 *
 * `listing-readiness.integration.test.ts` proves the service filters and counts correctly. It
 * cannot see any of what this asserts: that the column reached the table, that the select offers
 * every check the contract defines, that choosing one survives the round trip, and — the one that
 * has bitten this codebase repeatedly — that the filter is carried by the PAGER. A filter the
 * arrows drop leaves the reader believing they are on page two of the listings with no
 * photograph, and on page two of all 2,017.
 *
 * ## It asserts the SHAPE, not the numbers
 *
 * The seed changes whenever the integration suite runs, so a pinned count would fail every morning
 * for a reason unrelated to the console. What is pinned is that each filter returns only rows
 * claiming that gap, and that the totals move when the filter does.
 */
test.skip(MISSING_CREDENTIALS, SKIP_REASON);

test.use({ storageState: STAFF_STATE, baseURL: 'http://localhost:3001' });

const REGISTRY = '/properties';

test('the registry names what each listing is missing', async ({ page }) => {
  await page.goto(REGISTRY);

  await expect(
    page.getByText(t.sections.properties.colOnMap, { exact: true }).first(),
  ).toBeVisible();
  await expect(page.locator('select[name="gap"]')).toBeVisible();
});

/**
 * The select offers every check the CONTRACT defines.
 *
 * Driven from `LISTING_READINESS_CHECKS` rather than a hand-copied list, so a fifth check that
 * reaches the API and not this select fails here — which is the whole failure mode of a filter
 * built from a list somebody has to remember to extend.
 */
test('the filter offers every check, plus «any»', async ({ page }) => {
  await page.goto(REGISTRY);

  const values = await page
    .locator('select[name="gap"] option')
    .evaluateAll((options) => options.map((one) => (one as HTMLOptionElement).value));

  expect(values).toContain('');
  expect(values).toContain('any');
  for (const check of LISTING_READINESS_CHECKS) {
    expect(values, `the filter must offer ${check}`).toContain(check);
  }
});

for (const check of LISTING_READINESS_CHECKS) {
  test(`filtering by ${check} shows only listings claiming it`, async ({ page }) => {
    await page.goto(`${REGISTRY}?gap=${check}`);

    const cells = page.locator('[data-gaps]');

    await expect(cells.first()).toBeVisible();

    /*
      `data-gaps` rather than the words: the same sentences are the filter's own `<option>` list,
      and an assertion written against the TEXT matched fourteen selects before it matched a row.
    */
    const claimed = await cells.evaluateAll((els) =>
      els.map((one) => one.getAttribute('data-gaps') ?? ''),
    );

    expect(claimed.length).toBeGreaterThan(0);
    for (const row of claimed) {
      expect(row.split(' '), `a row under gap=${check} claimed "${row}"`).toContain(
        check,
      );
    }
  });
}

test('«any» shows only listings with something missing', async ({ page }) => {
  await page.goto(`${REGISTRY}?gap=any`);

  const claimed = await page
    .locator('[data-gaps]')
    .evaluateAll((els) => els.map((one) => one.getAttribute('data-gaps') ?? ''));

  expect(claimed.length).toBeGreaterThan(0);
  for (const row of claimed) {
    expect(row, 'a complete listing was shown under gap=any').not.toBe('none');
  }
});

/**
 * The total must move with the filter.
 *
 * Expressed without pinning a number: whatever the seed holds, a registry where the unfiltered
 * total and a filtered one read the same is one whose count is ignoring the filter — the defect
 * the standing rule on tables calls worse than showing no total at all.
 */
test('the total follows the filter', async ({ page }) => {
  const totalOn = async (url: string) => {
    await page.goto(url);

    /* `data-table-total`, which the bar carries so a sweep finds the TOTAL and nothing else. */
    return (await page.locator('[data-table-total]').first().innerText()).trim();
  };

  const all = await totalOn(REGISTRY);
  const any = await totalOn(`${REGISTRY}?gap=any`);
  const unit = await totalOn(`${REGISTRY}?gap=unit`);

  expect(all, 'the registry must state a total').not.toBe('');
  expect(any, 'gap=any and no filter must not report the same total').not.toBe(all);
  expect(unit, 'gap=unit and gap=any must not report the same total').not.toBe(any);
});

test('paging keeps the filter', async ({ page }) => {
  await page.goto(`${REGISTRY}?gap=photograph`);

  await expect(page.locator('a[href*="gap=photograph"]').first()).toBeAttached();
  await expect(
    page.locator('form input[name="gap"], form select[name="gap"]').first(),
  ).toBeAttached();
});

/**
 * A crafted value renders the registry, it does not break it.
 *
 * The API's schema is `.strict()` and answers 400 to an unknown value, which is right for an API
 * and wrong for a page — so the console narrows the parameter before it ever reaches a request.
 */
test('a crafted filter value falls back to showing everything', async ({ page }) => {
  const response = await page.goto(`${REGISTRY}?gap=banana`);

  expect(response?.status()).toBe(200);
  await expect(page.locator('select[name="gap"]')).toHaveValue('');
});
