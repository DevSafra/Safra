import { expect, test } from '@playwright/test';

import { STAFF_STATE } from './staff.js';

/**
 * Every app answers a wrong URL in the reader's language.
 *
 * ## The report
 *
 * Bashar, 2026-08-20: "The partner page is written on the left, while the current language is
 * Arabic." Both halves were literally true, and the cause was that neither the console nor the
 * partner portal had a `not-found.tsx`. Next's built-in `404 / This page could not be found.`
 * rendered inside their RTL documents, so the sentence was in English AND the bidi algorithm put
 * the full stop at the start of it.
 *
 * ## Why a MISSING RECORD is the case that matters
 *
 * A typo'd path is rare. `/partners/PAR-999999` is not: it is a stale bookmark, a deleted record, or
 * a reference pasted one digit wrong out of an email, and support agents work from references all
 * day. That request answered the same English page — so the console's answer to an ordinary mistake
 * looked like the console had broken.
 *
 * Asserted on the ARABIC CHARACTER COUNT rather than on any particular sentence. Wording changes;
 * "there is Arabic on this page" is the property, and it is the one that failed.
 */
const ARABIC = /[؀-ۿ]/g;

/** A wrong path and a well-formed reference that does not exist — both are 404s a person hits. */
const CONSOLE_PATHS = ['/no-such-page', '/partners/PAR-999999'];

test.describe('the customer app', () => {
  /** It already had a root `not-found`, and it is the model the other two follow. */
  test('answers in all three languages, with a way home', async ({ page }) => {
    const response = await page.goto('http://localhost:3000/ar/no-such-page', {
      waitUntil: 'domcontentloaded',
    });

    expect(response?.status()).toBe(404);

    const body = await page.locator('body').innerText();

    expect(body).toMatch(/الصفحة غير موجودة/);
    expect(body).toMatch(/Page not found/);
    expect(body).toMatch(/Seite nicht gefunden/);
    await expect(page.getByRole('link')).toBeVisible();
  });
});

test.describe('the staff console', () => {
  test.use({ storageState: STAFF_STATE });

  for (const path of CONSOLE_PATHS) {
    test(`answers ${path} in Arabic, with a way back`, async ({ page }) => {
      /*
        `networkidle`, not `domcontentloaded`, and the difference is a finding rather than a detail.

        An UNMATCHED path is server-rendered. A runtime `notFound()` — which is what a well-formed
        but missing reference triggers — is not: Next serves an `<html id="__next_error__">` shell
        with an empty body and delivers the not-found UI in the RSC payload, so the content appears
        on hydration. Both end up correct in a browser; only one of them is correct without
        JavaScript. See the note at the end of this file.
      */
      const response = await page.goto(path, { waitUntil: 'networkidle' });

      expect(response?.status()).toBe(404);

      const body = await page.locator('body').innerText();

      expect(
        (body.match(ARABIC) ?? []).length,
        'the console is Arabic-only, so its 404 must be too',
      ).toBeGreaterThan(20);

      expect(
        body,
        "Next's English default must not be what a staff member reads",
      ).not.toContain('This page could not be found');

      /* One link, back to the dashboard: a 404 with no way out is a dead end. */
      await expect(page.getByRole('link', { name: /لوحة الإدارة/ })).toBeVisible();
    });
  }
});

/**
 * The residual, measured 2026-08-20 and deliberately not fixed here.
 *
 * A well-formed reference that does not exist — `/partners/PAR-999999` — reaches `notFound()` at
 * request time. Next answers that with an error shell whose body is empty and puts the not-found UI
 * in the RSC payload, so with JavaScript disabled the page is BLANK (0 characters, verified). An
 * unmatched path like `/no-such-page` is server-rendered and is fine either way.
 *
 * It is not something `not-found.tsx` can change. Closing it means detail screens rendering their
 * own "no such record" panel inside the console shell instead of calling `notFound()` — which keeps
 * the nav and works without JavaScript, at the cost of answering 200 instead of 404. That is a
 * reasonable trade for an internal tool behind auth with `robots: noindex`, and it touches every
 * detail screen in the console, so it belongs in its own change. Recorded in `docs/FUTURE-WORK.md`.
 */
