import { expect, test } from '@playwright/test';

import { partnerAr as t } from '../packages/i18n/src/partner.js';

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
const BASE = process.env['PARTNER_URL'] ?? 'http://localhost:3002';
const EMAIL = process.env['DEV_PARTNER_EMAIL'] ?? 'partner1@safra.test';
const PASSWORD = process.env['TESTBED_PASSWORD'] ?? 'a-testbed-password-1';

/** Skipped rather than failed where the testbed has not been seeded — see `pnpm db:testbed`. */
test.describe('the partner dashboard', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('refuses an anonymous visitor and keeps where they were going', async ({
    page,
  }) => {
    const response = await page.goto(`${BASE}/properties`);

    expect(response?.url()).toContain('/login');
    expect(new URL(page.url()).searchParams.get('next')).toBe('/properties');
  });

  /**
   * One sign-in for everything that needs one.
   *
   * `POST /auth/login` allows five calls a minute per IP and the staff specs already spend most of
   * them — adding a second partner sign-in pushed the whole suite over the limit and failed two
   * console tests for a reason that had nothing to do with the console. So this test signs in
   * once, asserts what a signed-in partner sees, and signs out at the end.
   *
   * If this needs splitting later, add a `partner.setup.ts` project that saves a storage state,
   * the way `auth.setup.ts` does for staff. Do not simply add another sign-in.
   */
  test('signs in, sees only their own listings, and signs out', async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.getByLabel(t.login.email).fill(EMAIL);
    await page.getByLabel(t.login.password, { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: t.login.submit }).click();

    await page.waitForURL(`${BASE}/`);

    // The sidebar names the BUSINESS, not the email — handoff §7.
    await expect(page.locator('aside')).toContainText('قصر الشرق');
    await expect(page.locator('aside')).not.toContainText('@safra.test');

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

    await page.getByRole('button', { name: t.nav.signOut }).click();
    await page.waitForURL(/\/login/);

    // Back to a guarded page: still signed out.
    await page.goto(`${BASE}/`);
    await expect(page).toHaveURL(/\/login/);
  });
});
