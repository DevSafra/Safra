import { expect, test } from '@playwright/test';

import { MISSING_CREDENTIALS, SKIP_REASON, STAFF_STATE } from './staff.js';

/**
 * Issuing a gift card from بطاقات الهدايا — §9.3's «+ إنشاء بطاقة هدية».
 *
 * In a BROWSER because the form is a client component and `pnpm verify` is HTTP-level: it cannot
 * see a control that never arms, a panel that never opens, or a code that never reaches the screen.
 * The API side is held by `gift-card-issue.integration.test.ts`; this is the half a person meets.
 *
 * ## The code is the point
 *
 * Only `code_hash` is stored, so the response is the one and only time the plaintext exists on this
 * screen. If it does not render, the card is real, spendable, and unreachable — a liability nobody
 * can hand to anybody.
 */
test.describe('issuing a gift card', () => {
  test.skip(MISSING_CREDENTIALS, SKIP_REASON);
  test.use({ storageState: STAFF_STATE });

  test('shows the code once, and only after a reason is given', async ({ page }) => {
    await page.goto('/giftcards');

    const open = page.getByRole('button', { name: /إنشاء بطاقة هدية/ });

    await expect(open, 'the create control is a real button now').toBeVisible();
    await open.click();

    const submit = page.getByRole('button', { name: /^إصدار البطاقة$/ });

    /* Nothing typed: the control must not arm on an empty liability. */
    await expect(submit, 'disabled until it has an amount and a reason').toBeDisabled();

    await page.getByLabel('القيمة').fill('12.50');
    await expect(
      submit,
      'an amount alone is not enough — the reason is audited',
    ).toBeDisabled();

    await page.getByLabel('سبب الإصدار').fill('اختبار إصدار من الكونسول.');
    await expect(
      submit,
      'the address is how the card reaches anybody, so it is required too',
    ).toBeDisabled();

    await page.getByLabel('بريد المستلم').fill('guest@example.test');
    await expect(submit).toBeEnabled();

    await submit.click();

    /* The success panel, and the sentence that says this is the only time. */
    await expect(page.getByText('صدرت البطاقة')).toBeVisible();
    await expect(page.getByText(/يُعرض مرة واحدة فقط/)).toBeVisible();
    /* And it says the card was sent, because it always is now. */
    await expect(page.getByText(/أُرسل الكود إلى بريد المستلم/)).toBeVisible();

    /*
      A real code: four groups of five from the gift alphabet. Asserting merely that something
      rendered would pass on an empty string, which is exactly the failure that matters.
    */
    const code = await page.locator('p.font-mono').innerText();

    expect(code.trim(), `«${code}» is not a gift code`).toMatch(
      /^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/,
    );

    /* And the card is on the table behind it, active, for the amount asked for. */
    await page.getByRole('button', { name: 'تم' }).click();
    await expect(page.locator('tbody tr').first()).toContainText('12.50');
  });

  /**
   * The code is fully visible on a phone (Bashar, 2026-08-26).
   *
   * Twenty-three characters at 15px with 0.18em of tracking do not fit a 390px panel, and a code
   * somebody can only half see is a code they cannot use. Measured rather than eyeballed: the
   * element must not be wider than the box that holds it, at the width where it first fails.
   */
  test('shows the whole code inside its box at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto('/giftcards');

    await page.getByRole('button', { name: /إنشاء بطاقة هدية/ }).click();
    await page.getByLabel('القيمة').fill('9.00');
    await page.getByLabel('بريد المستلم').fill('guest@example.test');
    await page.getByLabel('سبب الإصدار').fill('اختبار العرض على الهاتف.');
    await page.getByRole('button', { name: /^إصدار البطاقة$/ }).click();

    const code = page.locator('p.font-mono');

    await expect(code).toBeVisible();

    const fits = await code.evaluate((element) => {
      const box = element.parentElement;

      return {
        overflows: element.scrollWidth > element.clientWidth + 1,
        withinPanel:
          box === null || element.getBoundingClientRect().width <= box.clientWidth + 1,
        text: (element.textContent ?? '').trim(),
      };
    });

    expect(fits.overflows, 'the code is clipped inside its own box').toBe(false);
    expect(fits.withinPanel, 'the code spills out of the panel').toBe(true);
    /* And it is still the whole code, not an ellipsis. */
    expect(fits.text).toMatch(/^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/);

    /* Nothing scrolls sideways, which is the standing rule for every screen. */
    const sideways = await page.evaluate(
      () =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );

    expect(sideways, 'the page scrolls sideways at 390px').toBe(false);
  });

  /**
   * Voiding a live card, from the row (Bashar, 2026-08-26).
   *
   * `cancelled` was a status nothing could write — the enum value, the `GIFT_CARD_MANAGE`
   * permission and no route between them. Once staff could CREATE cards that mattered: only
   * `code_hash` is stored, so a card issued for the wrong amount could not be recalled by finding
   * its code, and the only remedy was to wait for it to be spent or expire.
   */
  test('voids a card it has just issued', async ({ page }) => {
    await page.goto('/giftcards');

    /* Issue one, so the row being cancelled is known rather than whatever sits on top. */
    await page.getByRole('button', { name: /إنشاء بطاقة هدية/ }).click();
    await page.getByLabel('القيمة').fill('31.00');
    await page.getByLabel('بريد المستلم').fill('guest@example.test');
    await page.getByLabel('سبب الإصدار').fill('اختبار الإلغاء.');
    await page.getByRole('button', { name: /^إصدار البطاقة$/ }).click();
    await page.getByRole('button', { name: 'تم' }).click();

    const row = page.locator('tbody tr').first();

    await expect(row, 'the card just issued is on top').toContainText('31.00');
    await expect(row.locator('[data-status-pill]')).toHaveText('نشطة');

    await row.getByRole('button', { name: 'إلغاء البطاقة' }).click();

    const confirm = page.getByRole('button', { name: 'تأكيد الإلغاء' });

    await expect(
      confirm,
      'a reason is required — this destroys a liability',
    ).toBeDisabled();

    await page.locator('textarea[placeholder="سبب الإلغاء"]').fill('أُصدرت بقيمة خاطئة.');
    await expect(confirm).toBeEnabled();
    await confirm.click();

    /* The row says so, and the control is gone because a cancelled card cannot be cancelled. */
    await expect(
      page.locator('tbody tr').first().locator('[data-status-pill]'),
    ).toHaveText('ملغاة');
    await expect(
      page.locator('tbody tr').first().getByRole('button', { name: 'إلغاء البطاقة' }),
    ).toHaveCount(0);
  });
});
