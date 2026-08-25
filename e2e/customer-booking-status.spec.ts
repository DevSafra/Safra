import { expect, test } from '@playwright/test';

import ar from '../packages/i18n/src/messages/web/ar.json' assert { type: 'json' };
import en from '../packages/i18n/src/messages/web/en.json' assert { type: 'json' };

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

    // ─── §6.3 step 6 / §6.5 — the voucher ─────────────────────────────────────
    /*
      Driven from THIS session rather than a spec of its own, because a sign-in is a budgeted
      resource here and this screen is already open in front of one.

      The link is followed with `page.request`, not clicked: the endpoint answers
      `Content-Disposition: inline`, so a click hands the response to Chromium's PDF viewer and
      there is nothing left to assert against. `page.request` shares the context's cookies, so the
      HttpOnly session travels exactly as it would on a click.

      ## Asserted as a BICONDITIONAL, over every row

      "Some booking offers a voucher" is also true of a screen that offers one on every booking —
      including `pending_payment`, where the document would say «مؤكد» about a stay nobody has
      accepted, and the customer could carry that to a desk. So each row is checked BOTH ways: the
      link is there exactly when the status is one of the three that may have it, and the run is
      only meaningful if both sides of that occurred, which is what the two counters hold.
    */
    /*
      Both catalogues, because this block must not depend on which language the trip left us in.

      The rows above are reached through `page.goBack()`, and going back over a sign-in redirect can
      land on the account's OWN preferred locale rather than the `/ar` the test asked for. A word
      list in one language would then match nothing and the biconditional below would quietly assert
      «no booking offers a voucher», which is exactly the vacuous pass this file's header warns of.
    */
    const OFFERS = [
      ar.account.status.confirmed,
      ar.account.status.checked_in,
      ar.account.status.completed,
      en.account.status.confirmed,
      en.account.status.checked_in,
      en.account.status.completed,
    ];

    /* Read once, from a list this block navigated to itself — not from wherever history left us. */
    await page.goto('/ar/account/bookings');

    const hrefs = await rows.evaluateAll((links) =>
      links.map((link) => (link as HTMLAnchorElement).getAttribute('href') ?? ''),
    );

    expect(hrefs.length, 'bookings to check').toBeGreaterThan(1);

    let offered = 0;
    let withheld = 0;

    for (const href of hrefs) {
      await page.goto(href);

      const status = (await page
        .locator('[data-status-pill]')
        .first()
        .textContent())!.trim();
      const link = page.locator('a[href*="/voucher"]');
      const shown = (await link.count()) > 0;

      expect(shown, `${href} is «${status}»`).toBe(OFFERS.includes(status));

      if (!shown) {
        withheld += 1;
        continue;
      }

      offered += 1;

      const response = await page.request.get((await link.first().getAttribute('href'))!);

      expect(response.status(), href).toBe(200);
      expect(response.headers()['content-type']).toContain('application/pdf');

      /* A REAL document: the magic bytes, and enough of it to be a page rather than a stub. */
      const body = await response.body();

      expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(body.byteLength).toBeGreaterThan(2_000);
    }

    /* Both halves of the biconditional were actually exercised — otherwise it proved one of them. */
    expect(offered, 'a booking that offers its voucher').toBeGreaterThan(0);
    expect(withheld, 'a booking that must not').toBeGreaterThan(0);

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
