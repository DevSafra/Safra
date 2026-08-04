import { expect, test, type Page } from '@playwright/test';

import { AR } from '../apps/admin/src/lib/strings.js';
import { MISSING_CREDENTIALS, SKIP_REASON, STAFF_STATE } from './staff.js';

/**
 * The nineteen admin sections, against the design handoff.
 *
 * ## What these assert, and what they deliberately do not
 *
 * The SHAPE, never the numbers. Seeded data changes every time the integration suite runs, so a
 * test that pinned "60 bookings" would fail every morning for a reason unrelated to the console.
 * What matters is that each section the handoff specifies exists, is reachable from the sidebar,
 * renders in Arabic, and is populated from the API rather than from placeholder markup.
 *
 * ## Why one spec for all of them
 *
 * They share one session and one navigation pattern, and the interesting failures are the ones
 * that hit every section at once — a broken shell, a missing token, an expired cookie. Nineteen
 * files would hide that behind nineteen identical setups.
 */
test.skip(MISSING_CREDENTIALS, SKIP_REASON);

test.use({ storageState: STAFF_STATE });

/** Every section: its route, its heading, and whether it is backed by data yet. */
const SECTIONS = [
  { path: '/', title: AR.admin.title, built: true },
  { path: '/bookings', title: AR.nav.bookings, built: true },
  { path: '/partners', title: AR.nav.partners, built: true },
  { path: '/properties', title: AR.nav.properties, built: true },
  { path: '/customers', title: AR.nav.customers, built: true },
  { path: '/staff', title: AR.nav.staff, built: true },
  { path: '/payments', title: AR.nav.payments, built: true },
  { path: '/wallet', title: AR.nav.wallet, built: true },
  { path: '/giftcards', title: AR.nav.giftCards, built: true },
  { path: '/coupons', title: AR.nav.coupons, built: true },
  { path: '/geo', title: AR.nav.geo, built: true },
  { path: '/reports', title: AR.nav.reports, built: true },
  { path: '/settings', title: AR.nav.settings, built: true },
  { path: '/audit', title: AR.nav.audit, built: true },
  { path: '/emergency', title: AR.admin.emergencyMode, built: true },
  // Present in the design, no table behind them yet — see docs/design-gap-report.md §4.
  { path: '/ads', title: AR.nav.ads, built: false },
  { path: '/disputes', title: AR.nav.disputes, built: false },
  { path: '/messages', title: AR.nav.messages, built: false },
  { path: '/comms', title: AR.nav.whatsapp, built: false },
] as const;

/** The failure message every section renders when its fetch does not parse. */
const LOAD_FAILED = AR.dashboard.queueFailed;

test.describe('every admin section the design specifies', () => {
  for (const section of SECTIONS) {
    test(`${section.path} renders and loads its data`, async ({ page }) => {
      await page.goto(section.path);

      await expect(
        page.getByRole('heading', { name: section.title, level: 1 }),
      ).toBeVisible();

      /**
       * THE assertion that matters most.
       *
       * `staffFetch` returns the string `'failed'` on any parse error and the page then renders a
       * generic "could not load this list" — silently, with nothing in any log. That is exactly
       * how the listing queue stayed broken for weeks. Asserting the message is ABSENT is the
       * only cheap way to catch a schema that drifted from its endpoint.
       */
      await expect(page.getByText(LOAD_FAILED)).toBeHidden();
      await expect(page.getByText(AR.dashboard.countersFailed)).toBeHidden();

      if (!section.built) {
        // An unbuilt section must SAY so. An empty table would read as "there are none".
        await expect(page.getByText(AR.unbuilt.heading)).toBeVisible();
      }
    });
  }

  /**
   * Every sidebar item leads somewhere that renders.
   *
   * The regression this catches is a nav entry pointing at a route that does not exist: the
   * sidebar previously linked `/partners` and `/properties` before either page was written, and
   * nothing failed until somebody clicked.
   */
  test('every sidebar link resolves to a real page', async ({ page }) => {
    await page.goto('/');

    const hrefs = await page
      .locator('aside a[href]')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));

    // Eighteen rows in the design's nav; Emergency Mode is reached from the header.
    expect(hrefs.length).toBe(18);

    for (const href of hrefs) {
      const response = await page.goto(href);

      expect(response?.status(), `${href} should render`).toBe(200);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    }
  });
});

