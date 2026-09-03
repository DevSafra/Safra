import { describe, expect, it } from 'vitest';

import {
  addMoney,
  formatMoney,
  localisedDescription,
  localisedName,
  localisedText,
} from './localise';

/**
 * Picking the right translation, and the bug these replace.
 *
 * Four screens carried their own version of this choice, written as `locale === 'ar' ? nameAr : nameEn
 * || nameAr`. That answers ENGLISH to a German reader, and 241 properties have a German name that
 * differs — so German visitors read English property names on search, the city pages and checkout, and
 * the search card printed the raw SLUG as the city because no city name in their language was sent at
 * all. One helper each, tested, so a fifth variant has nowhere to appear.
 */
describe('localisedName', () => {
  const full = { nameAr: 'دمشق', nameEn: 'Damascus', nameDe: 'Damaskus' };

  it.each([
    ['ar', 'دمشق'],
    ['en', 'Damascus'],
    ['de', 'Damaskus'],
  ] as const)('answers %s with its own name', (locale, expected) => {
    expect(localisedName(full, locale)).toBe(expected);
  });

  /* THE regression: German must not fall through to English. */
  it('does not answer English to a German reader', () => {
    expect(localisedName(full, 'de')).not.toBe(full.nameEn);
  });

  describe('falling back to Arabic, the authored language', () => {
    it.each(['en', 'de'] as const)(
      'falls back for %s when the name is missing',
      (locale) => {
        expect(
          localisedName({ nameAr: 'دمشق', nameEn: null, nameDe: null }, locale),
        ).toBe('دمشق');
      },
    );

    /* Whitespace is not a translation — `.trim()` is what makes this hold. */
    it.each(['en', 'de'] as const)('treats a blank name as missing for %s', (locale) => {
      expect(localisedName({ nameAr: 'دمشق', nameEn: '   ', nameDe: '\t' }, locale)).toBe(
        'دمشق',
      );
    });

    it('falls back per FIELD, not per record', () => {
      const partial = { nameAr: 'دمشق', nameEn: 'Damascus', nameDe: null };

      expect(localisedName(partial, 'en')).toBe('Damascus');
      expect(localisedName(partial, 'de')).toBe('دمشق');
    });
  });
});

describe('localisedText — the { ar, en, de } shape', () => {
  const full = { ar: 'فندق', en: 'Hotel', de: 'Hotel DE' };

  it.each([
    ['ar', 'فندق'],
    ['en', 'Hotel'],
    ['de', 'Hotel DE'],
  ] as const)('answers %s with its own text', (locale, expected) => {
    expect(localisedText(full, locale)).toBe(expected);
  });

  it.each(['en', 'de'] as const)('falls back to Arabic for %s', (locale) => {
    expect(localisedText({ ar: 'فندق', en: null, de: null }, locale)).toBe('فندق');
  });

  /*
    An empty STRING rather than the word "null" when nothing is authored at all.

    This is the case that renders into a heading, and `String(null)` on a page is worse than a blank.
  */
  it('answers an empty string when no language has anything', () => {
    for (const locale of ['ar', 'en', 'de'] as const) {
      expect(localisedText({ ar: null, en: null, de: null }, locale)).toBe('');
    }
  });

  it('agrees with localisedName given equivalent data', () => {
    expect(localisedText({ ar: 'دمشق', en: 'Damascus', de: 'Damaskus' }, 'de')).toBe(
      localisedName({ nameAr: 'دمشق', nameEn: 'Damascus', nameDe: 'Damaskus' }, 'de'),
    );
  });
});

describe('localisedDescription', () => {
  const full = {
    descriptionAr: 'وصف',
    descriptionEn: 'Description',
    descriptionDe: 'Beschreibung',
  };

  it.each([
    ['ar', 'وصف'],
    ['en', 'Description'],
    ['de', 'Beschreibung'],
  ] as const)('answers %s with its own description', (locale, expected) => {
    expect(localisedDescription(full, locale)).toBe(expected);
  });

  /* NULL rather than an empty string: a caller renders a description only if there is one. */
  it('answers null when nothing is authored', () => {
    expect(
      localisedDescription(
        { descriptionAr: null, descriptionEn: null, descriptionDe: null },
        'en',
      ),
    ).toBeNull();
  });

  it('falls back to Arabic before giving up', () => {
    expect(
      localisedDescription(
        { descriptionAr: 'وصف', descriptionEn: null, descriptionDe: null },
        'de',
      ),
    ).toBe('وصف');
  });
});

