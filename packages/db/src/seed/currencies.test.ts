import { describe, expect, it } from 'vitest';

import { COUNTRIES, CURRENCIES } from './reference.js';

/**
 * One currency offered, and every launch market priced in it.
 *
 * ## Why this is a test
 *
 * Standing instruction from Bashar, 2026-09-14: «remove all currencies from the system and keep
 * only USD for everything». That SUPERSEDES 2026-08-30's «keep the currency only (usd, euro,
 * syp)», which itself removed JOD and LBP — neither could ever price anything, because `fx_rates`
 * holds one pair, USD→SYP, and `rateBetween` REFUSES rather than defaulting to 1 for a pair it
 * cannot reach. EUR was in exactly that position and is retired for exactly that reason.
 *
 * SYP keeps its ROW and loses its OFFER: it is the accounting currency, written onto every ledger
 * leg, and removing it would orphan the basis of every booking already recorded.
 *
 * ## The second assertion is the one that decays
 *
 * Removing a currency is easy to get right once and easy to undo by adding a country beside it.
 * A launch market whose display currency is not in this list is the same defect wearing a
 * different row, so it is checked rather than assumed.
 */
describe('the currencies the platform offers', () => {
  const codes = CURRENCIES.map((one) => one.code);

  it('is exactly SYP and USD', () => {
    expect([...codes].sort()).toEqual(['SYP', 'USD']);
  });

  /**
   * And only ONE of them is offered.
   *
   * The row for SYP is not a currency anybody can choose — it is the unit the books are kept in,
   * carried on every ledger leg as `amount_syp`. Asserting the OFFER separately from the ROW is
   * what keeps «keep only USD» true without pretending the accounting currency does not exist.
   */
  it('offers the dollar, and nothing else', () => {
    expect(CURRENCIES.filter((one) => one.isActive).map((one) => one.code)).toEqual([
      'USD',
    ]);
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
