import { expect, test } from '@playwright/test';

import { partnerAr as t } from '../packages/i18n/src/partner.js';
import {
  PARTNER_BASE as BASE,
  PARTNER_EMAIL,
  PARTNER_PASSWORD as PASSWORD,
  PARTNER_STATE,
  SECOND_PARTNER_EMAIL,
  THIRD_PARTNER_EMAIL,
  signInCodeFor,
} from './partner-session.js';

/**
 * لوحة الشريك — sign in, and see your own listings and nobody else's.
 *
 * ## Why a browser, and why this test above all others for a new app
 *
 * The chain is login form → route handler → API → cookie → middleware → server component → API
 * again. Every link is server-side and every failure in it is quiet: the first version of this app
 * signed in perfectly and rendered an empty page, because the client's zod schema had been written
 * against the columns somebody expected rather than the response the API actually sends. Nothing
 * errored; `safeParse` failed and the page said "could not load".
 *
 * ## Scoping is asserted, not assumed
 *
 * `partner1` owns three of the six seeded listings. The API scopes `listOwn` to the `partnerId` in
 * the verified token, so a partner seeing four would mean that scoping had broken — which is the
 * one bug in this app that would matter to somebody other than the person looking at it.
 */

/** Skipped rather than failed where the testbed has not been seeded — see `pnpm db:testbed`. */
test.describe('the partner dashboard', () => {
  test.use({ storageState: PARTNER_STATE });

  test('refuses an anonymous visitor and keeps where they were going', async ({
    page,
  }) => {
    /* This one test needs NO session — the point of it is what an anonymous visitor gets. */
    await page.context().clearCookies();

    const response = await page.goto(`${BASE}/properties`);

    expect(response?.url()).toContain('/login');
    expect(new URL(page.url()).searchParams.get('next')).toBe('/properties');

    /*
      And the page renders like a sign-in page rather than a bare form.

      The brand mark is the point: these are the two screens somebody lands on when something has gone
      wrong, and one that does not look like the product is indistinguishable from a phishing page.
      Both consoles now build it the same way — a server page around a client form.
    */
    await expect(page.getByRole('heading', { name: t.login.title })).toBeVisible();
    await expect(page.getByText(t.login.subtitle)).toBeVisible();
  });

  /**
   * Where they were going is honoured, not merely recorded.
   *
   * The middleware sets `?next=` and says in its own comment that the login page re-validates it —
   * and the form always navigated to `/`, so a partner following a link to their calendar signed in
   * and arrived at the dashboard. The assertion above proved the parameter was SET; nothing proved it
   * was USED, which is exactly the gap a parameter gets dropped through.
   *
   * It signs in for real, through both steps, because that is the only path that can catch this —
   * a stored session never visits the login form. It costs one sign-in from the budget.
   */
  test('returns a partner to where they were going', async ({ page, request }) => {
    await page.context().clearCookies();

    /* Taken before the password goes in, so a mail arriving mid-request is inside the window. */
    const since = new Date();

    await page.goto(`${BASE}/login?next=%2Fproperties`);
    await page.getByLabel(t.login.email).fill(PARTNER_EMAIL);
    await page.getByLabel(t.login.password, { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: t.login.submit }).click();

    await page
      .getByLabel(t.login.codeTitleEmail)
      .fill(await signInCodeFor(request, PARTNER_EMAIL, since));
    await page.getByRole('button', { name: t.login.codeSubmit }).click();

    /* `/properties`, not `/` — the whole assertion. */
    await page.waitForURL(`${BASE}/properties`, { timeout: 20_000 });
    expect(new URL(page.url()).pathname).toBe('/properties');
  });

  /**
   * Everything a signed-in partner sees, on the session `partner.setup.ts` captured.
   *
   * Replaying a stored session rather than signing in again is the login-budget fix described in
   * that file. The sign-in itself is still exercised — by the setup, which fails the whole run if
   * the two-step form breaks, and by the forced-enrolment test below, which signs in for real.
   */
  test('sees only their own listings, and signs out', async ({ page }) => {
    await page.goto(`${BASE}/`);

    // The sidebar names the BUSINESS, not the email — handoff §7.
    await expect(page.locator('aside')).toContainText('قصر الشرق');
    await expect(page.locator('aside')).not.toContainText('@safra.test');

    /*
      لوحة التحكم §7.1 — all four panels, on the screen a partner opens most often.

      Asserted here rather than in a test of their own because a second test means a second
      sign-in, and the login budget is the constraint this file already works around. The KPI
      values themselves are proven in `dashboard.integration.test.ts`; what a browser adds is that
      the panels RENDER — a server component that throws produces an error page, and every
      HTTP-level check in the project would still see a 200.
    */
    await expect(page.getByText(t.dashboard.kpiEarnings)).toBeVisible();
    await expect(page.getByText(t.dashboard.kpiOccupancy)).toBeVisible();
    await expect(
      page.getByRole('heading', { name: t.dashboard.requestsTitle }),
    ).toBeVisible();
    await expect(page.getByText(t.dashboard.requestsRule)).toBeVisible();
    await expect(
      page.getByRole('heading', { name: t.dashboard.alertsTitle }),
    ).toBeVisible();

    /*
      The payout line says one of exactly three things, and never invents a fourth.

      This is the assertion the whole payout ledger exists to make possible: the line describes a
      `partner_payouts` ROW or it says there is none. It must never be a sum of what bookings owe
      rendered as a transfer, so the test pins it to the catalogue's own strings rather than to a
      number — a number would pass whatever the sentence around it claimed.
    */
    const payoutLine = page.locator('[data-payout-line]');

    await expect(payoutLine).toBeVisible();
    await expect(payoutLine).toHaveText(
      new RegExp(
        [
          t.dashboard.payoutNone,
          t.dashboard.payoutScheduled.split('{')[0],
          t.dashboard.payoutAccruing.split('{')[0],
        ]
          .map((part) => part?.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('|'),
      ),
    );

    /*
      The calendar drew a real month of the WHOLE portfolio, not an empty box and not one unit.

      `data-day-available` is the assertion that matters: it is a COUNT of units still bookable
      that day, so its presence proves the grid is describing the portfolio. The old grid painted
      one unit's day status and would satisfy any test that only counted squares.
    */
    const days = page.locator('[data-day][data-day-available]');

    await expect(days.first()).toBeVisible();
    expect(await days.count()).toBeGreaterThanOrEqual(28);

    /* Every square's count is within the portfolio — a negative or excessive one is nonsense. */
    const counts = await days.evaluateAll((nodes) =>
      nodes.map((node) => Number(node.getAttribute('data-day-available'))),
    );

    expect(counts.every((value) => Number.isInteger(value) && value >= 0)).toBe(true);

    /*
      «كل واجهة يجب أن تعمل على كل جهاز» — the standing rule, applied to the third app.

      `responsive.spec.ts` sweeps the console and the customer site and has never touched لوحة
      الشريك, so the dashboard's two-column split and its seven-column calendar grid had nothing
      checking them at 390px. Folded in here rather than added to that file because a separate
      spec would need its own sign-in, and the login budget is the constraint this file works
      around.

      1024 is the width that regresses silently: wide enough to look fine in a screenshot, narrow
      enough that a `lg:` breakpoint has just fired.
    */
    for (const width of [390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(60);

      const spill = await page.evaluate(() => {
        const doc = document.documentElement;
        const by = doc.scrollWidth - doc.clientWidth;

        if (by <= 1) return null;

        let worst = '';
        let worstBy = 0;

        for (const element of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
          const box = element.getBoundingClientRect();
          // RTL overflows to the LEFT, so a negative `left` counts as much as an excessive right.
          const amount = Math.max(-box.left, box.right - doc.clientWidth);

          if (amount > worstBy) {
            worstBy = amount;
            worst = `${element.tagName.toLowerCase()}[${(element.className || '').toString().slice(0, 40)}]`;
          }
        }

        return `+${by}px, widest offender ${worst}`;
      });

      expect(
        spill,
        `dashboard scrolls sideways at ${width}px: ${spill ?? ''}`,
      ).toBeNull();
    }

    await page.setViewportSize({ width: 1440, height: 900 });

    await page.getByRole('link', { name: t.nav.properties }).click();
    await page.waitForURL(/\/properties/);

    const names = await page.locator('article h2').allInnerTexts();

    expect(names.length).toBeGreaterThan(0);

    /*
      Every listing belongs to the partner who signed in. Asserted on the NAME because the testbed
      gives each partner a distinct one — a count alone would pass if the API returned three of
      somebody else's.
    */
    for (const name of names) {
      expect(name).toContain('قصر الشرق');
    }

    // The §7.2 card: a price, the trait chips and a status pill, not just a title.
    const first = page.locator('article').first();

    await expect(first).toContainText('/ ليلة');
    await expect(first.locator('[class*="text-gold"]').first()).toBeVisible();

    // No English enum reached the card.
    expect(await first.innerText()).not.toMatch(/\b(hotel|apartment|published)\b/);

    /*
      مستحقاتي — the partner's own transfers, and the rule that governs the whole screen.

      Every row is a `partner_payouts` ROW. A partner with earnings and no payout sees an empty
      list, which is the truth: SAFRA has recorded no transfer for them. The read-only note is
      asserted because a partner must not go hunting for a button to release their own money —
      the API has no such route, and the screen should not imply one.
    */
    await page.getByRole('link', { name: t.nav.payouts }).click();
    await page.waitForURL(/\/payouts/);

    await expect(page.getByText(t.payouts.readOnly)).toBeVisible();
    await expect(page.getByText(t.payouts.note)).toBeVisible();

    const firstPayout = page.locator('a[href^="/payouts/"]').first();

    if ((await firstPayout.count()) > 0) {
      await firstPayout.click();
      await page.waitForURL(/\/payouts\/PYT-/);

      // The detail answers "what is this amount FOR".
      await expect(page.getByText(t.payouts.coveredBookings)).toBeVisible();
      await expect(page.getByText(t.payouts.net)).toBeVisible();
    }

    /*
      تقييمات ضيوفي §7.3 — and P-006, which is the assertion that matters.

      *"لا يمكن حذف تقييم — يمكنك الرد عليه أو الإبلاغ عنه"*. The rule is printed on the page and
      there is no delete control anywhere on it. Asserted by ABSENCE, deliberately: a screen can
      state a policy and still offer the button that contradicts it, and the button is the thing a
      partner would use.
    */
    await page.getByRole('link', { name: t.nav.reviews }).click();
    await page.waitForURL(/\/reviews/);

    await expect(page.getByText(t.reviews.rule)).toBeVisible();
    await expect(page.getByText(/المعدل العام/)).toBeVisible();

    // The two remedies the rule promises are both here.
    await expect(
      page.getByRole('button', { name: t.reviews.reply }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: t.reviews.report }).first(),
    ).toBeVisible();

    // And nothing that deletes. No button, no link, no menu item.
    await expect(page.getByRole('button', { name: /حذف/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /حذف/ })).toHaveCount(0);

    await page.getByRole('button', { name: t.nav.signOut }).click();
    await page.waitForURL(/\/login/);

    // Back to a guarded page: still signed out.
    await page.goto(`${BASE}/`);
    await expect(page).toHaveURL(/\/login/);
  });
});

/**
 * A partner's second factor, which is a code emailed at every sign-in (Bashar, 2026-08-20).
 *
 * ## What this replaced
 *
 * Until that date partners had to enrol a TOTP app, and this block asserted the gate: an
 * unenrolled partner was held at `/enrol-2fa` and could reach nothing else. That requirement is
 * gone — a partner proves a code sent to their inbox, so there is nothing to enrol and nobody to
 * hold. The tests were rewritten rather than deleted, because the REQUIREMENT moved rather than
 * disappeared: a partner still cannot get in on a password alone.
 *
 * ## Why a browser test and not only an integration one
 *
 * The refusal that matters is the API's, and that is covered without a browser. What those tests
 * cannot see is the journey: whether somebody who signs in actually arrives somewhere they can act
 * on. A second factor enforced perfectly on the server and forgotten in the app is a partner
 * staring at a screen they cannot pass — which is exactly the shape of the bug this change was
 * made to fix, where the invitation page did not exist and every accepted partner was stranded.
 *
 * ## Two tests, and why so few
 *
 * `POST /auth/login` is rate limited per (IP, account) and the suite has a budget. These are the
 * smallest pair that covers the requirement: a password alone does not get in, and the emailed
 * code does. The rest — expiry, reuse, attempt limits, the resend throttle — is proven in
 * `login-code.service` territory without a browser and without the limiter.
 */
test.describe('the partner sign-in code', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  /**
   * A password alone is not enough, and the form says where to look.
   *
   * The wording is asserted, not just the pause. «افتح تطبيق المصادقة» to somebody whose code is
   * sitting in their inbox is a person hunting their phone for an app they never installed — which
   * is why the API answers with two different codes and the form reads them.
   */
  test('stops at a code step and points at the inbox', async ({ page }) => {
    /* Its own account — see `THIRD_PARTNER_EMAIL` on why these two must not share an inbox. */
    await page.goto(`${BASE}/login`);
    await page.getByLabel(t.login.email).fill(THIRD_PARTNER_EMAIL);
    await page.getByLabel(t.login.password, { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: t.login.submit }).click();

    await expect(page.getByLabel(t.login.codeTitleEmail)).toBeVisible();
    await expect(page.getByText(t.login.codeLabelEmail)).toBeVisible();

    /* Still on the sign-in page: no session was issued on the password alone. */
    await expect(page).toHaveURL(/\/login/);

    /* And a way to ask again, for the mail that never arrives. */
    await expect(page.getByRole('button', { name: t.login.codeResend })).toBeVisible();
  });

  /**
   * The code from the inbox completes the sign-in — and lands on the DASHBOARD.
   *
   * `/enrol-2fa` is asserted against explicitly. Until 2026-08-20 middleware sent every unenrolled
   * partner there and let them reach nothing else; leaving that in place after the second factor
   * moved would have trapped every partner on the platform on a screen they were never asked to
   * complete. This is the assertion that would have caught it.
   */
  test('completes the sign-in with the code from the inbox', async ({
    page,
    request,
  }) => {
    const since = new Date();

    await page.goto(`${BASE}/login`);
    await page.getByLabel(t.login.email).fill(SECOND_PARTNER_EMAIL);
    await page.getByLabel(t.login.password, { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: t.login.submit }).click();

    await page
      .getByLabel(t.login.codeTitleEmail)
      .fill(await signInCodeFor(request, SECOND_PARTNER_EMAIL, since));
    await page.getByRole('button', { name: t.login.codeSubmit }).click();

    await page.waitForURL(`${BASE}/`, { timeout: 20_000 });
    expect(new URL(page.url()).pathname).toBe('/');
  });
});
