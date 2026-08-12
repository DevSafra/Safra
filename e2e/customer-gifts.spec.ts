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

    /*
      ── The navbar knows we are signed in, WITHOUT a reload ──

      Reported by Bashar (2026-08-12): the header kept offering «تسجيل الدخول» after signing in and only
      corrected itself on a manual reload. `SiteHeader` is server-rendered from the session cookie, and
      `router.refresh()` + `push()` refreshed the page being LEFT while the destination came from a router
      cache entry built before the cookie existed. `reloadInto` makes it a real navigation. The
      sign-out direction is checked at the end of this test.
    */
    await expect(page.locator('header')).toContainText(en.auth.account);
    await expect(page.locator('header')).not.toContainText(en.auth.signIn);

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

    /*
      ── The theme toggle lives beside sign out, and ONLY there ──

      Bashar, 2026-08-12: move it into the dashboard beside sign out, the way لوحة الشريك has it. A MOVE:
      `HeaderThemeToggle` renders nothing on account routes, so a count of one is the assertion that
      matters — two controls for one setting is what this replaced. The partner suite checks the same
      properties in `partner-sidebar.spec.ts`.
    */
    const themeButton = page.getByRole('button', { name: /mode/i });

    await expect(themeButton, 'one toggle on an account page, not two').toHaveCount(1);
    await expect(sidebar.getByRole('button', { name: /mode/i })).toBeVisible();

    const themeOf = () =>
      page.evaluate(() => document.documentElement.dataset.theme ?? '');
    const before = await themeOf();

    await themeButton.click();
    await expect
      .poll(themeOf, { message: 'clicking must change the theme' })
      .not.toBe(before);

    const switched = await themeOf();

    /* The label names the DESTINATION, so it has to flip with the state. */
    await expect(themeButton).toHaveAttribute(
      'aria-label',
      switched === 'dark' ? /light/i : /dark/i,
    );

    /* Remembered, because a pre-paint script applies it rather than React. */
    await page.reload({ waitUntil: 'domcontentloaded' });
    expect(await themeOf()).toBe(switched);

    /*
      And the navbar has NONE — Bashar had it removed from there entirely (2026-08-12), so the sidebar
      foot is the only theme control in the app. A signed-out visitor follows their OS preference.
    */
    await page.goto('/en', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: /mode/i })).toHaveCount(0);

    await page.goto('/en/account', { waitUntil: 'domcontentloaded' });

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

    /*
      ── الدعم: open a request, mask a phone number, reply ──

      Here rather than in its own spec, for the reason the sidebar and theme assertions above are: a second
      `test` under this describe gets a fresh context and spends a second customer sign-in, and the budget
      has no room for one. The partner side DOES have its own spec, because that project replays a stored
      session and so costs nothing.

      It leaves a ticket behind every run. Messages are append-only by trigger, so a spec cannot tidy up
      here — and reusing an existing thread would stop exercising the OPEN path after the first run.
      `db:testbed` clears them, which is what bounds the count.
    */
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.goto('/en/account/support', { waitUntil: 'domcontentloaded' });

    await expect(
      page.getByRole('heading', { name: en.account.supportOpenTitle }),
    ).toBeVisible();

    /* A phone number goes in on purpose: contact details are redacted on the way IN and never kept. */
    await page
      .locator('textarea[name=body]')
      .fill('The heating did not work for two nights. Call me on 0955123456 please.');

    /*
      `form:has(textarea)`, not the last submit on the page — the account sidebar's sign-out is itself a
      submit button, and a looser selector signs the reader out. That cost a debugging cycle on the
      partner side of this same feature.
    */
    await page.locator('form:has(textarea) button[type=submit]').click();
    await page.waitForURL(/\/account\/support\/CNV-/, { timeout: 20_000 });

    const thread = page.locator('ol');

    await expect(thread).not.toContainText('0955123456');
    /* Announced, or the sender waits for a call that cannot come. */
    await expect(thread).toContainText('masked');

    const messagesBefore = await page.locator('ol li').count();

    await page.locator('textarea[name=body]').fill('It is still not fixed today.');
    await page.locator('form:has(textarea) button[type=submit]').click();
    await expect(page.locator('ol li')).toHaveCount(messagesBefore + 1, {
      timeout: 20_000,
    });

    /* Listed, and a reference that is not this customer's is a 404 rather than a different error. */
    await page.goto('/en/account/support', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('a[href*="/account/support/CNV-"]').first()).toBeVisible();

    const foreign = await page.goto('/en/account/support/CNV-000001', {
      waitUntil: 'domcontentloaded',
    });

    expect(foreign?.status()).toBe(404);

    /*
      ── And signing out is reflected immediately too ──

      The mirror of the bug above, and the worse half: the home page used to keep saying «حسابي» after the
      session was destroyed. Last in this test because it ends the session.
    */
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.goto('/en/account', { waitUntil: 'domcontentloaded' });
    await page
      .locator('#account-sidebar')
      .getByRole('button', { name: /sign out/i })
      .click();
    await page.waitForURL(/\/en$/, { timeout: 20_000 });

    await expect(page.locator('header')).toContainText(en.auth.signIn);
    await expect(page.locator('header')).not.toContainText(en.auth.account);
  });
});
