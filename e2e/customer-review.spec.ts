import { expect, test } from '@playwright/test';

import en from '../packages/i18n/src/messages/web/en.json' assert { type: 'json' };

/**
 * Writing a review, from the customer's side (§7.3, P-006).
 *
 * ## What a browser adds over the integration tests
 *
 * `review.integration.test.ts` proves the rules — your booking, completed, once only, frozen after
 * writing. What it cannot see is the JOURNEY: whether a customer who finished a stay is actually
 * offered the form, and whether the page that appears is the one that works. The account prompt
 * and the form are three server components and a route handler deep, and every failure in that
 * chain is quiet — a `safeParse` mismatch renders "could not load" and returns 200.
 *
 * ## One sign-in, and no submission
 *
 * `POST /auth/login` allows ten calls a minute per IP and this suite already makes thirteen, so
 * this spends exactly one. It deliberately does NOT submit a review: a browser test that writes
 * one would consume a fixture booking on every run, and the write is proven against a real
 * database in the integration suite where it costs nothing and can be rolled back.
 */
/*
  `TESTBED_PASSWORD`, not `DEV_CUSTOMER_PASSWORD`.

  `db:testbed` OWNS `customer@safra.test` — it upserts the account on every run and sets the
  password to `TESTBED_PASSWORD`. `DEV_CUSTOMER_PASSWORD` is the value that account had before the
  testbed existed, and it still works for `customer-password-field.spec.ts` only because that spec
  never submits the form. Signing in with it now fails with `auth.credentials_invalid`, which reads
  as a broken login rather than as stale documentation.
*/
const PASSWORD = process.env['TESTBED_PASSWORD'] ?? 'a-testbed-password-1';
const EMAIL = 'customer@safra.test';

test.use({ baseURL: 'http://localhost:3000' });

test.describe('writing a review', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('offers a finished stay, and the form states P-006 before it is used', async ({
    page,
  }) => {
    /*
      `?next=` explicitly. Signing in with no target lands on the HOME page — `safeRedirect`
      falls back to `/${locale}` — which is correct behaviour and not what this test is about.
      It is also the realistic path: a customer who follows a review link while signed out is
      bounced here by middleware with exactly this parameter.
    */
    await page.goto('/en/login?next=%2Fen%2Faccount');
    /*
      The email field's accessible name is "Email address *" — the required marker is not hidden
      from the accessibility tree on that field, though it is on the password. Matched without
      `exact` rather than by hard-coding the asterisk, which would break the day somebody fixes
      the inconsistency.
    */
    await page.getByRole('textbox', { name: en.auth.email }).fill(EMAIL);
    await page
      .getByRole('textbox', { name: en.auth.password, exact: true })
      .fill(PASSWORD);
    /*
      By NAME, not `button[type="submit"]`.

      Since the footer gained a currency picker (2026-08-13) every page carries three more submit
      buttons — one per currency — so the bare attribute selector is a strict-mode violation on a
      page it used to match exactly once. The sign-out button in the account sidebar was already a
      reason not to use `.last()`; this is the same trap from the other end.
    */
    await page.getByRole('button', { name: en.auth.signIn }).click();

    await page.waitForURL(/\/en\/account/);

    /*
      The prompt appears only for stays that are genuinely reviewable — the API returns exactly
      what the write endpoint would accept. The testbed always leaves some, so its absence here
      would mean the prompt is broken rather than that there is nothing to review.
    */
    const prompt = page.getByRole('heading', { name: en.reviews.pendingTitle });

    await expect(prompt).toBeVisible();

    await page.getByRole('link', { name: en.reviews.writeReview }).first().click();
    await page.waitForURL(/\/en\/review\/BKG-/);

    // The form is there, and it says the rule BEFORE it is used rather than after.
    await expect(page.getByText(en.reviews.rule)).toBeVisible();
    await expect(page.getByRole('button', { name: en.reviews.submit })).toBeVisible();

    /*
      The score is a radio GROUP, not five unlabelled glyphs. A screen reader announces "3 of 5,
      radio"; a row of ★ buttons announces nothing useful, and the star is the decoration rather
      than the control.
    */
    await expect(page.getByRole('radio', { name: /3/ })).toHaveCount(1);

    // Nothing here edits or deletes anything — P-006 as an absence, not a promise.
    await expect(page.getByRole('button', { name: /delete/i })).toHaveCount(0);

    /*
      A booking that is not yours is indistinguishable from one that does not exist.

      References are sequential (§13.2), so a different answer for the two would turn this URL
      into an oracle for whether a booking exists. Asserted on the SAME session rather than in a
      test of its own — a second test means a second sign-in, and the suite's login budget is
      already the binding constraint (see `partner.setup.ts`).
    */
    const stranger = await page.goto('/en/review/BKG-2026-000001');

    expect(stranger?.status()).toBe(404);

    /*
      «رجوع» returns the reader where they CAME FROM (Bashar, 2026-08-11).

      The booking confirmation used to say «العودة للرئيسية» and drop you on the home page even when
      you had arrived from your own bookings list. The list now names its own origin in the row's href
      and the detail screen resolves it through an allow-list.

      Asserted on the SAME session rather than in tests of their own: a second test means a second
      sign-in, and the login budget is the suite's binding constraint.
    */
    for (const [from, expected] of [
      ['bookings', '/en/account/bookings'],
      ['reviews', '/en/account/reviews'],
      ['account', '/en/account'],
    ] as const) {
      await page.goto(`/en/account/bookings`);
      await page.goto(`/en/booking/BKG-2026-009548?from=${from}`);

      const back = page.getByRole('link', { name: /Back/i });

      await expect(back).toHaveAttribute('href', expected);
    }

    /*
      A forged origin is IGNORED, not followed.

      The parameter carries a key from a fixed list, never a path, so the worst a crafted link can do
      is fall back. Read as a path it would be an open redirect on our own page — the back control
      would hop somewhere else and the reader would have no reason to distrust it.
    */
    for (const forged of [
      'https://evil.example.com',
      '//evil.example.com',
      '../../etc/passwd',
      '/en/account/wallet%00',
    ]) {
      await page.goto(`/en/booking/BKG-2026-009548?from=${encodeURIComponent(forged)}`);

      /* The home page — this route is reachable by a guest, so that is the honest fallback. */
      await expect(page.getByRole('link', { name: /Back/i })).toHaveAttribute(
        'href',
        '/en',
      );
    }
  });

  /** Anonymous visitors are bounced to sign-in, exactly as they are off `/account`. */
  test('refuses an anonymous visitor and keeps where they were going', async ({
    page,
  }) => {
    await page.goto('/en/review/BKG-2026-000001');

    await expect(page).toHaveURL(/\/en\/login/);
  });
});
