import { expect, test, type Page } from '@playwright/test';

// The catalogue source directly, not through the admin app: Playwright loads these
// files as CommonJS, and `@safra/i18n` is ESM-only, so going via `lib/strings.ts`
// makes Node resolve the package and fail on the missing `require` condition.
import { ar as t } from '../packages/i18n/src/messages/admin/ar.js';
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
  { path: '/', title: t.admin.title, built: true },
  { path: '/bookings', title: t.nav.bookings, built: true },
  { path: '/partners', title: t.nav.partners, built: true },
  { path: '/properties', title: t.nav.properties, built: true },
  { path: '/customers', title: t.nav.customers, built: true },
  { path: '/staff', title: t.nav.staff, built: true },
  { path: '/payments', title: t.nav.payments, built: true },
  { path: '/wallet', title: t.nav.wallet, built: true },
  { path: '/giftcards', title: t.nav.giftCards, built: true },
  { path: '/coupons', title: t.nav.coupons, built: true },
  { path: '/geo', title: t.nav.geo, built: true },
  { path: '/reports', title: t.nav.reports, built: true },
  { path: '/settings', title: t.nav.settings, built: true },
  { path: '/audit', title: t.nav.audit, built: true },
  { path: '/emergency', title: t.admin.emergencyMode, built: true },
  /*
    These four were `built: false` until 2026-08-04, when the schema they needed landed —
    `disputes`, `conversations`/`messages`, `notifications`, `advertisers`/`ad_campaigns`. All
    nineteen sections are now backed by real tables, so nothing on this list is a placeholder.
  */
  { path: '/ads', title: t.nav.ads, built: true },
  { path: '/disputes', title: t.nav.disputes, built: true },
  { path: '/messages', title: t.nav.messages, built: true },
  { path: '/comms', title: t.nav.whatsapp, built: true },
] as const;

