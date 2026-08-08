import { describe, expect, it } from 'vitest';
import IntlMessageFormat from 'intl-messageformat';

import ar from './messages/web/ar.json' with { type: 'json' };
import en from './messages/web/en.json' with { type: 'json' };
import de from './messages/web/de.json' with { type: 'json' };

/**
 * Arabic plural agreement, pinned to the numbers that break it.
 *
 * ## Why exact-value cases were not enough
 *
 * These messages used `=1`, `=2` and `other`. That looks complete and is wrong: Arabic has SIX
 * plural categories and the boundaries are not where an English speaker expects them.
 *
 * - 3–10 is `few`, and takes the broken plural — «٥ ضيوف».
 * - **11–99 is `many`, and takes the SINGULAR** — «١٥ ضيفًا», not «١٥ ضيوف».
 * - 100 and above is `other`, singular again — «١٠٠ ضيف».
 *
 * With only `=1`/`=2`/`other`, everything from three upwards fell into one case, so either 3–10 or
 * 11–99 had to be wrong whichever wording was chosen. It was 11–99 — the range a real search result
 * count lands in most often.
 *
 * ## Why the test asserts through `IntlMessageFormat`
 *
 * That is the same formatter `next-intl` uses, driven by `Intl.PluralRules`. Asserting the rendered
 * STRING at each boundary is the only check that catches a category being omitted; a test that the
 * message merely contains the word `plural` would pass on the version this replaces.
 */

type Messages = Record<string, Record<string, string>>;

const format = (locale: string, message: string, values: Record<string, number>) =>
  String(new IntlMessageFormat(message, locale).format(values));

const message = (messages: unknown, path: string): string => {
  const [group, key] = path.split('.');

  return (messages as Messages)[group ?? '']?.[key ?? ''] ?? '';
};

describe('Arabic plural agreement', () => {
  /** The five counts that sit in five different CLDR categories. */
  const BOUNDARIES = [1, 2, 3, 15, 100];

  it('picks a distinct form for one, two, few, many and other', () => {
    const rendered = BOUNDARIES.map((count) =>
      format('ar', message(ar, 'search.resultsTitle'), { count }),
    );

    /* Every boundary produces its own wording — a collapsed case shows up as a duplicate. */
    expect(new Set(rendered).size).toBe(BOUNDARIES.length);
  });

  /**
   * The specific regression: eleven through ninety-nine takes the SINGULAR noun.
   *
   * This is the case `other` used to swallow, and the one a reader notices, because a result count
   * is far more often 15 than 3.
   */
  it('uses the singular noun for 11–99, not the plural', () => {
    const many = format('ar', message(ar, 'search.guestsCount'), { count: 15 });
    const few = format('ar', message(ar, 'search.guestsCount'), { count: 5 });

    expect(many).toContain('بالغًا');
    expect(few).toContain('بالغين');
    expect(many).not.toContain('بالغين');
  });

  it('counts nights the same way', () => {
    expect(format('ar', message(ar, 'account.nights'), { count: 1 })).toBe('ليلة واحدة');
    expect(format('ar', message(ar, 'account.nights'), { count: 2 })).toBe('ليلتان');
    expect(format('ar', message(ar, 'account.nights'), { count: 3 })).toContain('ليالٍ');
    expect(format('ar', message(ar, 'account.nights'), { count: 15 })).toContain('ليلة');
    expect(format('ar', message(ar, 'account.nights'), { count: 15 })).not.toContain(
      'ليالٍ',
    );
  });

  it('agrees in the stay total, which is a preposition plus a count', () => {
    expect(format('ar', message(ar, 'property.totalFor'), { nights: 1 })).toBe(
      'لليلة واحدة',
    );
    expect(format('ar', message(ar, 'property.totalFor'), { nights: 2 })).toBe('لليلتين');
    expect(format('ar', message(ar, 'property.totalFor'), { nights: 4 })).toContain(
      'ليالٍ',
    );
  });

  it('agrees inside a sentence, not only in a standalone phrase', () => {
    const one = format('ar', message(ar, 'auth.claimedBookings'), { count: 1 });
    const many = format('ar', message(ar, 'auth.claimedBookings'), { count: 15 });

    /* The sentence around the count survives — the plural is a clause, not the whole message. */
    expect(one).toContain('بهذا العنوان بحسابك');
    expect(many).toContain('بهذا العنوان بحسابك');
    expect(one).not.toBe(many);
  });

  /**
   * Every plural message in every locale must still FORMAT.
   *
   * An ICU message with an unbalanced brace or a misspelt category throws at render time, inside a
   * server component, which surfaces as a 500 on a page that was fine yesterday. Parsing all of
   * them here turns that into a failing unit test.
   */
  it('every plural message in all three locales parses and renders', () => {
    const locales: [string, unknown][] = [
      ['ar', ar],
      ['en', en],
      ['de', de],
    ];

    for (const [locale, messages] of locales) {
      for (const [group, entries] of Object.entries(messages as Messages)) {
        for (const [key, value] of Object.entries(entries)) {
          if (typeof value !== 'string' || !value.includes(', plural,')) continue;

          /*
            EVERY placeholder, not only the plural one. A message can carry both — «أحدث {shown}
            من {total, plural, …}» — and formatting it with one argument throws MISSING_VALUE,
            which would report as a broken plural rather than as an incomplete test.
          */
          const names = [...value.matchAll(/\{(\w+)/g)].map((match) => match[1] ?? '');

          for (const count of [0, 1, 2, 3, 15, 100]) {
            const values = Object.fromEntries(names.map((name) => [name, count]));

            expect(
              () => format(locale, value, values),
              `${locale}.${group}.${key} at ${count}`,
            ).not.toThrow();
          }
        }
      }
    }
  });

  /**
   * Arabic must not be left with an English-shaped message.
   *
   * A message that only has `one`/`other` is correct English and wrong Arabic — it is exactly the
   * shape somebody produces by translating the English string rather than the meaning. Every plural
   * in the Arabic catalogue has to name `few` and `many`, which English never needs.
   */
  it('no Arabic plural is missing the few or many category', () => {
    const missing: string[] = [];

    for (const [group, entries] of Object.entries(ar as unknown as Messages)) {
      for (const [key, value] of Object.entries(entries)) {
        if (typeof value !== 'string' || !value.includes(', plural,')) continue;

        if (!value.includes('few {') || !value.includes('many {')) {
          missing.push(`${group}.${key}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });
});
