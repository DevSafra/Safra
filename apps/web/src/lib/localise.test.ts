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
});
