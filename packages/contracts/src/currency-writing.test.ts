import { describe, expect, it } from 'vitest';

import {
  CURRENCY_CATALOGUE,
  currencyDecimals,
  symbolTrails,
} from './currency-catalogue.js';

/**
 * The two facts every money formatter used to decide for itself, and got wrong three ways.
 *
 * The console carried `{ JOD: 3 }` — hand-written when JOD was the currency in front of somebody,
 * and missing IQD, which is also three. The partner portal hard-coded two. The customer site
 * passed `maximumFractionDigits: 2` to `Intl`, overriding the table `Intl` already has. All three
 * rendered `10.125` as `10.13`, which is the console rounding away a digit the database stores.
 *
 * Both are asserted against the CATALOGUE rather than against a second list written here: a test
 * that repeats the values it is checking passes when both copies are wrong together.
 */
describe('currencyDecimals', () => {
  it('answers with the scale the catalogue states, for every currency in it', () => {
    for (const one of CURRENCY_CATALOGUE) {
      expect(currencyDecimals(one.code), one.code).toBe(one.decimals);
    }
  });

  it('finds the three-decimal currencies rather than assuming two', () => {
    /*
      The opposite control. Every assertion above would pass against a function that returned 2 for
      everything IF the catalogue held only two-decimal currencies — so this names the ones that
      make the question worth asking, and would fail the day somebody "simplifies" the catalogue.
    */
    const three = CURRENCY_CATALOGUE.filter((one) => one.decimals === 3).map(
      (one) => one.code,
    );

    expect(three).toContain('JOD');
    expect(three).toContain('IQD');
    expect(currencyDecimals('IQD')).toBe(3);
  });

  it('answers two for a code the platform does not price in', () => {
    expect(currencyDecimals('XXX')).toBe(2);
  });

  it('is case-insensitive, because a code arrives from a row and from a form', () => {
    expect(currencyDecimals('jod')).toBe(3);
  });
});

/**
 * Where a symbol goes, asked of the SYMBOL rather than of a list of codes.
 *
 * It was `currency === 'SYP' || currency === 'JOD' || currency === 'LBP'`, written twice. That
 * list named two currencies the platform has since retired and none of the six a staff member can
 * now add on المدن — so «د.إ100.00» would have rendered an Arabic symbol glued to the front of a
 * Latin number, which is the bidirectional failure the rule exists to prevent.
 */
describe('symbolTrails', () => {
  it('puts an Arabic-script symbol after the number', () => {
    for (const symbol of ['ل.س', 'د.أ', 'ل.ل', 'د.إ', 'ر.س', 'ج.م', 'د.ع']) {
      expect(symbolTrails(symbol), symbol).toBe(true);
    }
  });

  it('puts a Latin or sign symbol before it', () => {
    for (const symbol of ['$', '€', '£', '₺', 'USD']) {
      expect(symbolTrails(symbol), symbol).toBe(false);
    }
  });

  /**
   * The whole point of asking the symbol: every currency the console can ADD is answered for.
   *
   * A list of codes could not be, by construction — it was written before those currencies were
   * offered, and nothing would have failed when they were.
   */
  it('answers for every symbol in the catalogue, without a list of codes', () => {
    const trailing = CURRENCY_CATALOGUE.filter((one) => symbolTrails(one.symbol));

    /* Both groups non-empty, or the function could be a constant and still pass. */
    expect(trailing.length).toBeGreaterThan(0);
    expect(trailing.length).toBeLessThan(CURRENCY_CATALOGUE.length);

    expect(trailing.map((one) => one.code)).toContain('AED');
    expect(trailing.map((one) => one.code)).not.toContain('USD');
  });
});
