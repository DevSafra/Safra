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
