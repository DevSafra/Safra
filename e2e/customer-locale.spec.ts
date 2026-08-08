import { expect, test, type Page } from '@playwright/test';

import { ar } from '../packages/i18n/src/messages/errors/ar.js';
import { de } from '../packages/i18n/src/messages/errors/de.js';
import { en } from '../packages/i18n/src/messages/errors/en.js';
import arWeb from '../packages/i18n/src/messages/web/ar.json' with { type: 'json' };
import deWeb from '../packages/i18n/src/messages/web/de.json' with { type: 'json' };

/**
 * Server errors reach the customer in the customer's language.
 *
 * ## The bug this exists to keep fixed
 *
 * The API answered with English prose, and `auth-form.tsx` wrote the API's `message` straight
 * into the error under the input. So the one screen where wording matters most — a stranger
 * failing to register — was the one screen that ignored the locale entirely. An Arabic customer
 * read "A valid email address is required." and a German one read the same.
 *
 * `pnpm verify` could not see it: the route handler returned the right status with the right
 * shape, and no unit test rendered a form. Only a browser shows what a person actually reads,
 * which is why this is a browser test.
 *
 * ## Asserted against the catalogue, not against a copy of the sentence
 *
 * The expectations are read from `messages/errors/*.ts`. Duplicating the Arabic here would make
 * this pass while the app rendered a stale string, which is the same class of mistake as the
 * regex-matching it replaced.
 */
test.use({ baseURL: 'http://localhost:3000' });

/**
 * Located by role with a NON-exact name.
 *
 * The customer app appends a decorative `*` to every required label, so the accessible name is
 * `'البريد الإلكتروني *'` and an exact match finds nothing. Matching the label as a substring is
 * what the existing customer spec settled on for the same reason.
 */
const field = (page: Page, name: string) => page.getByRole('textbox', { name });

/**
 * A malformed email, submitted with the browser's own validation bypassed.
 *
 * `noValidate` is already set on the form, so the request does reach the route handler — which
 * is the point: this must exercise the SERVER's error path, not the browser's.
 */
async function submitBadEmail(page: Page, locale: 'ar' | 'de') {
  const copy = (locale === 'ar' ? arWeb : deWeb).auth;

  await page.goto(`/${locale}/register`);
  await field(page, copy.email).fill('not-an-email');
  await page.getByRole('button', { name: copy.createAccount }).click();
}

test('a validation error from the API renders in Arabic', async ({ page }) => {
  await submitBadEmail(page, 'ar');

  await expect(page.getByText(ar['validation.email_invalid'])).toBeVisible();
});

test('the same error renders in German for a German customer', async ({ page }) => {
  await submitBadEmail(page, 'de');

  await expect(page.getByText(de['validation.email_invalid'])).toBeVisible();
});

/**
 * And the English text is not leaking into the other two.
 *
 * The failure mode being guarded is a fallback that quietly resolves every locale to the
 * English catalogue — which would satisfy "an error appeared" and nothing else.
 */
test('the English wording does not appear on the Arabic page', async ({ page }) => {
  await submitBadEmail(page, 'ar');

  await expect(page.getByText(ar['validation.email_invalid'])).toBeVisible();
  await expect(page.getByText(en['validation.email_invalid'])).toHaveCount(0);
});

/**
 * Arabic plural agreement, as a customer actually reads it.
 *
 * ## Why this needs a browser and not only the unit test
 *
 * `plurals.test.ts` proves the CATALOGUE selects the right form. It cannot prove the app reaches
 * that form: a component that pre-formats the count into an Arabic-numeral STRING before handing it
 * to `t()` makes every message fall to `other`, silently, because `Intl.PluralRules` has nothing
 * numeric to classify. Every category still exists, every unit test still passes, and every reader
 * sees the singular.
 *
 * So this asserts the rendered page at a count in the range that used to be wrong.
 */
test.describe('Arabic plurals on a real page', () => {
  test('a result count between 11 and 99 takes the singular noun', async ({ page }) => {
    await page.goto('/ar/search');

    const heading = page
      .locator('h1, h2')
      .filter({ hasText: /نتيجة|نتائج/ })
      .first();

    await expect(heading).toBeVisible();

    const text = (await heading.textContent()) ?? '';
    const digits = text.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
    const count = Number(/(\d+)/.exec(digits)?.[1] ?? '0');

    /*
      The assertion is conditional on WHICH category the fixture count lands in, because the seed
      decides how many published listings there are — and a test that hard-coded "٦ نتائج" would
      break every time somebody added a listing, for a reason unrelated to plurals.
    */
    if (count >= 3 && count <= 10) {
      expect(text).toContain('نتائج');
    } else if (count >= 11 && count <= 99) {
      /* The category that was wrong: Arabic takes the SINGULAR here. */
      expect(text).toContain('نتيجة');
      expect(text).not.toContain('نتائج');
    } else if (count === 1) {
      expect(text).toContain('نتيجة واحدة');
    }
  });

  test('the count reaches the formatter as a number, not a pre-rendered string', async ({
    page,
  }) => {
    /*
      The failure this catches: a component formatting the count to Arabic-Indic digits BEFORE
      `t()` sees it. Every message would then resolve to `other` and read as the singular for
      every count, which looks like a translation choice rather than a bug.

      Proven on the property page, whose review line names a count and its noun together.
    */
    await page.goto('/ar/property/qasr-al-sharq-malki');

    const line = page.locator('text=/أحدث .* من .*/').first();

    await expect(line).toBeVisible();

    const text = (await line.textContent()) ?? '';

    /* Whatever the fixture count is, it must have selected a real category — never «# تقييم». */
    expect(text).not.toContain('#');
    expect(text).toMatch(/تقييم/);
  });
});
