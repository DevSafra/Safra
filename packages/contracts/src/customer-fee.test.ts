import { describe, expect, it } from 'vitest';

import { CUSTOMER_FEE_VISIBLE_SETTING, customerFeeVisible } from './customer-fee.js';

/**
 * One reader for one setting, and what it does with everything that is not the setting.
 *
 * The checkout and the invoice both call this. Their agreement is the requirement — Bashar,
 * 2026-09-04: *"one shared setting and one consistent pricing rule, without per-surface
 * hard-coding"* — and a reader that answered differently for two callers is the only way they can
 * come apart once they both go through here.
 */
describe('customerFeeVisible', () => {
  it('is true only when the setting says so', () => {
    expect(customerFeeVisible({ [CUSTOMER_FEE_VISIBLE_SETTING]: true })).toBe(true);
    expect(customerFeeVisible({ [CUSTOMER_FEE_VISIBLE_SETTING]: false })).toBe(false);
  });

  /* A hand-edited `jsonb` row arrives as text; the console POSTs a real boolean. Both count. */
  it('accepts the string form the way the API does', () => {
    expect(customerFeeVisible({ [CUSTOMER_FEE_VISIBLE_SETTING]: 'true' })).toBe(true);
    expect(customerFeeVisible({ [CUSTOMER_FEE_VISIBLE_SETTING]: 'false' })).toBe(false);
  });

  /**
   * Everything unreadable HIDES the fee, which is the direction that cannot surprise anybody.
   *
   * The dangerous mistake here is a truthiness test: `Boolean('false')` is `true`, and `1`, `'no'`
   * and `{}` are all truthy. Any of those would name a charge on a customer's screen because a
   * setting row was malformed — the opposite of the decision the operator last made.
   */
  it.each([
    ['missing entirely', {}],
    ['the string "false"', { [CUSTOMER_FEE_VISIBLE_SETTING]: 'false' }],
    ['a truthy number', { [CUSTOMER_FEE_VISIBLE_SETTING]: 1 }],
    ['a truthy string', { [CUSTOMER_FEE_VISIBLE_SETTING]: 'yes' }],
    ['an object', { [CUSTOMER_FEE_VISIBLE_SETTING]: {} }],
    ['null', { [CUSTOMER_FEE_VISIBLE_SETTING]: null }],
    ['undefined', { [CUSTOMER_FEE_VISIBLE_SETTING]: undefined }],
  ])('hides the fee when the value is %s', (_name, settings) => {
    expect(customerFeeVisible(settings)).toBe(false);
  });

  /**
   * The key is the one the API publishes, spelled once.
   *
   * A caller that inlined the string and mistyped it would read `undefined` — falsy — and hide the
   * fee forever while the console's switch appeared to do nothing at all. Naming the constant is
   * what makes that a compile error instead of a screen nobody can explain.
   */
  it('reads the published key', () => {
    expect(CUSTOMER_FEE_VISIBLE_SETTING).toBe('commission.customer_fee_visible');
    expect(customerFeeVisible({ 'commission.customer_fee_visable': true })).toBe(false);
  });
});
