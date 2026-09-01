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

      The cards and the total are figures a reader can check against each other, so that is what is
      asserted rather than any particular amount — the fixture's balance is not this spec's business,
      and pinning a number here would make it fail the first time somebody made a booking.

      THREE cards since 2026-09-01: the customer's own money, compensation SAFRA credited, and gift
      money. Compensation had been printed inside «current balance», which said a figure was
      available and was then refused at the gift-card purchase — so the count matters here, not only
      the sum: a fourth part folded silently back into a third would still add up.
    */
    await page.goto('/en/account/wallet', { waitUntil: 'domcontentloaded' });

    const panel = await page.locator('section').first().innerText();
    const amounts = [...panel.matchAll(/\$([\d,]+\.\d{2})/g)].map((m) =>
      Number(m[1]?.replace(/,/g, '')),
    );

    /* Own money, compensation, gift money, then the total beneath them. */
    expect(amounts, 'the panel must print four amounts').toHaveLength(4);
    expect(
      (amounts[0] ?? 0) + (amounts[1] ?? 0) + (amounts[2] ?? 0),
      'the three parts must sum to the total available to spend',
    ).toBeCloseTo(amounts[3] ?? -1, 2);

    /*
      And the compensation part is a REAL figure, not a zero that would make the card decorative.

      The testbed wallet opens with both kinds of money for exactly this: a spec that only ever saw
      zero there would pass against a page that had stopped rendering the card at all.
    */
    expect(amounts[1] ?? 0, 'the compensation card must show the credit').toBeGreaterThan(
      0,
    );

    /*
      ── And بطاقات الهدايا states what can ACTUALLY buy a card ──

      The hint under the amount ladder must be the withdrawable part, not the balance. It was the
      balance minus gift money, and when compensation joined the same rule the line started offering
      a figure the purchase would refuse — «$405.00 available to spend» over a wallet holding 405 of
      compensation. That is precisely the failure the hint was added for on 2026-08-12, reopened by
      widening the rule and not the sentence, so it is asserted rather than trusted.

      Read as a NUMBER against the wallet's own first card, not pinned: the fixture's balance is not
      this spec's business, and the relationship is what must hold.
    */
    await page.goto('/en/account/gifts', { waitUntil: 'domcontentloaded' });

    const hint = await page.locator('main').innerText();
    const spendable = Number(
      hint.match(/available to spend: \$([\d,]+\.\d{2})/)?.[1]?.replace(/,/g, '') ?? -1,
    );

    expect(
      spendable,
      'the gift page offers the customer’s own money, not the whole balance',
    ).toBeCloseTo(amounts[0] ?? -1, 2);

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

      Bashar, 2026-08-12: move it into the dashboard beside sign out, the way لوحة الشريك has it. A
      MOVE: a count of one is the assertion that matters — two controls for one setting is what this
      replaced. The partner suite checks the same properties in `partner-sidebar.spec.ts`.

      It spent an afternoon in the site footer on 2026-08-13, beside language and currency, and came
      back: theme is a control for somebody working in a DASHBOARD, and the public site is simply
      white. The three dashboards have it; nothing else does.
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
      And the PUBLIC site has none — not in the navbar and not in the footer. A signed-out visitor
      gets white, which since 2026-08-13 is the default outright rather than whatever their OS
      prefers.
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
      ── النزاعات: raise a dispute on a paid booking ──

      In this test rather than its own, for the same budget reason as الدعم above: a second `test` would
      spend another customer sign-in.

      The assertion that matters is not that the row appears. It is that raising one HOLDS THE HOST'S
      PAYOUT — the console derives the freeze from an unresolved dispute — which is why the form names
      the booking from a select of the customer's OWN paid bookings rather than from a text field. A
      reference typed by hand into a field is a reference somebody else's booking could be typed into.
    */
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.goto('/en/account/disputes', { waitUntil: 'domcontentloaded' });

    /*
      Scoped to the ACCOUNT NAV, which is what this assertion is about.

      The footer's الدعم column links to النزاعات too, so the unscoped role selector now matches
      twice. Naming the navigation says which one is meant rather than relying on there being only
      one — and the footer link is a second, deliberate route to the same page.
    */
    await expect(
      page
        /*
          `getByLabel`, not `getByRole('navigation')`: the account shell puts its `aria-label` on
          the ASIDE rather than the nav inside it, deliberately — the aside is what the hamburger
          controls and what focus lands on, and labelling both would announce the words twice.
        */
        .getByLabel(en.account.navHeading)
        .getByRole('link', { name: en.account.navDisputes, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: en.account.disputesOpenTitle }),
    ).toBeVisible();

    /* The consequence is stated before the form, not after the button. */
    await expect(page.getByText(en.account.disputesIntro)).toBeVisible();

    /*
      A title unique to this run, and the assertions key off IT rather than off a row count.

      Every run leaves a dispute behind — the rows are a record and a spec cannot tidy up after itself
      here — so "one more row than before" holds only on a clean database, and `ul li` also matches the
      account nav's own list. Asserting the row THIS run created is unambiguous and stable.
    */
    /*
      LETTERS, not `Date.now()`.

      The first version suffixed the title with a millisecond timestamp, and the redactor masked it:
      thirteen consecutive digits is exactly what a phone number looks like, so the stored title became
      "The door was locked all evening ⟨محجوب⟩" and the assertion hunted for a string that could never
      exist. The feature under test ate the fixture.

      Anything unique that goes into a redacted field has to be unlike a contact detail.
    */
    const raised = `The door was locked all evening ${Math.random()
      .toString(36)
      .replace(/[^a-z]/g, '')
      .slice(0, 8)}`;

    /*
      The BOOKING and the REASON are the first pair this account has not already spent.

      One live dispute is allowed per booking per reason — a second freezes the host's payout twice
      over for the same complaint — so a run must pick a pair no earlier run picked. Three attempts
      at that failed, and the third is the one that mattered:

      1. Rotating the reason by the row count held only while the count stayed under four.
      2. Reading the spent pairs off the rendered list held only while the account had ten or fewer
         disputes: the list PAGES, the eleventh was invisible, and the set was silently incomplete.
      3. Submitting and retrying on refusal cannot work at all — `POST /disputes` is throttled to
         three a minute by design, so the fourth attempt is a 429 rather than an answer. A test
         cannot brute-force a rate limit, and should not want to.

      So the pairs are collected across EVERY page — which the list can now do, because paging it
      was the product gap the second attempt exposed — and exactly one submit follows.
    */
    const spent = new Set<string>();

    for (let page_ = 0; page_ < 20; page_ += 1) {
      /*
        ONE call, not a handle per row.

        `.all()` snapshots the COUNT and then re-resolves `nth(i)` against the live DOM for each
        read, so a navigation landing mid-loop leaves it waiting for a row the new page does not
        have. `allTextContents()` is a single call and cannot straddle one.
      */
      for (const text of await page.locator('#disputes-list li').allTextContents()) {
        const booking = /BKG-[\d-]+/.exec(text)?.[0];

        /*
          Only a LIVE dispute spends the pair — and counting every historical one is what
          "exhausted" this fixture (2026-08-24).

          `dispute-request.service.ts` refuses a duplicate on `status IN ('open','investigating')`
          and says why in as many words: resolved and rejected are terminal, so the reason is free to
          raise again. This loop counted every dispute ever filed, so after thirty-two the spec threw
          «Run `pnpm db:testbed` to clear them» — pointing at a destructive re-seed to solve a
          problem the API did not have. A test must not be stricter than the rule it is testing.
        */
        const live =
          text.includes(en.disputeStatuses.open) ||
          text.includes(en.disputeStatuses.investigating);

        if (!live) continue;

        for (const [kind, label] of Object.entries(en.disputeKinds)) {
          if (booking && text.includes(label)) spent.add(`${booking}|${kind}`);
        }
      }

      const more = page.getByRole('link', { name: en.account.loadMore });

      if ((await more.count()) === 0) break;

      /*
        Wait for THIS cursor, not for any cursor (O-e2e-2, diagnosed 2026-08-23).

        This was `waitForURL(/cursor=/)`, which matches the URL the loop is already ON from the
        second iteration onward — so it returned instantly and waited for nothing. The loop then
        read the list while the client-side navigation was still in flight: `.all()` took its count
        from page two's ten rows, the DOM became page three's one row underneath it, and `nth(8)`
        waited for a ninth row that would never exist until the 30s budget was gone.
        `customer-gifts.spec.ts:40` was the only red in the suite for that reason.

        It is also why the earlier attempt at this MOVED the failure onto «Show more» rather than
        curing it: making the read atomic left the un-awaited navigation in place, so the next
        thing the loop touched was the link being detached under it. The read method was never the
        cause. Both fixes are needed and neither is sufficient alone.

        The link's own href is the exact destination, so waiting for it is a real wait rather than
        a predicate that happens to be true already.
      */
      const next = await more.getAttribute('href');

      await more.click();
      await page.waitForURL((url) => `${url.pathname}${url.search}` === next);
    }

    /* Back to the form, which only the first page carries. */
    await page.goto('/en/account/disputes');

    const candidates = (
      await page
        .locator('select[name=bookingReference] option')
        .evaluateAll((options) =>
          options.map((option) => (option as HTMLOptionElement).value),
        )
    ).flatMap((booking) =>
      Object.keys(en.disputeKinds).map((kind) => ({ booking, kind })),
    );

    const pair = candidates.find(({ booking, kind }) => !spent.has(`${booking}|${kind}`));

    if (!pair) {
      throw new Error(
        `Every booking/reason pair on the fixture account has a live dispute (${spent.size} ` +
          'spent). Run `pnpm db:testbed` to clear them.',
      );
    }

    await page.locator('select[name=bookingReference]').selectOption(pair.booking);
    await page.locator('select[name=kind]').selectOption(pair.kind);
    await page.locator('input[name=title]').fill(raised);
    /*
      A phone number goes in on purpose. A dispute is where somebody is most likely to write "just
      call me" — they are upset and they want a person — so this is where the mask matters most.
    */
    await page
      .locator('textarea[name=description]')
      .fill(
        'Nobody was there when we arrived and the key box was empty. Call me on 0955123456.',
      );

    await page.locator('form:has(textarea) button[type=submit]').click();

    const disputeRow = page.locator('#disputes-list li').filter({ hasText: raised });

    await expect(disputeRow).toBeVisible({ timeout: 20_000 });

    /* The dispute this run raised is listed, with a DSP- reference. */
    await expect(disputeRow).toContainText('DSP-');

    /* Masked, and said out loud — otherwise they wait for a call that cannot come. */
    await expect(disputeRow).not.toContainText('0955123456');
    await expect(disputeRow).toContainText('masked');

    /* No page scrolls sideways, at every width the project promises. */
    for (const width of [390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/en/account/disputes', { waitUntil: 'domcontentloaded' });

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );

      expect(
        overflow,
        `/account/disputes scrolls sideways at ${width}px`,
      ).toBeLessThanOrEqual(0);
    }

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
