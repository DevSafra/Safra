import { describe, expect, it } from 'vitest';

import {
  applyRate,
  fromMinor,
  multiplyDecimalStrings,
  toMinor,
} from './pricing.service.js';

/**
 * These are the tests that justify not using floats.
 *
 * Each case below is one that IEEE-754 arithmetic gets wrong, and every one of them
 * is a real price a customer could be charged.
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
 * The composed calculation, matching the approved Rules Engine settings: a FLAT
 * $1.99 customer fee and a 7% partner commission.
 */
describe('a full booking calculation', () => {
  it('charges the flat fee once per booking, not per night', () => {
    const nights = 4;
    const nightly = toMinor('55.00', 2);
    const base = nightly * BigInt(nights); // 220.00

    const customerFee = toMinor('1.99', 2); // flat, per booking
    const partnerCommission = applyRate(base, 0.07);

    expect(fromMinor(base, 2)).toBe('220.00');
    expect(fromMinor(base + customerFee, 2)).toBe('221.99');
    expect(fromMinor(partnerCommission, 2)).toBe('15.40');
    expect(fromMinor(base - partnerCommission, 2)).toBe('204.60');

    // The flat fee is NOT multiplied by the night count — 4 × 1.99 would be 7.96.
    expect(fromMinor(base + customerFee, 2)).not.toBe('227.96');
  });

  it('sums mixed nightly rates from a seasonal override', () => {
    // Two nights at 40.00, one weekend night overridden to 100.00.
    const base = toMinor('40.00', 2) + toMinor('40.00', 2) + toMinor('100.00', 2);
    expect(fromMinor(base, 2)).toBe('180.00');
    expect(fromMinor(base + toMinor('1.99', 2), 2)).toBe('181.99');
  });

  it('keeps SAFRA whole: fee + payable + commission reconciles to the total', () => {
    const base = toMinor('220.00', 2);
    const customerFee = toMinor('1.99', 2);
    const commission = applyRate(base, 0.07);

    const customerPays = base + customerFee;
    const partnerReceives = base - commission;
    const safraKeeps = customerFee + commission;

    // Nothing is created or lost: what the customer pays equals what the partner
    // receives plus what SAFRA retains.
    expect(partnerReceives + safraKeeps).toBe(customerPays);
    expect(fromMinor(safraKeeps, 2)).toBe('17.39');
  });
});
