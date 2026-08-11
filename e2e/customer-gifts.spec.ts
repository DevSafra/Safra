import { expect, test } from '@playwright/test';

import en from '../packages/i18n/src/messages/web/en.json' assert { type: 'json' };

/**
 * بطاقات الهدايا, from the customer's side (handoff §6).
 *
 * ## What a browser adds over the integration tests
 *
 * `gift-card.integration.test.ts` proves the money: the locking, the refusals, the round trip and that
 * no code reaches the audit log. What it cannot see is whether the SCREEN works — and this feature shows
 * exactly why that matters. The first version passed its copy and formatters to the client components as
 * function props; React refuses to serialise a function across that boundary, so every render threw and
 * the page 500ed. `pnpm verify` was green throughout. A browser found it in seconds.
 *
 * ## It restores what it spends
 *
 * The test buys a card and then redeems it, so the wallet ends where it started — the same discipline
 * the rows-per-page rule demands, because this suite shares one account across specs AND across runs. A
 * spec that only bought would drain the fixture wallet a little on every run until an unrelated
 * assertion failed for a reason nobody could trace.
 *
 * One sign-in, in the `signed-in` project, which is ordered last for the login budget.
 */
const PASSWORD = process.env['TESTBED_PASSWORD'] ?? 'a-testbed-password-1';
const EMAIL = 'customer@safra.test';

test.use({ baseURL: 'http://localhost:3000' });

test.describe('بطاقات الهدايا', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('refuses a bad code, then buys and redeems a card back to par', async ({
    page,
  }) => {
    /*
      `p[role=alert]`, not `getByRole('alert')`.

      Next renders a permanently-present, permanently-EMPTY `<div role="alert">` route announcer, so the
      role selector always resolves to at least two elements and strict mode fails — or worse, matches
      the empty one and reports no message. The banners here are paragraphs, and the bought-code panel is
      a div, so this narrows to exactly the message strip.
    */
    const banner = page.locator('p[role=alert]');

    await page.goto('/en/login?next=%2Fen%2Faccount%2Fgifts');
    await page.getByLabel(en.auth.email).fill(EMAIL);
    await page.locator('input[name=password]').fill(PASSWORD);
    await page.locator('button[type=submit]').first().click();
    await page.waitForURL(/\/account\/gifts/, { timeout: 20_000 });

    /* Both halves render at all — the assertion the function-prop bug would have failed. */
    await expect(
      page.getByRole('heading', { name: en.account.giftRedeemTitle }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: en.account.giftBuyTitle }),
    ).toBeVisible();

    // ── An unknown code is refused, with the sentence for it rather than a generic apology ──
    await page.locator('input[name=code]').fill('ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ');
    await page
      .getByRole('button', { name: en.account.giftRedeemSubmit, exact: true })
      .click();

    await expect(banner).toContainText('gift card code is not valid', {
      timeout: 15_000,
    });

    // ── Buy the smallest card ──
    await page.selectOption('select[name=amount]', '25.00');
    await page.locator('input[name=recipientName]').fill('E2E Recipient');
    await page
      .getByRole('button', { name: en.account.giftBuySubmit, exact: true })
      .click();

    const shown = page.locator('[data-gift-code]');

    await expect(shown).toBeVisible({ timeout: 20_000 });

    const code = (await shown.innerText()).trim();

    /* Four groups of five Crockford symbols — `I`, `L`, `O` and `U` never appear. */
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$/);

    /*
      The code is shown ONCE. After a reload it is gone, and the list below never carries it — only the
      last four. A read that returned a usable code would be a way to spend other people's money.
    */
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-gift-code]')).toHaveCount(0);

    const body = await page.locator('body').innerText();

    expect(body, 'the page must not carry the code after a reload').not.toContain(code);
    expect(body, 'nor the code without its hyphens').not.toContain(
      code.replace(/-/g, ''),
    );
    /* The card itself IS listed, by reference. */
    expect(body).toMatch(/GIF-\d+/);

    // ── Redeem it, which puts the balance back ──
    await page.locator('input[name=code]').fill(code);
    await page
      .getByRole('button', { name: en.account.giftRedeemSubmit, exact: true })
      .click();

    await expect(banner).toContainText('added to your wallet', {
      timeout: 20_000,
    });

    // ── A second attempt pays out nothing and says why ──
    await page.locator('input[name=code]').fill(code);
    await page
      .getByRole('button', { name: en.account.giftRedeemSubmit, exact: true })
      .click();

    await expect(banner).toContainText('already been redeemed', {
      timeout: 15_000,
    });

    /*
      ── Arabic, and no sideways scroll at any documented width ──

      In the same test rather than its own, because a second `test` under this describe would get a fresh
      context and spend a second sign-in from a budget that has no room for one.
    */
    for (const width of [390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/ar/account/gifts', { waitUntil: 'domcontentloaded' });

      await expect(
        page.getByRole('heading', { name: 'استبدال رمز' }),
        `the Arabic redeem panel is missing at ${width}px`,
      ).toBeVisible();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );

      expect(
        overflow,
        `/ar/account/gifts scrolls sideways at ${width}px`,
      ).toBeLessThanOrEqual(0);
    }
  });
});
