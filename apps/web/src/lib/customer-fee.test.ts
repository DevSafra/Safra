import { describe, expect, it } from 'vitest';

import { priceWithCustomerFee } from './customer-fee';

/**
 * The fee a guest is shown is the fee a guest is charged.
 *
 * Watched to fail against the version that returned `base` untouched — which is what the property
 * page did until 2026-09-03, and is why one page said «$100» while every card beside it said
 * «$101.99».
 */
describe('priceWithCustomerFee', () => {
  it('adds a flat fee once, whatever the base', () => {
    expect(priceWithCustomerFee('100.00', 'USD', flat(1.99))).toBe('101.99');
    expect(priceWithCustomerFee('0.01', 'USD', flat(1.99))).toBe('2.00');
  });

  it('adds a percentage of the base', () => {
    expect(priceWithCustomerFee('100.00', 'USD', percent(0.07))).toBe('107.00');
    /* 4999 minor x 0.1 = 499.9, half-up to 500 = 5.00, added to 49.99. */
    expect(priceWithCustomerFee('49.99', 'USD', percent(0.1))).toBe('54.99');
  });

  it('keeps the currency s own scale', () => {
    expect(priceWithCustomerFee('10.125', 'JOD', flat(1.5))).toBe('11.625');
  });

  /* Nothing configured must leave the price exactly as it was. */
  it('changes nothing when the fee is zero', () => {
    expect(priceWithCustomerFee('100.00', 'USD', flat(0))).toBe('100.00');
    expect(priceWithCustomerFee('100.00', 'USD', percent(0))).toBe('100.00');
  });

  it('returns an unparseable amount untouched rather than inventing one', () => {
    expect(priceWithCustomerFee('', 'USD', percent(0.07))).toBe('');
    expect(priceWithCustomerFee('abc', 'USD', flat(1.99))).toBe('abc');
  });
});

const flat = (customerFeeValue: number) => ({
  customerFeeMode: 'flat',
  customerFeeValue,
});
const percent = (customerFeeValue: number) => ({
  customerFeeMode: 'percent',
  customerFeeValue,
});