test.describe('the section tables behave like tables', () => {
  /**
   * Search is server-side, so it must change the URL and the result set.
   *
   * A client-side substring filter would leave the URL untouched — and would search only the
   * current page, reporting "no results" for a row that exists on page two.
   */
  test('search submits to the server and is reflected in the URL', async ({ page }) => {
    await page.goto('/partners');

    const term = await page
      .locator('table tbody tr')
      .first()
      .locator('td')
      .nth(1)
      .innerText();

    const word = term.trim().split(/\s+/)[0] ?? '';

    test.skip(word.length < 3, 'The seeded partner name is too short to search on');

    await page.getByPlaceholder(AR.sections.partners.searchPlaceholder).fill(word);
    await page.getByRole('button', { name: AR.table.search }).click();

    await expect(page).toHaveURL(new RegExp(`q=${encodeURIComponent(word)}`));
    await expect(page.getByText(LOAD_FAILED)).toBeHidden();
  });

  /** Paging forward must advance, and must not repeat the first row. */
  test('the pager advances without repeating a row', async ({ page }) => {
    await page.goto('/customers');

    const firstReference = await firstCell(page);
    const next = page.getByRole('link', { name: AR.table.nextPage });

    test.skip((await next.count()) === 0, 'Not enough seeded customers to page');

    await next.click();

    await expect(page).toHaveURL(/cursor=/);
    expect(await firstCell(page)).not.toBe(firstReference);
  });

  /**
   * The booking status filter must actually filter.
   *
   * Asserted by reading the status column rather than by trusting the URL: a filter that lands in
   * the query string and is ignored by the query is the failure worth catching.
   */
  test('the booking status filter narrows the result set', async ({ page }) => {
    await page.goto('/bookings');

    await page.getByLabel(AR.table.colStatus).selectOption('cancelled');
    await page.getByRole('button', { name: AR.table.search }).click();

    await expect(page).toHaveURL(/status=cancelled/);

    const statuses = await page.locator('table tbody tr td:nth-child(6)').allInnerTexts();

    expect(statuses.length).toBeGreaterThan(0);

    for (const status of statuses) {
      expect(status.trim()).toBe(AR.bookingStatus['cancelled']);
    }
  });
});

test.describe('honesty rules the design and the register require', () => {
  /**
   * The permission matrix must be the REAL one.
   *
   * §14 requires it to be "enforced server-side, not just rendered". It is derived from
   * `ROLE_PERMISSIONS`, so the check is that a permission only super_admin holds shows exactly
   * one tick — a transcribed table would drift from that the first time a role changed.
   */
  test('the permission matrix reflects the real role map', async ({ page }) => {
    await page.goto('/staff');

    const row = page.locator('table tr', { hasText: 'emergency_mode.activate' }).first();

    await expect(row).toBeVisible();
    await expect(row.locator('td', { hasText: '✓' })).toHaveCount(1);

    // And the design's third state is disclaimed rather than drawn.
    await expect(page.getByText(AR.sections.staff.noApprovalTier)).toBeVisible();
    await expect(page.locator('table td', { hasText: '○' })).toHaveCount(0);
  });

  /** The audit log must state that it cannot be edited — the design leads with it. */
  test('the audit log declares itself append-only', async ({ page }) => {
    await page.goto('/audit');

    await expect(page.getByText(AR.sections.audit.immutable)).toBeVisible();
    await expect(
      page.getByRole('columnheader', { name: AR.sections.audit.colIp }),
    ).toBeVisible();
  });

  /**
   * Emergency Mode cannot be armed by one click.
   *
   * It halts commerce in a region and may broadcast to every customer with an upcoming booking
   * there. The button must stay inert until a target, a reason and at least one flag are present.
   */
  test('emergency mode refuses to arm without a target and a reason', async ({
    page,
  }) => {
    await page.goto('/emergency');

    const arm = page.getByRole('button', { name: AR.admin.handle });

    await expect(arm).toBeDisabled();
    await expect(
      page.getByRole('button', { name: AR.sections.emergency.activate }),
    ).toHaveCount(0);
  });

  /** Gift card codes are hashed; the console must never show a whole one. */
  test('gift cards show only the last four characters', async ({ page }) => {
    await page.goto('/giftcards');

    await expect(page.getByText(AR.sections.giftcards.codeNote)).toBeVisible();
  });

  /**
   * The payments screen must admit that partner payouts are not shown.
   *
   * The design has a تحويل شريك row type; there is no payouts table. Deriving one from
   * `partner_payable_amount` would present an obligation as a transfer that happened.
   */
  test('payments says partner transfers are absent rather than faking them', async ({
    page,
  }) => {
    await page.goto('/payments');

    await expect(page.getByText(AR.sections.payments.payoutsMissing)).toBeVisible();
  });
});

/** The first body cell of the first row — used to prove a page actually changed. */
async function firstCell(page: Page): Promise<string> {
  return page.locator('table tbody tr').first().locator('td').first().innerText();
}
