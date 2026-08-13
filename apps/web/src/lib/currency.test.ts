import { describe, expect, it } from 'vitest';

import { convertForDisplay, isDisplayCurrency, rateBetween } from './currency';

/**
 * The arithmetic behind a price in somebody else's currency.
 *
 * Worth testing on its own because every failure mode is a wrong number about MONEY on the busiest
 * screens in the app, and none of them throws: a missing rate that silently returned 1 would
 * relabel `$120` as `١٢٠ ل.س`, which is off by four orders of magnitude and looks like a bargain.
 */
const RATES = [{ base: 'USD', quote: 'SYP', rate: '13000.00000000' }];

describe('rateBetween', () => {
  it('is 1 for a currency against itself', () => {
    expect(rateBetween('USD', 'USD', RATES)).toBe(1);
    /* Even with no rates at all: nothing is being converted. */
    expect(rateBetween('EUR', 'EUR', [])).toBe(1);
  });

  it('uses a recorded pair as it stands', () => {
    expect(rateBetween('USD', 'SYP', RATES)).toBe(13_000);
  });

  /**
   * The inverse is an ASSUMPTION, not data — it holds while a rate is a pure ratio and stops
   * holding the moment a spread is baked in. Acceptable for an indicative browse price; the test
   * records that it is derived rather than stored.
   */
  it('derives the inverse of a recorded pair', () => {
    expect(rateBetween('SYP', 'USD', RATES)).toBeCloseTo(1 / 13_000, 12);
  });

  /**
   * The case the whole design turns on: **null, never 1.**
   *
   * No EUR rate exists, so a euro price cannot be produced. Returning 1 here would put a figure on
   * screen that came from nowhere and label it €.
   */
  it('returns null when no route to the currency exists', () => {
    expect(rateBetween('USD', 'EUR', RATES)).toBeNull();
    expect(rateBetween('SYP', 'EUR', RATES)).toBeNull();
    expect(rateBetween('USD', 'SYP', [])).toBeNull();
  });

  /** A pair nobody recorded is reachable through the pivot when both legs exist. */
  it('goes through USD when it can', () => {
    const withEuro = [...RATES, { base: 'USD', quote: 'EUR', rate: '0.92' }];

    /* SYP → USD → EUR. */
    expect(rateBetween('SYP', 'EUR', withEuro)).toBeCloseTo(0.92 / 13_000, 12);
  });

  /** A rate of zero cannot be inverted, and dividing by it would produce Infinity as a price. */
  it('refuses to invert a zero rate', () => {
    expect(
      rateBetween('SYP', 'USD', [{ base: 'USD', quote: 'SYP', rate: '0' }]),
    ).toBeNull();
  });

  it('ignores a malformed rate rather than producing NaN', () => {
    expect(
      rateBetween('USD', 'SYP', [{ base: 'USD', quote: 'SYP', rate: 'x' }]),
    ).toBeNull();
  });
});

describe('convertForDisplay', () => {
  it('converts and reports that it did, keeping the original', () => {
    const shown = convertForDisplay('120', 'USD', 'ar', 'SYP', RATES);

    expect(shown.converted).toBe(true);
    expect(shown.text).toContain('1,560,000');
    /* The original is what a booking is actually made against, and callers print it. */
    expect(shown.original).toContain('120');
  });

  /**
   * The honest failure: the amount in its OWN currency, and `converted: false` so no caller
   * captions it as an estimate.
   */
  it('falls back to the amount´s own currency when no rate reaches the target', () => {
    const shown = convertForDisplay('120', 'USD', 'ar', 'EUR', RATES);

    expect(shown.converted).toBe(false);
    expect(shown.text).toBe(shown.original);
    expect(shown.text).not.toContain('€');
  });

  it('does not claim to have converted a currency into itself', () => {
    expect(convertForDisplay('120', 'USD', 'ar', 'USD', RATES).converted).toBe(false);
  });

  /** An unparseable amount is left exactly as `formatMoney` renders it — never multiplied. */
  it('leaves a malformed amount alone', () => {
    const shown = convertForDisplay('', 'USD', 'ar', 'SYP', RATES);

    expect(shown.converted).toBe(false);
  });
});

describe('isDisplayCurrency', () => {
  /* The cookie is caller-supplied, so this is a boundary check rather than a formality. */
  it('accepts only the three offered currencies', () => {
    expect(isDisplayCurrency('USD')).toBe(true);
    expect(isDisplayCurrency('SYP')).toBe(true);
    expect(isDisplayCurrency('usd')).toBe(false);
    expect(isDisplayCurrency('JOD')).toBe(false);
    expect(isDisplayCurrency(undefined)).toBe(false);
    expect(isDisplayCurrency({ toString: () => 'USD' })).toBe(false);
  });
});