/**
 * `formatMoney` — amounts arrive as decimal STRINGS and are parsed only here.
 *
 * Nothing upstream does arithmetic on a float: a rounding error in a price is not recoverable once it
 * has been shown to a customer.
 */
describe('formatMoney', () => {
  it('renders a currency amount for each locale without throwing', () => {
    for (const locale of ['ar', 'en', 'de'] as const) {
      const rendered = formatMoney('65.00', 'USD', locale);

      expect(rendered).toContain('65');
      expect(rendered.length).toBeGreaterThan(2);
    }
  });

  it('keeps the cents it was given rather than rounding them away', () => {
    expect(formatMoney('1234.56', 'USD', 'en')).toContain('56');
  });

  /* Western digits across all three locales — no bank statement is written in Arabic-Indic numerals. */
  it('uses Western digits even in Arabic', () => {
    expect(formatMoney('65.00', 'USD', 'ar')).toMatch(/65/);
  });

  /**
   * `exact` — the receipt's column, not a price tag.
   *
   * A price reads better as `$380` than `$380.00`, which is the default. A RECEIPT breakdown printed
   * `$380`, `$1.99` and `$381.99` down one column, and the whole number read as a different kind of
   * figure from the two beside it. `exact` pins two decimals so the column aligns.
   */
  it('drops trailing zeros on a whole price by default', () => {
    expect(formatMoney('380.00', 'USD', 'en')).toBe('$380');
  });

  /**
   * The symbol is the CATALOGUE's, in every locale.
   *
   * `Intl`'s `style: 'currency'` spells a currency for the reader's locale, so an Arabic page
   * rendered every dollar price «US$ 100» while the header's own currency menu offered «$»
   * (Bashar, 2026-09-03: «remove the "US"»). These are the assertions that were watched to fail
   * against that: the first two are red on `style: 'currency'` under `ar`, and the SYP pair is red
   * on `currencyDisplay: 'narrowSymbol'`, which is the fix that looks right and renders the
   * Syrian pound as «£».
   */
  it('writes a dollar price with the catalogue symbol, in every locale', () => {
    for (const locale of ['ar', 'en', 'de'] as const) {
      expect(formatMoney('100.00', 'USD', locale), locale).not.toMatch(/US/);
      expect(formatMoney('100.00', 'USD', locale), locale).toContain('$');
    }
  });

  it('writes the Syrian pound as ل.س, after the number', () => {
    expect(formatMoney('100.00', 'SYP', 'ar')).toBe('100 ل.س');
    expect(formatMoney('100.00', 'SYP', 'en')).toBe('100 ل.س');
  });

  /* An Arabic-script symbol trails the number; a Latin one leads it. */
  it('places the symbol by its script, not by the reader s locale', () => {
    expect(formatMoney('100.00', 'AED', 'ar')).toBe('100 د.إ');
    expect(formatMoney('100.00', 'EUR', 'ar')).toBe('\u20ac100');
  });

  /* A code the catalogue does not know keeps its code — never a guessed symbol. */
  it('falls back to the code for an unknown currency', () => {
    expect(formatMoney('100.00', 'XYZ', 'en')).toBe('100 XYZ');
  });

  it('keeps two decimals on a whole amount when exact', () => {
    expect(formatMoney('380.00', 'USD', 'en', { exact: true })).toBe('$380.00');
  });

  it('leaves a fractional amount unchanged either way', () => {
    expect(formatMoney('1.99', 'USD', 'en')).toBe('$1.99');
    expect(formatMoney('1.99', 'USD', 'en', { exact: true })).toBe('$1.99');
  });

  /* Every figure in a receipt column carries the same precision, whole or not. */
  it('gives a column of receipt figures one precision', () => {
    const column = ['380.00', '1.99', '381.99'].map((amount) =>
      formatMoney(amount, 'USD', 'en', { exact: true }),
    );

    expect(column).toStrictEqual(['$380.00', '$1.99', '$381.99']);
    expect(column.every((entry) => /\.\d{2}$/.test(entry))).toBe(true);
  });

  /* `exact` must not resurrect the blank-is-zero hole the guard below covers. */
  it.each(['', '  ', 'not-a-number'])(
    'still refuses to invent a figure for %j when exact',
    (bad) => {
      expect(formatMoney(bad, 'USD', 'en', { exact: true })).not.toMatch(/0\.00/);
    },
  );
});

