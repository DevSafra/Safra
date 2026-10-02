import { describe, expect, it } from 'vitest';

import { createRefundSchema } from './payment.js';

/**
 * A staff refund request can say WHY and nothing else (2026-10-02).
 *
 * The destination of a refund is the payment it refunds, decided on the server from
 * `payments.provider` and `provider_ref`. If this schema ever accepted a destination, an amount or a
 * method, a person could point money somewhere the customer never paid from, so every such field is
 * refused rather than ignored: `.strict()` is the guard, and this proves it.
 */
describe('the staff refund request', () => {
  it('takes a reason', () => {
    expect(createRefundSchema.safeParse({ reason: 'الشريك ألغى الحجز' }).success).toBe(
      true,
    );
  });

  for (const field of [
    'method',
    'provider',
    'providerRef',
    'destination',
    'iban',
    'amount',
    'paymentId',
    'toWallet',
  ]) {
    it(`refuses a ${field}`, () => {
      expect(
        createRefundSchema.safeParse({ reason: 'الشريك ألغى الحجز', [field]: 'x' })
          .success,
      ).toBe(false);
    });
  }
});
