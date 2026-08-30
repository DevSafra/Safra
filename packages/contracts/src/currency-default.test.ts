import { describe, expect, it } from 'vitest';

import { DEFAULT_MONEY_CURRENCY, preferredCurrency } from './booking.js';

/**
 * USD is what a picker starts on, everywhere, in every app (Bashar, 2026-08-30).
 *
 * The failure this prevents is silent and expensive: `GIFT_CARD_CURRENCIES` is written SYP-first
 * and the geography read orders the ACCOUNTING currency first, so a form defaulting to
 * `currencies[0]` denominated a gift card or a coupon in SYP whenever nobody touched the select —
 * a figure four orders of magnitude away from the one that was meant.
 */
describe('preferredCurrency', () => {
  it('picks the standard currency wherever it is in the list', () => {
    expect(preferredCurrency(['SYP', 'USD', 'EUR'])).toBe(DEFAULT_MONEY_CURRENCY);
    expect(preferredCurrency(['USD', 'EUR'])).toBe(DEFAULT_MONEY_CURRENCY);
  });

  it('falls back to what is offered when the standard one is not', () => {
    expect(preferredCurrency(['EUR', 'SYP'])).toBe('EUR');
  });

  it('answers the standard currency rather than nothing for an empty list', () => {
    expect(preferredCurrency([])).toBe(DEFAULT_MONEY_CURRENCY);
  });
});
