import { expect, test } from '@playwright/test';

import en from '../packages/i18n/src/messages/web/en.json' assert { type: 'json' };

/**
 * الفواتير, from the customer's side (handoff §6).
 *
 * ## What a browser adds over the integration tests
 *
 * `invoices.integration.test.ts` proves the rules — the scope predicate, the `draft` exclusion, the
 * keyset page, and that every amount arrives as the exact stored decimal. What it cannot see is the
 * JOURNEY, and this screen is four server components and a proxy deep:
 *
 * - a `safeParse` mismatch anywhere in `getMyInvoices` renders "could not load" and returns **200**,
 *   so an HTTP-level check passes while the page is empty;
 * - the trip OUT to a booking and BACK is the whole reason `returnParam('invoices')` exists, and it
 *   depends on an allow-list entry that no unit test exercises through a real link;
 * - the 404 path must not be distinguishable from "not yours", which is a routing behaviour.
 *
 * ## One sign-in, and it spends from a hard budget
 *
 * `POST /auth/login` allows ten calls a minute per IP and this suite already makes fourteen, so this
 * spends exactly ONE and asserts everything from that single session. It is in the `signed-in`
 * project, ordered last, where a sign-in can starve nothing that follows it.
 *
 * It writes NOTHING. Every assertion here is a read, so the spec is idempotent and leaves no fixture
 * consumed — unlike the rows-per-page bar, which has to be put back.
 */
const PASSWORD = process.env['TESTBED_PASSWORD'] ?? 'a-testbed-password-1';
const EMAIL = 'customer@safra.test';

test.use({ baseURL: 'http://localhost:3000' });

