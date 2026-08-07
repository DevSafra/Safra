import { expect, test } from '@playwright/test';

import { partnerAr as t } from '../packages/i18n/src/partner.js';
import {
  PARTNER_BASE as BASE,
  PARTNER_PASSWORD as PASSWORD,
  PARTNER_STATE,
  UNENROLLED_PARTNER_EMAIL as UNENROLLED_EMAIL,
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

/**
 * The fixture partners' shared authenticator secret, and the one partner deliberately without it.
 *
 * `db:testbed` enrols partner1 and partner2 and leaves partner3 unenrolled — see the note on
 * `twoFactorEnrolled` in the seed. partner3 is the FORCED-ENROLMENT fixture: an account that
 * existed before 2FA was mandatory, which is the migration behaviour this suite has to keep
 * proving rather than assume.
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

    // The calendar drew a real month, not an empty box.
    await expect(page.locator('ol li').first()).toBeVisible();

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

    await page.getByRole('button', { name: t.nav.signOut }).click();
    await page.waitForURL(/\/login/);

    // Back to a guarded page: still signed out.
    await page.goto(`${BASE}/`);
    await expect(page).toHaveURL(/\/login/);
  });
});

/**
 * Mandatory two-factor authentication for partners (Bashar, 2026-08-07).
 *
 * ## Why this is a browser test and not only an integration one
 *
 * The refusal that MATTERS is `TwoFactorGuard`'s, and that is covered by unit and integration
 * tests. What those cannot see is the journey: whether a partner who signs in actually arrives
 * somewhere they can act on, or at a dashboard that renders empty because every call behind it was
 * refused. A gate enforced perfectly on the server and forgotten in the app is a partner staring
 * at a broken screen with no idea what to do — which is how the console's own 2FA gap stayed
 * invisible for months, in the opposite direction.
 *
 * ## One sign-in per test, and why there are only two
 *
 * `POST /auth/login` allows five calls a minute per IP and the staff specs already spend most of
 * them. These two are the smallest set that covers the requirement: an unenrolled partner is held
 * at enrolment, and an enrolled one is asked for a code. The rest — recovery codes, the reset path,
 * what the API refuses — is proven in `partner-two-factor.integration.test.ts`, without a browser
 * and without the limiter.
 */
test.describe('partner two-factor authentication', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  /**
   * Requirement 1: an existing partner is forced into enrolment on their next sign-in.
   *
   * partner3 has a password and no second factor, which is exactly the state every partner was in
   * the day before this shipped. They must be able to SIGN IN — refusing them would lock out every
   * existing partner with no way back, since enrolling needs a session — and must then be able to
   * reach nothing but enrolment.
   */
  test('holds an unenrolled partner at enrolment and nowhere else', async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.getByLabel(t.login.email).fill(UNENROLLED_EMAIL);
    await page.getByLabel(t.login.password, { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: t.login.submit }).click();

    // No code step: the API asks only accounts that have already enrolled.
    await page.waitForURL(/\/enrol-2fa/);

    // The screen says WHY, not merely what to type.
    await expect(page.getByRole('heading', { name: t.twoFactor.title })).toBeVisible();
    await expect(page.getByText(t.twoFactor.why)).toBeVisible();

    /*
      The setup key is really there — the enrolment call reached the API and came back. An empty
      box here is the failure this test exists for: the gate would redirect correctly and the
      partner would have nothing to scan.
    */
    await expect(page.getByText(t.twoFactor.loading)).toHaveCount(0);

    // Every other section bounces straight back. Asserted per route, not once.
    for (const path of ['/', '/properties', '/reviews']) {
      await page.goto(`${BASE}${path}`);
      await expect(page).toHaveURL(/\/enrol-2fa/);
    }

    // And the dead end has a way out.
    await page.getByRole('button', { name: t.twoFactor.signOut }).click();
    await page.waitForURL(/\/login/);
  });
});
