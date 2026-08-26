import { describe, expect, it } from 'vitest';

import { DEFAULT_MONEY_CURRENCY, normalise } from './money-settings.service.js';

/**
 * Reading a money setting's stored shape.
 *
 * Both forms have to work, and that is not cosmetic: `settings` is seeded and never
 * truncated, so every live installation already holds the bare-number form. A parser
 * that only understood the new shape would silently fall back to defaults on exactly
 * the systems that matter — the ones with configured values.
 */
describe('normalise', () => {
  it('reads a bare number as the default currency', () => {
    expect(normalise(10)).toStrictEqual({ amount: '10.000', currency: 'USD' });
    expect(normalise(1.99)).toStrictEqual({ amount: '1.990', currency: 'USD' });
  });

  it('uses the documented default currency rather than a literal', () => {
    expect(normalise(5)?.currency).toBe(DEFAULT_MONEY_CURRENCY);
  });

  it('reads the explicit shape', () => {
    expect(normalise({ amount: '8.500', currency: 'JOD' })).toStrictEqual({
      amount: '8.500',
      currency: 'JOD',
    });
  });

  it('accepts a numeric amount inside the explicit shape', () => {
    expect(normalise({ amount: 8.5, currency: 'EUR' })).toStrictEqual({
      amount: '8.500',
      currency: 'EUR',
    });
  });

  /** A value stored as `10` and one stored as `"10.00"` are the same money. */
  it('normalises both spellings of the same amount identically', () => {
    expect(normalise(10)).toStrictEqual(normalise('10.00'));
    expect(normalise('10')).toStrictEqual(normalise(10.0));
  });

  it('rejects a malformed currency rather than guessing', () => {
    expect(normalise({ amount: '10.00', currency: 'dollars' })).toBeNull();
    expect(normalise({ amount: '10.00', currency: 'us' })).toBeNull();
    expect(normalise({ amount: '10.00' })).toBeNull();
  });

  /**
   * A negative fine, fee or compensation inverts who owes whom. Rejecting means the
   * caller falls back to its stated default rather than paying a partner for missing
   * an SLA — and it must be rejected in BOTH stored shapes, not just one.
   */
  it('rejects a negative amount in either shape', () => {
    expect(normalise(-5)).toBeNull();
    expect(normalise('-5.00')).toBeNull();
    expect(normalise({ amount: '-5.00', currency: 'USD' })).toBeNull();
    expect(normalise({ amount: -5, currency: 'USD' })).toBeNull();
  });

  it('rejects a non-numeric amount', () => {
    expect(normalise({ amount: 'ten', currency: 'USD' })).toBeNull();
  });

  it('returns null for values that are not money at all', () => {
    expect(normalise(null)).toBeNull();
    expect(normalise(undefined)).toBeNull();
    expect(normalise('flat')).toBeNull();
    expect(normalise(true)).toBeNull();
    expect(normalise([])).toBeNull();
  });

  /**
   * Truncated at the carrying scale, not rounded up, matching `toMinor`.
   *
   * Three decimals now rather than two — that is `MONEY_SCALE`, the widest any currency SAFRA
   * lists needs, so a JOD setting keeps its fils. The input carries a FOURTH decimal, which no
   * currency here can express and which the column would drop anyway; asserting against an input
   * the scale already fits would prove nothing.
   */
  it('truncates precision beyond the money scale', () => {
    expect(normalise({ amount: '10.9999', currency: 'USD' })?.amount).toBe('10.999');
  });

  /** And a three-decimal currency keeps the decimal that two would have flattened. */
  it('keeps the third decimal a JOD amount needs', () => {
    expect(normalise({ amount: '10.125', currency: 'JOD' })?.amount).toBe('10.125');
  });
});
