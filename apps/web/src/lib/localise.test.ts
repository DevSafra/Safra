import { describe, expect, it } from 'vitest';

import {
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