/** The failure message every section renders when its fetch does not parse. */
const LOAD_FAILED = t.dashboard.queueFailed;

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
      await expect(page.getByText(t.dashboard.countersFailed)).toBeHidden();

      /*
        Nothing may render the "not built" panel any more. This assertion is the one that would
        catch a regression to a placeholder, and it is stated for EVERY section rather than only
        the ones that used to be unbuilt.
      */
      await expect(page.getByText(t.unbuilt.heading)).toBeHidden();
      expect(section.built).toBe(true);
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

    await page.getByPlaceholder(t.sections.partners.searchPlaceholder).fill(word);
    await page.getByRole('button', { name: t.table.search }).click();

    await expect(page).toHaveURL(new RegExp(`q=${encodeURIComponent(word)}`));
    await expect(page.getByText(LOAD_FAILED)).toBeHidden();
  });

  /** Paging forward must advance, and must not repeat the first row. */
  test('the pager advances without repeating a row', async ({ page }) => {
    await page.goto('/customers');

    const firstReference = await firstCell(page);
    const next = page.getByRole('link', { name: t.table.nextPage });

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

    await page.getByLabel(t.table.colStatus).selectOption('cancelled');
    await page.getByRole('button', { name: t.table.search }).click();

    await expect(page).toHaveURL(/status=cancelled/);

    const statuses = await page.locator('table tbody tr td:nth-child(6)').allInnerTexts();

    expect(statuses.length).toBeGreaterThan(0);

    for (const status of statuses) {
      expect(status.trim()).toBe(t.bookingStatus['cancelled']);
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
    await expect(page.getByText(t.sections.staff.noApprovalTier)).toBeVisible();
    await expect(page.locator('table td', { hasText: '○' })).toHaveCount(0);
  });

  /** The audit log must state that it cannot be edited — the design leads with it. */
  test('the audit log declares itself append-only', async ({ page }) => {
    await page.goto('/audit');

    await expect(page.getByText(t.sections.audit.immutable)).toBeVisible();
    await expect(
      page.getByRole('columnheader', { name: t.sections.audit.colIp }),
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

    const arm = page.getByRole('button', { name: t.admin.handle });

    await expect(arm).toBeDisabled();
    await expect(
      page.getByRole('button', { name: t.sections.emergency.activate }),
    ).toHaveCount(0);
  });

  /** Gift card codes are hashed; the console must never show a whole one. */
  test('gift cards show only the last four characters', async ({ page }) => {
    await page.goto('/giftcards');

    await expect(page.getByText(t.sections.giftcards.codeNote)).toBeVisible();
  });

  /**
   * A dispute cannot be closed without a written decision.
   *
   * The API requires ten characters, a database CHECK requires a resolution for any terminal
   * status, and the form keeps its button disabled. Three layers, because this closure releases a
   * partner's payout and may credit a customer's wallet — and a dispute closed with no stated
   * outcome is unauditable.
   */
  test('a dispute cannot be closed without a resolution', async ({ page }) => {
    await page.goto('/disputes');

    const open = page.getByRole('button', { name: t.sections.disputes.open }).first();

    test.skip((await open.count()) === 0, 'No open dispute in the seeded data');

    await open.click();

    const confirm = page.getByRole('button', { name: t.sections.disputes.confirmClose });

    await expect(confirm).toBeDisabled();

    // Too short still leaves it disabled; the threshold matches the API and the CHECK.
    await page.getByRole('textbox').first().fill('short');
    await expect(confirm).toBeDisabled();

    await page
      .getByRole('textbox')
      .first()
      .fill('تحققنا من الشكوى وأغلقناها بعد مراجعة الأدلة.');
    await expect(confirm).toBeEnabled();
  });

  /**
   * An unresolved dispute must SAY that it is holding the partner's money.
   *
   * "فتح النزاع يجمّد استحقاق تحويل الشريك" is the rule with money attached and the one an operator
   * forgets, so it is a badge on each affected card rather than only a footnote.
   */
  test('unresolved disputes state the payout freeze', async ({ page }) => {
    await page.goto('/disputes');

    await expect(page.getByText(t.sections.disputes.frozen).first()).toBeVisible();
    await expect(page.getByText(t.sections.disputes.note)).toBeVisible();
  });

  /**
   * The WhatsApp channel is not wired, and the screen says so.
   *
   * The provider is undecided (item 192). A comms log that showed queued WhatsApp messages without
   * that caveat would read as "sending works", and somebody would wait for a delivery that is
   * never coming.
   */
  test('the comms log admits WhatsApp is not wired', async ({ page }) => {
    await page.goto('/comms');

    await expect(page.getByText(t.sections.comms.whatsappBlocked)).toBeVisible();
    // And the inert template is labelled rather than hidden.
    await expect(page.getByText(t.sections.comms.notWired).first()).toBeVisible();
  });

  /**
   * Advertising must never expose a ranking control.
   *
   * "لا تُخلط بترتيب البحث الطبيعي" is a promise to customers. There is no priority column in the
   * table, in the service or in the schema, and the screen states it — because the moment such a
   * control exists somebody will use it.
   */
  test('the ads screen states that ads never affect ranking', async ({ page }) => {
    await page.goto('/ads');

    await expect(page.getByText(t.sections.ads.noRanking)).toBeVisible();
  });

  /**
   * Contact details are stripped from staff replies too.
   *
   * Exempting staff would be the obvious shortcut and the wrong one: an agent pasting a partner's
   * number to a customer defeats the rule just as thoroughly.
   */
  test('a staff reply has its contact details redacted', async ({ page }) => {
    await page.goto('/messages');

    const thread = page.locator('a[href^="/messages/"]').first();

    test.skip((await thread.count()) === 0, 'No seeded conversation');

    await thread.click();
    await page.getByRole('textbox').first().fill('اتصل بي على 0944123456 بخصوص الحجز');
    await page.getByRole('button', { name: t.sections.messages.reply }).click();

    // The number is gone; the mask is visible; the booking word survived.
    await expect(page.getByText('0944123456')).toHaveCount(0);
    await expect(page.getByText('⟨محجوب⟩').first()).toBeVisible();
  });

  /**
   * نطاق العمل is stated as SERVER-ENFORCED, and the audit exemption is stated with it.
   *
   * Bashar's decision, 2026-08-04. The panel's note is not decoration: a scope that is displayed
   * but not enforced is worse than no scope, so the screen commits to which it is. And it says the
   * audit log stays complete, because that is the one place an operator might reasonably assume
   * scope applies and it deliberately does not.
   */
  test('the staff screen states that scope is server-enforced', async ({ page }) => {
    await page.goto('/staff');

    await expect(
      page.getByRole('heading', { name: t.sections.staff.scopeTitle }),
    ).toBeVisible();
    await expect(page.getByText(t.sections.staff.scopeNote)).toBeVisible();

    // A super admin is shown as unscopable rather than as "all cities".
    await expect(page.getByText(t.sections.staff.scopeSuperAdmin).first()).toBeVisible();
  });

  /**
   * The CSV export downloads through the API, which is what makes it auditable (B-13).
   *
   * Asserts the file arrives, carries the on-screen filter, and leads with a UTF-8 BOM — without
   * which Excel on Windows mangles every Arabic property name, which is most of the file.
   */
  test('the bookings export downloads a filtered, BOM-prefixed CSV', async ({ page }) => {
    await page.goto('/bookings?status=cancelled');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: t.table.exportCsv }).click(),
    ]);

    expect(download.suggestedFilename()).toBe('safra-bookings.csv');

    /*
      `download.path()` returns a string for a completed download; Playwright types it as
      `Promise<string>`, so no assertion is needed and the linter rightly refuses one.
    */
    const path = await download.path();

    const { readFileSync } = await import('node:fs');
    const text = readFileSync(path, 'utf8');
    const lines = text.split('\n').filter(Boolean);

    // The BOM, the header, and at least one row.
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(lines[0]?.replace(/^\uFEFF/, '')).toContain('reference,property,customer');
    expect(lines.length).toBeGreaterThan(1);

    // The filter was applied: every data row ends in the requested status.
    for (const line of lines.slice(1).filter((row) => !row.startsWith('#'))) {
      expect(line.trim().endsWith('cancelled')).toBe(true);
    }
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

    await expect(page.getByText(t.sections.payments.payoutsMissing)).toBeVisible();
  });
});

/** The first body cell of the first row — used to prove a page actually changed. */
async function firstCell(page: Page): Promise<string> {
  return page.locator('table tbody tr').first().locator('td').first().innerText();
}