/**
 * A blank amount must not become a price of zero.
 *
 * `Number('')` is `0` and finite, so the original guard let a missing figure format as a real price.
 * The partner app's `amount()` had the same hole and rendered «$0.00» — found by testing it.
 */
describe('formatMoney — a blank is not zero', () => {
  it.each(['', '   '])('does not render %j as a zero amount', (blank) => {
    const rendered = formatMoney(blank, 'USD', 'en');

    expect(rendered).not.toMatch(/0/);
    expect(rendered).toContain('USD');
  });

  it('still renders a genuine zero when that is the value', () => {
    expect(formatMoney('0.00', 'USD', 'en')).toMatch(/0/);
  });

  it.each(['not-a-number', 'NaN'])(
    'falls back for %j without inventing a figure',
    (bad) => {
      expect(formatMoney(bad, 'USD', 'en')).toContain('USD');
    },
  );

  /**
   * The CURRENCY's scale, not two.
   *
   * `maximumFractionDigits: 2` overrode the table `Intl` already carries, so a three-decimal
   * currency lost a digit here exactly as it did in the console and the partner portal —
   * `10.125` rendered `10.13`. A customer reading a price is the one reader who cannot check it
   * against anything.
   */
  it('keeps the third decimal of a three-decimal currency', () => {
    expect(formatMoney('10.125', 'JOD', 'en')).toContain('10.125');
    expect(formatMoney('10.125', 'IQD', 'en')).toContain('10.125');
  });

  it('still writes two for a two-decimal currency, and none for a whole price', () => {
    expect(formatMoney('10.1', 'USD', 'en')).toContain('10.10');
    /* A round price reads better without the zeros — unchanged, and asserted so it stays. */
    expect(formatMoney('65', 'USD', 'en')).not.toContain('.00');
  });
});

/**
 * `addMoney` — the sum of two displayed lines, done in minor units.
 *
 * Watched to fail against the obvious implementation: `(Number(a) + Number(b)).toFixed(2)` returns
 * `'0.30'` for the third case here only because `toFixed` rounds away the error, and returns
 * `'10.13'` for the JOD case, silently dropping a digit a three-decimal currency actually has.
 */
describe('addMoney', () => {
  it('adds without a float in the middle', () => {
    expect(addMoney('100.00', '1.99', 'USD')).toBe('101.99');
    expect(addMoney('0.10', '0.20', 'USD')).toBe('0.30');
    expect(addMoney('0.07', '0.01', 'USD')).toBe('0.08');
  });

  it('keeps the currency s own scale', () => {
    /* Three decimals, and the third one survives. */
    expect(addMoney('10.125', '0.005', 'JOD')).toBe('10.130');
    /* A zero-decimal currency has no point at all. */
    expect(addMoney('1200', '300', 'IQD')).toBe('1500.000');
  });

  it('carries across the decimal point and handles a negative', () => {
    expect(addMoney('9.99', '0.01', 'USD')).toBe('10.00');
    expect(addMoney('100.00', '-1.99', 'USD')).toBe('98.01');
  });

  /* A figure it cannot parse is not turned into one it invented. */
  it('returns the first amount when either side is unparseable', () => {
    expect(addMoney('100.00', '', 'USD')).toBe('100.00');
    expect(addMoney('100.00', 'abc', 'USD')).toBe('100.00');
  });
});
