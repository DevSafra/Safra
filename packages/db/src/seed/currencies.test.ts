import { describe, expect, it } from 'vitest';

import { COUNTRIES, CURRENCIES } from './reference.js';

/**
 * Three currencies, and every launch market priced in one that can be quoted.
 *
 * ## Why this is a test
 *
 * Standing instruction from Bashar (2026-08-30): «keep the currency only (usd, euro, syp)». JOD
 * and LBP had been seeded since the first migration and neither could ever price anything —
 * `fx_rates` holds one pair, USD→SYP, and `rateBetween` REFUSES rather than defaulting to 1 for a
 * pair it cannot reach. So «الأردن · JOD» sat on the geography screen above a market whose
 * bookings could not be quoted: a currency the platform offered and then declined to honour.
 *
 * ## The second assertion is the one that decays
 *
 * Removing a currency is easy to get right once and easy to undo by adding a country beside it.
 * A launch market whose display currency is not in this list is the same defect wearing a
 * different row, so it is checked rather than assumed.
 */
describe('the currencies the platform offers', () => {
  const codes = CURRENCIES.map((one) => one.code);

  it('is exactly SYP, USD and EUR', () => {
    expect([...codes].sort()).toEqual(['EUR', 'SYP', 'USD']);
  });

  it('prices every launch market in one of them', () => {
    for (const country of COUNTRIES) {
      expect(
        codes,
        `${country.code} displays in ${country.displayCurrency}, which is not seeded`,
      ).toContain(country.displayCurrency);
    }
  });

  /**
   * SYP is what the ledger measures in — `ledger_entries.amount_syp`, 71,463 rows and counting —
   * and USD is §1.4's pricing anchor and the only pair with a rate. Removing either is a much
   * larger decision than removing a currency nothing referenced, so both are named here.
   */
  it('keeps the accounting currency and the pricing anchor', () => {
    expect(codes).toContain('SYP');
    expect(codes).toContain('USD');
  });
});
