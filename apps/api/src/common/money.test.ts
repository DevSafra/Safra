import { describe, expect, it } from 'vitest';

import {
  applyRate,
  divideDecimalStrings,
  fromMinor,
  multiplyDecimalStrings,
  toMinor,
} from './money.js';

/**
 * These are the tests that justify not using floats.
 *
 * Each case below is one that IEEE-754 arithmetic gets wrong, and every one of them
 * is a real amount a customer could be charged or credited.
 */
describe('toMinor / fromMinor', () => {
  it('round-trips ordinary amounts', () => {
    expect(fromMinor(toMinor('55.00', 2), 2)).toBe('55.00');
    expect(fromMinor(toMinor('0.01', 2), 2)).toBe('0.01');
    expect(fromMinor(toMinor('1234567.89', 2), 2)).toBe('1234567.89');
  });

  it('normalises a short fraction', () => {
    // "55.5" and "55.50" are the same money.
    expect(toMinor('55.5', 2)).toBe(5550n);
    expect(fromMinor(toMinor('55.5', 2), 2)).toBe('55.50');
  });

  it('handles an integer with no decimal point', () => {
    expect(toMinor('55', 2)).toBe(5500n);
  });

  it('handles a zero-decimal currency', () => {
    // JOD has 3 decimals; some currencies have 0. Scale is per currency, not global.
    expect(toMinor('1500', 0)).toBe(1500n);
    expect(fromMinor(1500n, 0)).toBe('1500');
  });

  it('handles a three-decimal currency (JOD)', () => {
    expect(toMinor('12.345', 3)).toBe(12345n);
    expect(fromMinor(12345n, 3)).toBe('12.345');
  });

  it('truncates precision beyond the currency scale rather than rounding up', () => {
    // A price cannot be sub-cent; extra input digits are not money.
    expect(toMinor('55.999', 2)).toBe(5599n);
  });

  it('preserves values a float would corrupt', () => {
    // 0.1 + 0.2 !== 0.3 in IEEE-754. In minor units it is exact.
    expect(fromMinor(toMinor('0.10', 2) + toMinor('0.20', 2), 2)).toBe('0.30');
  });

  it('sums three nights of 55.05 exactly', () => {
    // 55.05 * 3 === 165.14999999999998 as a float.
    const total = toMinor('55.05', 2) * 3n;
    expect(fromMinor(total, 2)).toBe('165.15');
  });

  it('handles negatives, for refunds and reversals', () => {
    expect(fromMinor(toMinor('-25.50', 2), 2)).toBe('-25.50');
  });

  /**
   * PostgreSQL renders `numeric(14,2)` as "10.00", but a bare `numeric` column or a
   * value cast through `::text` can come back as "10" or "10.000000". A wallet
   * balance is read straight out of the database and added to, so the parser must
   * treat all three as the same money.
   */
  it('parses whatever shape PostgreSQL renders a numeric as', () => {
    expect(toMinor('10', 2)).toBe(toMinor('10.00', 2));
    expect(toMinor('10.000000', 2)).toBe(toMinor('10.00', 2));
  });
});

describe('applyRate — commission', () => {
  it('takes 7% of a round amount', () => {
    // 220.00 * 0.07 = 15.40
    expect(fromMinor(applyRate(toMinor('220.00', 2), 0.07), 2)).toBe('15.40');
  });

  it('rounds half-up so a fee is never systematically short', () => {
    // 55.00 * 0.07 = 3.85 exactly.
    expect(fromMinor(applyRate(toMinor('55.00', 2), 0.07), 2)).toBe('3.85');
    // 50.07 * 0.07 = 3.5049 -> 3.50
    expect(fromMinor(applyRate(toMinor('50.07', 2), 0.07), 2)).toBe('3.50');
    // 7.50 * 0.07 = 0.525 -> half-up -> 0.53
    expect(fromMinor(applyRate(toMinor('7.50', 2), 0.07), 2)).toBe('0.53');
  });

  it('returns zero for a zero rate', () => {
    expect(applyRate(toMinor('220.00', 2), 0)).toBe(0n);
  });

  it('handles a rate with several decimal places', () => {
    // 1000.00 * 0.0725 = 72.50
    expect(fromMinor(applyRate(toMinor('1000.00', 2), 0.0725), 2)).toBe('72.50');
  });

  it('scales to large amounts without precision loss', () => {
    // 9,999,999.99 * 0.07 = 699,999.9993 -> 700,000.00
    expect(fromMinor(applyRate(toMinor('9999999.99', 2), 0.07), 2)).toBe('700000.00');
  });
});

describe('multiplyDecimalStrings — FX to SYP', () => {
  it('converts a total at a whole rate', () => {
    expect(multiplyDecimalStrings('235.40', '13000', 2)).toBe('3060200.00');
  });

  it('converts at a fractional rate', () => {
    expect(multiplyDecimalStrings('100.00', '12500.5', 2)).toBe('1250050.00');
  });

  it('is exact at SYP magnitudes where floats lose integer precision', () => {
    // Large SYP figures exceed the range where a double represents every integer.
    expect(multiplyDecimalStrings('99999.99', '15000', 2)).toBe('1499999850.00');
  });

  it('treats a rate of 1 as identity', () => {
    expect(multiplyDecimalStrings('55.55', '1', 2)).toBe('55.55');
  });
});

/**
 * The second leg of a cross-currency conversion. SAFRA stores only `X → SYP`, so
 * JOD → USD is a multiply by the JOD rate followed by a divide by the USD rate.
 */
describe('divideDecimalStrings — the return leg of a cross rate', () => {
  it('divides at a whole rate', () => {
    expect(divideDecimalStrings('130000.00', '13000', 2)).toBe('10.00');
  });

  it('rounds half-up rather than truncating', () => {
    // 10 / 3 = 3.333... -> 3.33
    expect(divideDecimalStrings('10', '3', 2)).toBe('3.33');
    // 2 / 3 = 0.666... -> 0.67
    expect(divideDecimalStrings('2', '3', 2)).toBe('0.67');
    // Exactly .005 rounds up, not to even.
    expect(divideDecimalStrings('1.005', '1', 2)).toBe('1.01');
  });

  it('honours a three-decimal output scale for JOD', () => {
    expect(divideDecimalStrings('141000.00', '18800', 3)).toBe('7.500');
  });

  it('treats a divisor of 1 as identity', () => {
    expect(divideDecimalStrings('55.55', '1', 2)).toBe('55.55');
  });

  /** A zero rate cannot be converted through, and inventing a result would be worse. */
  it('refuses to divide by zero rather than returning a number', () => {
    expect(() => divideDecimalStrings('10.00', '0', 2)).toThrow(/division by zero/i);
  });

  /**
   * The round trip is what actually matters: converting a compensation amount into
   * another currency and back must not drift by more than the output scale allows.
   */
  it('round-trips a cross-currency conversion within one minor unit', () => {
    const JOD_TO_SYP = '18800.00';
    const USD_TO_SYP = '13000.00';

    const inSyp = multiplyDecimalStrings('10.000', JOD_TO_SYP, 2);
    const inUsd = divideDecimalStrings(inSyp, USD_TO_SYP, 2);
    const backToSyp = multiplyDecimalStrings(inUsd, USD_TO_SYP, 2);
    const backToJod = divideDecimalStrings(backToSyp, JOD_TO_SYP, 3);

    expect(inUsd).toBe('14.46');
    // 10.000 JOD -> 14.46 USD -> 9.999 JOD. One-thousandth lost to the USD cent
    // boundary, which is a real property of the currencies, not a bug in the maths.
    expect(backToJod).toBe('9.999');
  });
});
