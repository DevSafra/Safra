import type { Page } from '@playwright/test';

import ar from '../packages/i18n/src/messages/web/ar.json' with { type: 'json' };

/**
 * The checkout's submit control, whichever of its two names it is wearing.
 *
 * ## Why this exists
 *
 * Four journey specs clicked the literal «تابع إلى الدفع» and all four failed for ten minutes a
 * run, every run, with a `waitForResponse` timeout on `POST /api/bookings` — a signature that reads
 * like a slow API and was a button that did not exist. Finding 219 renamed it: with no payment rail
 * onboarded, checkout stopped promising a payment screen it could not open, and its button became
 * «أكمل الحجز» (`checkout.submitNoPayment`). The catalogue still holds both, because
 * `checkout.submit` becomes live again the day Visa, Mastercard or Sham Cash is configured.
 *
 * So a spec that names EITHER label is wrong half the time by construction. This matches both, from
 * the catalogue rather than from a copy of the words, so the next rename cannot silently disable
 * four end-to-end journeys — which is what happened, and what made the browser suite unable to
 * certify anything.
 */
export function checkoutSubmit(page: Page) {
  const names = [ar.checkout.submitNoPayment, ar.checkout.submit].map((word) =>
    word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  );

  return page.getByRole('button', { name: new RegExp(names.join('|')) });
}