test.describe('الفواتير', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('lists receipts, opens one, and comes back from the booking', async ({ page }) => {
    await page.goto('/en/login?next=%2Fen%2Faccount%2Finvoices');
    await page.getByLabel(en.auth.email).fill(EMAIL);
    await page.locator('input[type=password]').first().fill(PASSWORD);
    await page.getByRole('button', { name: en.auth.signIn }).first().click();
    await page.waitForURL(/\/account\/invoices/, { timeout: 20_000 });

    /*
      ONE main landmark.

      `AccountShell` used to add a second `<main>` inside the one `layout.tsx` already provides, so
      every account page shipped two nested main landmarks — invalid HTML, and an ambiguous landmark
      list for a screen reader. Found by a browser probe; asserted here so it cannot come back.
    */
    await expect(page.locator('main')).toHaveCount(1);

    const rows = page.locator('li a[href*="/account/invoices/"]');

    await expect(rows.first()).toBeVisible();

    /* The disclaimer is the reason this screen is allowed to exist — see `O-fin-1`. */
    await expect(page.getByText(en.account.invoicesNotTax)).toBeVisible();

    const href = await rows.first().getAttribute('href');
    const reference = decodeURIComponent((href ?? '').split('/').pop() ?? '');

    expect(reference).toMatch(/^BKG-/);

    // ── The detail screen ──
    await rows.first().click();
    await page.waitForURL(new RegExp(`/account/invoices/${reference}`), {
      timeout: 20_000,
    });

    const breakdown = page.locator('section').filter({
      hasText: en.account.invoiceBreakdownHeading,
    });

    await expect(
      breakdown.getByText(en.account.invoiceLines.accommodation),
    ).toBeVisible();
    await expect(breakdown.getByText(en.account.invoiceLines.serviceFee)).toBeVisible();

    /*
      Every figure in the column carries two decimals.

      A whole amount formatted as `$380` beside `$1.99` reads as a different kind of number, which is
      what `formatMoney(..., { exact: true })` exists to prevent on a financial document.
    */
    const amounts = (await breakdown.innerText())
      .split('\n')
      .filter((line) => /^[^\d]*\d/.test(line) && /[$€£]|\d/.test(line))
      .filter((line) => /[$]/.test(line));

    expect(amounts.length).toBeGreaterThan(0);

    for (const amount of amounts) {
      expect(amount.trim()).toMatch(/\.\d{2}$/);
    }

    // ── Out to the booking, and back to where we were ──
    await page.getByRole('link', { name: en.account.invoiceBookingLink }).click();
    await page.waitForURL(/\/booking\/BKG-/, { timeout: 20_000 });
    expect(new URL(page.url()).searchParams.get('from')).toBe('invoices');

    await page
      .getByRole('link', { name: new RegExp(en.common.back, 'i') })
      .first()
      .click();
    await page.waitForURL(/\/account\/invoices$/, { timeout: 20_000 });

    // ── Back from the receipt itself returns to the list ──
    await rows.first().click();
    await page.waitForURL(/\/account\/invoices\/BKG-/, { timeout: 20_000 });
    await page
      .getByRole('link', { name: new RegExp(en.common.back, 'i') })
      .first()
      .click();
    await page.waitForURL(/\/account\/invoices$/, { timeout: 20_000 });

    /*
      A reference that is not this customer's answers 404, indistinguishably from one that does not
      exist. References are short and sequential, so any difference between the two is a way to
      enumerate them.
    */
    for (const forged of ['BKG-2026-000001', 'BKG-TEST-nope', 'not-a-reference']) {
      const response = await page.goto(`/en/account/invoices/${forged}`, {
        waitUntil: 'domcontentloaded',
      });

      expect(response?.status(), `${forged} must 404`).toBe(404);
    }

    /*
      ── The PDF ──

      `window.print()` opens a native dialog Playwright cannot drive, so what is asserted is everything
      up to it: the control exists, and the document the dialog would capture is the RECEIPT rather than
      a screenshot of the app. `emulateMedia` applies the print stylesheet without printing anything,
      which is the only way to see this — the screen render is green whether or not the print rules work.
    */
    await page.goto(`/en/account/invoices/${encodeURIComponent(reference)}`, {
      waitUntil: 'domcontentloaded',
    });

    const download = page.getByRole('button', { name: en.account.invoiceDownload });

    await expect(download).toBeVisible();

    await page.emulateMedia({ media: 'print' });

    /* The screen chrome leaves the paper: the site header, the account nav, and the control itself. */
    await expect(page.locator('header')).toBeHidden();
    await expect(
      page.getByRole('navigation', { name: en.account.navHeading }),
    ).toBeHidden();
    await expect(download).toBeHidden();
    await expect(
      page.getByRole('link', { name: en.account.invoiceBookingLink }),
    ).toBeHidden();

    /* The record itself stays, and so does the sentence saying what it is not. */
    await expect(page.getByText(reference).first()).toBeVisible();
    await expect(
      page.getByText(en.account.invoiceLines.accommodation).first(),
    ).toBeVisible();
    await expect(page.getByText(en.account.invoicesNotTax)).toBeVisible();

    /* Paper is white. A dark card behind black text prints as a solid block of ink. */
    const paper = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor,
    );

    expect(paper).toBe('rgb(255, 255, 255)');

    await page.emulateMedia({ media: 'screen' });

    /*
      ── The ISO date is isolated in Arabic ──

      `«دفع في 2026-08-08»` rendered as `«دفع في 08-08-2026»`: hyphens are bidi-NEUTRAL, so an RTL
      paragraph lays the three numeric runs out right to left and the date reads backwards while every
      digit is still correct. Invisible to a string assertion — the DOM held the right characters — and
      found by generating the PDF and looking at it.

      What can be checked here is the mechanism: the U+2066 isolate reaching the rendered page. Whether
      the browser then DRAWS it correctly is what the PDF render proved.
    */
    await page.goto(`/ar/account/invoices/${encodeURIComponent(reference)}`, {
      waitUntil: 'domcontentloaded',
    });

    const arabicPaid = await page.locator('section').first().innerText();
    const paidLine = (await page.locator('body').innerText())
      .split('\n')
      .find((line) => line.includes('2026-') && line.includes('\u2066'));

    expect(arabicPaid.length).toBeGreaterThan(0);
    expect(paidLine, 'the paid-on date must carry a U+2066 isolate').toBeDefined();

    // ── No page scrolls sideways, at every documented width ──
    for (const width of [390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });

      for (const path of [
        '/ar/account/invoices',
        `/ar/account/invoices/${encodeURIComponent(reference)}`,
      ]) {
        await page.goto(path, { waitUntil: 'domcontentloaded' });

        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );

        expect(overflow, `${path} at ${width}px scrolls sideways`).toBeLessThanOrEqual(0);
      }
    }
  });
});
