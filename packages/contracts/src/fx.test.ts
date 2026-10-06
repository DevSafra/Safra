import { describe, expect, it } from 'vitest';

import { ERROR } from './error-codes.js';
import { setFxRateSchema } from './fx.js';

/**
 * A rate the column cannot hold is refused at the boundary (audit 2026-10-06).
 *
 * `fx_rates.rate` is `numeric(18,8)`: ten digits before the point. The schema bounded only the
 * decimals, so an eleven-digit rate passed validation and PostgreSQL refused the INSERT with
 * "numeric field overflow" — a 500 where the person typing it needed to be told why.
 */
describe('setFxRateSchema', () => {
  const rate = (value: string) =>
    setFxRateSchema.safeParse({ currency: 'USD', rate: value });

  it('accepts the largest rate the column holds', () => {
    expect(rate('9999999999.99999999').success).toBe(true);
    expect(rate('13000.5').success).toBe(true);
  });

  it('refuses a rate with more whole digits than the column holds, with a code', () => {
    for (const value of ['10000000000', '99999999999.5', '1'.repeat(40)]) {
      const parsed = rate(value);

      expect(parsed.success, value).toBe(false);
      expect(parsed.error?.issues[0]?.message, value).toBe(
        ERROR.VALIDATION_RATE_TOO_LARGE,
      );
    }
  });

  it('still refuses more decimals than the column keeps', () => {
    expect(rate('1.123456789').success).toBe(false);
  });
});
