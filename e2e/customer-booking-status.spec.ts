import { expect, test } from '@playwright/test';

import ar from '../packages/i18n/src/messages/web/ar.json' assert { type: 'json' };

/**
 * حجوزاتي shows three states and no others (Bashar, 2026-08-18).
 *
 * ## Why this needs a browser
 *
 * `booking-status-pill.test.ts` proves the MAPPING — eight statuses in, three out. What it cannot
 * prove is that the pages call it: both screens previously passed `booking.status` straight to the
 * pill, and a page that kept doing so would render «مكتمل» while every unit test stayed green.
 *
 * The fixture customer is what makes this worth running: they hold four `completed` bookings, so a
 * screen that had not been collapsed would show a fourth word here rather than merely being
 * untested.
 *
 * ## One sign-in, deliberately
 *
 * `POST /auth/login` is throttled per IP and this suite already runs at the ceiling, so both
 * assertions come from a single session — the same discipline `customer-invoices.spec.ts` keeps,
 * and for the same reason.
 */
const PASSWORD = process.env['TESTBED_PASSWORD'] ?? 'a-testbed-password-1';
const EMAIL = 'customer@safra.test';

/** The three, and the fact there are exactly three, is the assertion. */
const ALLOWED = [
  ar.account.status.cancelled,
  ar.account.status.pending_confirmation,
  ar.account.status.confirmed,
];

test.use({ baseURL: 'http://localhost:3000' });

test.describe('حجوزاتي', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('shows only ملغى, قيد التأكيد and مؤكد — on both screens that draw a booking', async ({
    page,
  }) => {
    await page.goto('/ar/login?next=%2Far%2Faccount%2Fbookings');
    await page.getByLabel(ar.auth.email).fill(EMAIL);
    await page.locator('input[type=password]').first().fill(PASSWORD);
    await page.getByRole('button', { name: ar.auth.signIn }).first().click();
    await page.waitForURL(/\/account\/bookings/, { timeout: 20_000 });

    const pills = (await page.locator('[data-status-pill]').allTextContents()).map(
      (text) => text.trim(),
    );

    /* Guards against asserting over an empty list, which would pass on a page that renders none. */
    expect(pills.length).toBeGreaterThan(0);
    expect([...new Set(pills)].filter((word) => !ALLOWED.includes(word))).toStrictEqual(
      [],
    );

    /*
      «مكتمل» named explicitly, because it is the word this change removed and the one a
      regression would bring back: the fixture holds four `completed` bookings.
    */
    expect(pills).not.toContain(ar.account.status.completed);

    /* The overview draws the same booking in the same row, so it must say the same word. */
    await page.goto('/ar/account');

    const overview = (await page.locator('[data-status-pill]').allTextContents()).map(
      (text) => text.trim(),
    );

    expect(
      [...new Set(overview)].filter((word) => !ALLOWED.includes(word)),
    ).toStrictEqual([]);
  });

  /**
   * Three words, three colours.
   *
   * The status rule cuts both ways: collapsing four statuses onto «مؤكد» while the pill still
   * coloured them by the ORIGINAL value would print one word in three colours, which reads as a
   * rendering fault rather than as one state.
   */
  test('gives each of the three its own colour', async ({ page }) => {
    await page.goto('/ar/account/bookings');

    const painted = await page.locator('[data-status-pill]').evaluateAll((pills) =>
      pills.map((pill) => ({
        word: (pill.textContent ?? '').trim(),
        colour: getComputedStyle(pill).color,
      })),
    );

    const byWord = new Map<string, Set<string>>();
    for (const { word, colour } of painted) {
      byWord.set(word, (byWord.get(word) ?? new Set()).add(colour));
    }

    /* No word in two colours… */
    for (const [word, colours] of byWord) {
      expect([...colours], word).toHaveLength(1);
    }
    /* …and no colour on two words. */
    const colours = [...byWord.values()].map((set) => [...set][0]);
    expect(new Set(colours).size).toBe(colours.length);
  });
});
