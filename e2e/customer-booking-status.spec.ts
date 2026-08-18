import { expect, test } from '@playwright/test';

import ar from '../packages/i18n/src/messages/web/ar.json' assert { type: 'json' };

/**
 * حجوزاتي: three states, and a row that opens the booking it names.
 *
 * ## One test, one sign-in
 *
 * `POST /auth/login` is throttled per IP and this suite already runs at the ceiling, so everything
 * here comes from a single session — the discipline `customer-invoices.spec.ts` keeps.
 *
 * An earlier version of this spec split the colour checks into a second test that never signed in.
 * It passed: the page redirected to the login form, the locator matched NOTHING, and every loop
 * over an empty list was vacuously true. A spec that cannot fail is worse than no spec, so the
 * non-empty guards below are load-bearing rather than defensive.
 */
const PASSWORD = process.env['TESTBED_PASSWORD'] ?? 'a-testbed-password-1';
const EMAIL = 'customer@safra.test';

const ALLOWED = [
  ar.account.status.cancelled,
  ar.account.status.pending_confirmation,
  ar.account.status.confirmed,
];

test.use({ baseURL: 'http://localhost:3000' });

test.describe('حجوزاتي', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('shows three states, and opens the booking a row actually names', async ({
    page,
  }) => {
    await page.goto('/ar/login?next=%2Far%2Faccount%2Fbookings');
    await page.getByLabel(ar.auth.email).fill(EMAIL);
    await page.locator('input[type=password]').first().fill(PASSWORD);
    await page.getByRole('button', { name: ar.auth.signIn }).first().click();
    await page.waitForURL(/\/account\/bookings/, { timeout: 20_000 });

    // ─── the list says one of three words, in three colours ───────────────────
    const painted = await page.locator('[data-status-pill]').evaluateAll((pills) =>
      pills.map((pill) => ({
        word: (pill.textContent ?? '').trim(),
        colour: getComputedStyle(pill).color,
      })),
    );

    expect(painted.length).toBeGreaterThan(0);
    expect(
      [...new Set(painted.map((p) => p.word))].filter((w) => !ALLOWED.includes(w)),
    ).toStrictEqual([]);
    /* «مكتمل» named explicitly: it is the word this change removed, and the fixture still holds
       `completed` bookings, so a regression would put it back here. */
    expect(painted.map((p) => p.word)).not.toContain(ar.account.status.completed);

    const byWord = new Map<string, Set<string>>();
    for (const { word, colour } of painted) {
      byWord.set(word, (byWord.get(word) ?? new Set()).add(colour));
    }
    for (const [word, colours] of byWord) expect([...colours], word).toHaveLength(1);
    const colours = [...byWord.values()].map((set) => [...set][0]);
    expect(new Set(colours).size).toBe(colours.length);

    // ─── a row opens ITS booking, not a fixed holding page ────────────────────
    /*
      The defect this covers: every row used to link to `/booking/[reference]`, the post-payment
      page, which looks nothing up and always reads «تم الدفع — حجزك قيد التأكيد». Two bookings in
      different states opened the same screen saying the same thing (Bashar, 2026-08-18).
    */
    const rows = page.locator('ul a[href*="/account/bookings/"]');
    const total = await rows.count();

    expect(total).toBeGreaterThan(1);

    const seen: { reference: string; status: string }[] = [];

    for (const index of [0, total - 1]) {
      const href = await rows.nth(index).getAttribute('href');
      await page.goto(href!);

      const reference = href!.split('/').pop()!.split('?')[0]!;

      /* The page names the booking it was asked for — not a fixed one, and not another. */
      await expect(page.getByText(reference, { exact: false }).first()).toBeVisible();

      seen.push({
        reference,
        status: (await page.locator('[data-status-pill]').first().textContent())!.trim(),
      });

      await page.goBack();
    }

    expect(seen[0]!.reference).not.toBe(seen[1]!.reference);

    // ─── not yours reads exactly like not there ───────────────────────────────
    /*
      Both must be 404, and both must render the SAME page: references are sequential, so any
      difference between the two answers walks the platform's bookings one request at a time.
    */
    const answers: { status: number; body: string }[] = [];

    for (const reference of ['BKG-2026-046386', 'BKG-2026-999999']) {
      const response = await page.goto(`/ar/account/bookings/${reference}`);

      answers.push({
        status: response!.status(),
        body: (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim(),
      });
    }

    expect(answers[0]!.status).toBe(404);
    expect(answers[1]!.status).toBe(404);
    expect(answers[0]!.body).toBe(answers[1]!.body);
    /* And neither leaks a figure from the booking that does exist. */
    expect(answers[0]!.body).not.toMatch(/\d+\.\d{2}/);
  });
});
