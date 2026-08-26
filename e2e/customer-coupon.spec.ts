import { expect, test, type Page } from '@playwright/test';

/**
 * A customer applying a discount code at checkout (§9.3's الكوبونات).
 *
 * ## Why the TOTAL is the assertion
 *
 * The worst outcome this feature could have is a customer seeing one figure and being charged
 * another. The coupon is entered in the summary and submitted by the form — two sibling client
 * components in a server-rendered grid — so the number falling is what proves they agree.
 *
 * No sign-in: search, property and checkout are all public, so this spends nothing from the auth
 * throttle budget.
 */
test.use({ baseURL: 'http://localhost:3000' });

test.describe('a discount code at checkout', () => {
  /** The first bookable unit the search offers, with dates far enough out to be free. */
  async function reachCheckout(page: Page): Promise<boolean> {
    await page.goto('/ar/search');

    const property = page.locator('a[href*="/property/"]').first();

    if ((await property.count()) === 0) return false;

    await property.click();
    await page.waitForURL(/\/property\//);

    const book = page.locator('a[href*="/checkout?"]').first();

    if ((await book.count()) === 0) return false;

    await book.click();
    await page.waitForURL(/\/checkout\?/);

    return true;
  }

  /** «المطلوب الآن», as a number, however it is formatted. */
  async function dueNow(page: Page): Promise<number> {
    const row = page.locator('dl div').filter({ hasText: 'المطلوب الآن' }).last();
    const text = await row.innerText();
    const figure = text.replace(/[^\d.]/g, '');

    return Number(figure);
  }

  test('applies a code and the total falls by the discount', async ({ page }) => {
    test.skip(!(await reachCheckout(page)), 'No bookable unit to reach checkout with.');

    const before = await dueNow(page);

    expect(before, 'the summary shows a total to begin with').toBeGreaterThan(0);

    await page.getByLabel('هل لديك كود خصم؟').fill('E2ECOUPON');
    await page.getByRole('button', { name: 'تطبيق' }).click();

    /*
      TWO places name it, and both are correct: the summary's discount line and the chip in the
      field. Asserting on only one would pass if the other silently stopped rendering, which is
      exactly the drift between the two halves this feature has to avoid.
    */
    await expect(page.getByText(/خصم E2ECOUPON/).first()).toBeVisible();
    await expect(page.getByText(/خصم E2ECOUPON/)).toHaveCount(2);

    const after = await dueNow(page);

    expect(after, 'the total falls').toBeLessThan(before);

    /*
      By 20% of the STAY, not of the total: SAFRA's service fee is its own charge rather than part
      of what is being discounted. So the drop is less than 20% of what was showing, and that is
      the correct arithmetic rather than a rounding artefact.
    */
    const dropped = before - after;

    expect(dropped, 'a real discount, not a rounding wobble').toBeGreaterThan(0);
    expect(dropped, 'and never more than the whole total').toBeLessThan(before);
  });

  /** A code that means nothing is refused in Arabic, and the total does not move. */
  test('refuses an unknown code without changing the price', async ({ page }) => {
    test.skip(!(await reachCheckout(page)), 'No bookable unit to reach checkout with.');

    const before = await dueNow(page);

    await page.getByLabel('هل لديك كود خصم؟').fill('NOTACODE');
    await page.getByRole('button', { name: 'تطبيق' }).click();

    const message = page.locator('p.text-bad').first();

    await expect(message).toBeVisible();
    /* In the customer's language — the API's English travels for logs and is never displayed. */
    await expect(message).not.toContainText(/[A-Za-z]{4}/);

    expect(await dueNow(page), 'a refused code changes nothing').toBe(before);
  });
});
