import { describe, expect, it } from 'vitest';

import {
  CUSTOMER_FACING_METHODS,
  PAYMENT_METHODS,
  isCustomerFacingMethod,
  startPaymentSchema,
} from './payment.js';

const VALID_TOKEN = 'a'.repeat(43);

function body(overrides: Record<string, unknown> = {}) {
  return {
    reference: 'BKG-2026-000001',
    accessToken: VALID_TOKEN,
    ...overrides,
  };
}

describe('payment method vocabulary', () => {
  /**
   * The instruction this encodes: the site offers Visa, Mastercard, Klarna and Sham
   * Cash, and nothing else (Bashar, 2026-07-30). A test rather than a comment because
   * the cost of quietly regaining PayPal is a customer clicking a rail that has
   * refused SAFRA's business.
   */
  it('offers exactly the four approved methods, in display order', () => {
    expect([...CUSTOMER_FACING_METHODS]).toStrictEqual([
      'visa',
      'mastercard',
      'klarna',
      'sham_cash',
    ]);
  });

  it.each(['paypal', 'apple_pay'])('does not know %s at all', (removed) => {
    expect(PAYMENT_METHODS as readonly string[]).not.toContain(removed);
    expect(isCustomerFacingMethod(removed)).toBe(false);
  });

  it('includes klarna', () => {
    expect(PAYMENT_METHODS as readonly string[]).toContain('klarna');
    expect(isCustomerFacingMethod('klarna')).toBe(true);
  });

  /**
   * The internal rails must stay in PAYMENT_METHODS — `gift_card` and `wallet` settle
   * §7.3 and §11.2, `bank_transfer` is the finance fallback — but must never be
   * offerable to a customer.
   */
  it.each(['gift_card', 'wallet', 'bank_transfer'])(
    'keeps %s as a known method but not a customer-facing one',
    (internal) => {
      expect(PAYMENT_METHODS as readonly string[]).toContain(internal);
      expect(isCustomerFacingMethod(internal)).toBe(false);
    },
  );

  it('never lists a customer-facing method that is not a known method', () => {
    for (const method of CUSTOMER_FACING_METHODS) {
      expect(PAYMENT_METHODS as readonly string[]).toContain(method);
    }
  });
});

describe('startPaymentSchema', () => {
  it('accepts a request with no method, leaving the choice to routing', () => {
    expect(startPaymentSchema.safeParse(body()).success).toBe(true);
  });

  it.each(['visa', 'mastercard', 'klarna', 'sham_cash'])('accepts %s', (method) => {
    expect(startPaymentSchema.safeParse(body({ method })).success).toBe(true);
  });

  it.each(['paypal', 'apple_pay'])('rejects the removed method %s', (method) => {
    expect(startPaymentSchema.safeParse(body({ method })).success).toBe(false);
  });

  /**
   * A client must not be able to select a rail that settles against an internal
   * balance or a manual finance step.
   */
  it.each(['wallet', 'gift_card', 'bank_transfer'])(
    'rejects the internal rail %s',
    (method) => {
      expect(startPaymentSchema.safeParse(body({ method })).success).toBe(false);
    },
  );

  it('rejects an unknown field, so no amount can be smuggled in', () => {
    expect(startPaymentSchema.safeParse(body({ amount: '0.01' })).success).toBe(false);
  });

  it('rejects a malformed booking reference', () => {
    expect(startPaymentSchema.safeParse(body({ reference: 'BKG-1' })).success).toBe(
      false,
    );
  });

  it('rejects an access token outside the expected length and alphabet', () => {
    expect(startPaymentSchema.safeParse(body({ accessToken: 'short' })).success).toBe(
      false,
    );
    expect(
      startPaymentSchema.safeParse(body({ accessToken: `${'a'.repeat(42)}$` })).success,
    ).toBe(false);
  });
});
