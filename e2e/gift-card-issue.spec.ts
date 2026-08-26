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
    await expect(submit).toBeEnabled();

    await submit.click();

    /* The success panel, and the sentence that says this is the only time. */
    await expect(page.getByText('صدرت البطاقة')).toBeVisible();
    await expect(page.getByText(/يُعرض مرة واحدة فقط/)).toBeVisible();

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
});
