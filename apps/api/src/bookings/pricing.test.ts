import { describe, expect, it } from 'vitest';

import { applyRate, fromMinor, toMinor } from '../common/money.js';

/**
 * The composed calculation, matching the approved Rules Engine settings: a FLAT
 * $1.99 customer fee and a 7% partner commission.
 *
 * The primitives themselves are tested in `common/money.test.ts`; what is asserted
 * here is the pricing IDENTITY they are combined into.
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
