import { describe, expect, it } from 'vitest';

import { customerLines, priceWithCustomerFee } from './customer-fee';

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

/**
 * The invoice breakdown in both modes, and the one property that must hold in both.
 *
 * Bashar, 2026-09-04: *"In both modes, the final total shown before payment must exactly match the
 * total charged."* An invoice is where that is easiest to get wrong, because hiding a charged line
 * leaves a breakdown that is SHORT by the fee with nothing accounting for the gap — which states
 * the fee to anybody who subtracts, and states it as an error. So the fee is folded into the
 * accommodation line rather than dropped, and every case here checks the arithmetic, not the
 * wording.
 */
describe('customerLines', () => {
  const line = (key: string, amount: string, deduction = false) => ({
    key,
    amount,
    deduction,
  });

  /** What the API sends: the fee itemised, with the optional deductions beneath it. */
  const invoice = [
    line('accommodation', '100.00'),
    line('serviceFee', '1.99'),
    line('discount', '10.00', true),
  ];

  /** Additions minus deductions, in minor units, so a rounding slip cannot hide in a float. */
  const settles = (lines: readonly { amount: string; deduction: boolean }[]): number =>
    lines.reduce(
      (sum, l) => sum + Math.round(Number(l.amount) * 100) * (l.deduction ? -1 : 1),
      0,
    );

  it('itemises the fee when it is visible', () => {
    const shown = customerLines(invoice, 'USD', true);

    expect(shown.map((l) => l.key)).toEqual(['accommodation', 'serviceFee', 'discount']);
    expect(shown.find((l) => l.key === 'serviceFee')?.amount).toBe('1.99');
  });

  it('folds the fee into the accommodation line when it is not', () => {
    const shown = customerLines(invoice, 'USD', false);

    expect(shown.map((l) => l.key)).toEqual(['accommodation', 'discount']);
    expect(shown[0]?.amount).toBe('101.99');
  });

  /* The requirement itself: the two renderings settle to the same figure. */
  it('settles to the same total in both modes', () => {
    expect(settles(customerLines(invoice, 'USD', true))).toBe(
      settles(customerLines(invoice, 'USD', false)),
    );
    expect(settles(customerLines(invoice, 'USD', false))).toBe(9199);
  });

  it('leaves the deductions alone in both modes', () => {
    for (const visible of [true, false]) {
      const discount = customerLines(invoice, 'USD', visible).find(
        (l) => l.key === 'discount',
      );

      expect(discount).toEqual(line('discount', '10.00', true));
    }
  });

  /** A three-decimal currency keeps its third digit; a helper that assumed cents would not. */
  it('folds at the currency own scale', () => {
    const jod = [line('accommodation', '10.125'), line('serviceFee', '1.500')];

    expect(customerLines(jod, 'JOD', false)[0]?.amount).toBe('11.625');
  });

  /* No fee charged renders identically either way — nothing to name, nothing to fold. */
  it('is a no-op when there is no fee line at all', () => {
    const noFee = [line('accommodation', '100.00')];

    expect(customerLines(noFee, 'USD', false)).toEqual(noFee);
    expect(customerLines(noFee, 'USD', true)).toEqual(noFee);
  });
});
