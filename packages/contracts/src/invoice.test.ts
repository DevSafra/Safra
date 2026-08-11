import { describe, expect, it } from 'vitest';

import { INVOICE_LINE_KEYS, invoiceQuerySchema } from './invoice.js';

/**
 * الفواتير's contract.
 *
 * Small, because the receipt is a READ shape rather than an input — the value is in pinning the two
 * things a page and a service must agree on: the line keys, and the fact that the list is cursor-paged.
 */
describe('INVOICE_LINE_KEYS', () => {
  /**
   * The keys are a closed set, and each one is a CATALOGUE key.
   *
   * A key added here without copy renders as a missing-message placeholder in the middle of a financial
   * document, so `packages/i18n` holds a test that fails when the two drift. This one pins the set.
   */
  it('is exactly the five lines a booking row can produce', () => {
    expect([...INVOICE_LINE_KEYS]).toStrictEqual([
      'accommodation',
      'serviceFee',
      'discount',
      'giftCard',
      'wallet',
    ]);
  });

  it('has no duplicates, since each key indexes one catalogue entry', () => {
    expect(new Set(INVOICE_LINE_KEYS).size).toBe(INVOICE_LINE_KEYS.length);
  });

  /* camelCase, because these are catalogue keys rather than database enum values. */
  it.each([...INVOICE_LINE_KEYS])('%s is a plain camelCase identifier', (key) => {
    expect(key).toMatch(/^[a-z][A-Za-z]*$/);
  });
});

describe('invoiceQuerySchema', () => {
  it('defaults to the shared cursor page size', () => {
    const result = invoiceQuerySchema.safeParse({});

    /* The default belongs to `cursorQuerySchema`; this asserts the receipt list inherits it. */
    expect(result.success && result.data.limit).toBe(20);
    expect(result.success && result.data.cursor).toBeUndefined();
  });

  it('accepts a cursor', () => {
    const result = invoiceQuerySchema.safeParse({ cursor: 'abc', limit: '5' });

    expect(result.success && result.data).toStrictEqual({ cursor: 'abc', limit: 5 });
  });

  /**
   * There is no page NUMBER here, and that is deliberate.
   *
   * A receipt list is customer-facing, so it stays on the cursor — `OFFSET` is the console's documented
   * exception, bought with a page ceiling and a capped count that this screen has no reason to pay for.
   */
  it('refuses a page number', () => {
    expect(invoiceQuerySchema.safeParse({ page: 2 }).success).toBe(false);
  });

  it.each([0, -1, 101, 'many'])('refuses the limit %j', (limit) => {
    expect(invoiceQuerySchema.safeParse({ limit }).success).toBe(false);
  });
});
