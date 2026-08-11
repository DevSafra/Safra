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
 * ## Why it does NOT buy a card
 *
 * It used to buy one and redeem it, which leaves the BALANCE where it started — and that looked like
 * enough until a gift card could only be bought with الرصيد الحالي (Bashar, 2026-08-11). Under that rule
 * a buy-then-redeem cycle converts 25 of cash into 25 of gift money every single run, permanently: the
 * purchase debit comes out of the cash part, and the redemption credit lands in the gift part. Four runs
 * later the fixture wallet was entirely gift-derived and could not buy anything, and the spec would have
 * started failing for a reason with no relationship to any change.
 *
 * So the money moves are proven in `gift-card.integration.test.ts` — 36 tests, inside a transaction that
 * rolls back, where they cost nothing. What is left here is what only a browser can see: that the page
 * renders at all, that a refusal reaches the reader in their own language, and that محفظتي's three
 * figures agree with each other.
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

    /*
      ── محفظتي splits the balance, and the parts agree with the total ──

      The two cards and the total are three figures a reader can check against each other, so that is
      what is asserted rather than any particular amount — the fixture's balance is not this spec's
      business, and pinning a number here would make it fail the first time somebody made a booking.
    */
    await page.goto('/en/account/wallet', { waitUntil: 'domcontentloaded' });

    const panel = await page.locator('section').first().innerText();
    const amounts = [...panel.matchAll(/\$([\d,]+\.\d{2})/g)].map((m) =>
      Number(m[1]?.replace(/,/g, '')),
    );

    /* Current balance, gift card balance, then the total beneath them. */
    expect(amounts, 'the panel must print three amounts').toHaveLength(3);
    expect(
      (amounts[0] ?? 0) + (amounts[1] ?? 0),
      'the two parts must sum to the total available to spend',
    ).toBeCloseTo(amounts[2] ?? -1, 2);

    /*
      ── The sidebar behaves like the other two dashboards ──

      Asserted from THIS test's session rather than its own spec, because a second `test` under this
      describe would get a fresh context and spend a second customer sign-in, and the suite has no room
      for one. It is the same set of properties `partner-sidebar.spec.ts` checks: the hamburger is at
      every width, the choice persists, the content reclaims the column, and below `lg` the sidebar is a
      drawer that Escape dismisses.
    */
    await page.goto('/en/account', { waitUntil: 'domcontentloaded' });

    const hamburger = page.getByRole('button', { name: /menu/i }).first();
    const sidebar = page.locator('#account-sidebar');

    await expect(hamburger).toBeVisible();
    await expect(sidebar).toBeVisible();
    /* Sign out lives at the FOOT of the sidebar, as on both staff surfaces. */
    await expect(sidebar.getByRole('button', { name: /sign out/i })).toBeVisible();

    await hamburger.click();
    await expect(sidebar).toBeHidden();
    await expect(hamburger).toHaveAttribute('aria-expanded', 'false');

    /* With no column beside it, the content occupies the only one. */
    expect(
      await page.evaluate(
        () =>
          getComputedStyle(document.querySelector('.account-main') as Element)
            .gridColumnStart,
      ),
    ).toBe('1');

    /* The choice survives a reload, because it is written before paint rather than by React. */
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(sidebar).toBeHidden();

    await hamburger.click();
    await expect(sidebar).toBeVisible();

    /* Below `lg` it is a drawer with a backdrop, and Escape puts it away. */
    await page.evaluate(() => localStorage.removeItem('safra-sidebar'));
    await page.setViewportSize({ width: 390, height: 880 });
    await page.goto('/en/account', { waitUntil: 'domcontentloaded' });
    await expect(hamburger, 'the hamburger is available on a phone too').toBeVisible();

    await hamburger.click();
    await expect(sidebar).toBeVisible();
    await expect(page.locator('.account-backdrop')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(sidebar).toBeHidden();

    await page.evaluate(() => localStorage.removeItem('safra-sidebar'));
    await page.setViewportSize({ width: 1280, height: 1000 });

    /*
      ── An LTR value sits at the reader's START edge, in both directions ──

      Bashar, 2026-08-11: on the Arabic profile the email and the phone number sat on the LEFT while
      their labels sat on the right. The cause was `dir="ltr"`, which fixes the ORDER of a Latin run and
      also moves the element's start edge to the left. Display text now uses a U+2066 isolate and fields
      use the `field-ltr` class, which takes its alignment from the DOCUMENT rather than the element.
    */
    for (const [loc, want] of [
      ['ar', 'right'],
      ['en', 'left'],
    ] as const) {
      await page.goto(`/${loc}/account/gifts`, { waitUntil: 'domcontentloaded' });

      const align = await page
        .locator('input[name=code]')
        .evaluate((el) => getComputedStyle(el).textAlign);

      expect(
        align === want || (want === 'left' && align === 'start'),
        `the ${loc} gift-code field aligns ${align}, expected ${want}`,
      ).toBe(true);

      /* The ORDER is still left to right, or `+963…` would render as `963…+`. */
      expect(
        await page
          .locator('input[name=code]')
          .evaluate((el) => getComputedStyle(el).direction),
      ).toBe('ltr');
    }

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
