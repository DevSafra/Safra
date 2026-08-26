import { expect, test } from '@playwright/test';

import { MISSING_CREDENTIALS, SKIP_REASON, STAFF_STATE } from './staff.js';

/**
 * الكوبونات, from the console that creates one to the checkout that spends it.
 *
 * In a BROWSER because `pnpm verify` is HTTP-level: it cannot see a form that never arms, a total
 * that does not fall, or a discount line that renders in the wrong column. The engine is held by
 * the integration suites; this is the half a person meets.
 */
test.describe('creating a coupon', () => {
  test.skip(MISSING_CREDENTIALS, SKIP_REASON);
  test.use({ storageState: STAFF_STATE });

  test('creates one, then pauses it from the row', async ({ page }) => {
    await page.goto('/coupons');

    const open = page.getByRole('button', { name: /كوبون جديد/ });

    await expect(open, 'the create control is a real button now').toBeVisible();
    await open.click();

    const submit = page.getByRole('button', { name: /^إنشاء الكوبون$/ });

    await expect(
      submit,
      'disabled until it has a code, a value and a window',
    ).toBeDisabled();

    /* A code unique to this run, so the row asserted on is the one just made. */
    const code = `E2E${Date.now().toString().slice(-8)}`;

    /*
      Scoped to the PANEL. The search box is labelled «بحث بالكود أو النوع…», which `getByLabel`
      matches on «الكود» too — a strict-mode violation, and a real ambiguity for anybody reading
      the screen with assistive technology.
    */
    await page.getByRole('textbox', { name: /^الكود/ }).fill(code);
    await page.getByLabel('القيمة', { exact: true }).fill('15');

    const today = new Date();
    const later = new Date(today.getTime() + 30 * 86_400_000);
    const iso = (d: Date): string => d.toISOString().slice(0, 10);

    await page.getByLabel('يبدأ في').fill(iso(today));
    await expect(submit, 'a start alone is not a window').toBeDisabled();

    await page.getByLabel('ينتهي في').fill(iso(later));
    await expect(submit).toBeEnabled();
    await submit.click();

    const row = page.locator('tbody tr').first();

    await expect(row, 'the coupon just created is on top').toContainText(code);
    await expect(row.locator('[data-status-pill]')).toHaveText('نشط');

    /* And it can be paused from the row, without touching its dates. */
    await row.getByRole('button', { name: 'إيقاف' }).click();

    await expect(
      page.locator('tbody tr').first().locator('[data-status-pill]'),
    ).toHaveText('موقوف');

    /* The control flips rather than disappearing: a paused campaign can be resumed. */
    await expect(
      page.locator('tbody tr').first().getByRole('button', { name: 'تفعيل' }),
    ).toBeVisible();
  });

  /**
   * A percentage outside 1–100 cannot be submitted.
   *
   * The database refuses it too (`coupons_percent_bounded`), and the schema refuses it before that.
   * This is the third guard, and the only one the operator ever meets.
   */
  test('will not submit a percentage over 100', async ({ page }) => {
    await page.goto('/coupons');
    await page.getByRole('button', { name: /كوبون جديد/ }).click();

    await page.getByRole('textbox', { name: /^الكود/ }).fill('E2EBADPCT');
    await page.getByLabel('القيمة', { exact: true }).fill('150');

    const today = new Date();

    await page.getByLabel('يبدأ في').fill(today.toISOString().slice(0, 10));
    await page
      .getByLabel('ينتهي في')
      .fill(new Date(today.getTime() + 86_400_000).toISOString().slice(0, 10));

    await expect(page.getByRole('button', { name: /^إنشاء الكوبون$/ })).toBeDisabled();
  });
});
