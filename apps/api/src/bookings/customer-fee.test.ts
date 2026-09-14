import { describe, expect, it } from 'vitest';

import { fromMinor, toMinor } from '../common/money.js';
import { customerFeeMinor, type CustomerFeeRule } from './customer-fee.js';

/**
 * What SAFRA adds, and how many times.
 *
 * The rule changed on 2026-09-14 (Bashar): a flat fee is charged once per unit TYPE rather than
 * once per booking. «Three doubles» is one arrival to service and one fee; «a double and a suite»
 * is two. Rooms never multiply it, and neither do nights.
 */
describe('the customer fee', () => {
  const flat: CustomerFeeRule = { mode: 'flat', value: 1.99 };
  const percent: CustomerFeeRule = { mode: 'percent', value: 0.05 };
  const base = toMinor('220.00', 2);

  describe('flat', () => {
    it('is charged once for a basket holding one type', () => {
      expect(fromMinor(customerFeeMinor(base, flat, 2, 1), 2)).toBe('1.99');
    });

    /* The case that used to be wrong: many ROOMS of one type is still one arrival. */
    it('is not multiplied by the number of rooms, only by the number of types', () => {
      const threeRoomsOneType = customerFeeMinor(base, flat, 2, 1);

      expect(fromMinor(threeRoomsOneType, 2)).toBe('1.99');
      expect(fromMinor(threeRoomsOneType, 2)).not.toBe('5.97');
    });

    it('is charged per type on a mixed basket', () => {
      expect(fromMinor(customerFeeMinor(base, flat, 2, 2), 2)).toBe('3.98');
      expect(fromMinor(customerFeeMinor(base, flat, 2, 3), 2)).toBe('5.97');
    });

    /* Callers that price a single unit — the search service above all — pass nothing. */
    it('defaults to one type, so a browse price is unchanged', () => {
      expect(customerFeeMinor(base, flat, 2)).toBe(customerFeeMinor(base, flat, 2, 1));
    });

    /* A count of zero must not make the fee vanish; it is a caller bug, not a free booking. */
    it('never disappears on a nonsense count', () => {
      expect(fromMinor(customerFeeMinor(base, flat, 2, 0), 2)).toBe('1.99');
      expect(fromMinor(customerFeeMinor(base, flat, 2, -4), 2)).toBe('1.99');
    });

    /* The night count is not in this function at all, and must never creep back in. */
    it('does not grow with the stay: the base carries the nights, the fee does not', () => {
      const oneNight = toMinor('55.00', 2);
      const fourNights = oneNight * 4n;

      expect(customerFeeMinor(oneNight, flat, 2, 1)).toBe(
        customerFeeMinor(fourNights, flat, 2, 1),
      );
    });
  });

  describe('percent', () => {
    /**
     * Deliberately NOT multiplied by the type count.
     *
     * A percentage has already grown with the second type, through the larger base it is taken on.
     * Multiplying it again would charge that type twice — once in the base and once in the count.
     */
    it('ignores the type count, because the base already carries it', () => {
      expect(customerFeeMinor(base, percent, 2, 3)).toBe(
        customerFeeMinor(base, percent, 2, 1),
      );
      expect(fromMinor(customerFeeMinor(base, percent, 2, 3), 2)).toBe('11.00');
    });
  });
});
