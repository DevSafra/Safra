import { describe, expect, it } from 'vitest';

import { readableDate, readableDateWithYear } from './readable-date.js';

describe('a stay date as a person reads it', () => {
  it('names the weekday and the month in the reader’s language', () => {
    const ar = readableDate('2026-10-05', 'ar');
    const en = readableDate('2026-10-05', 'en');

    expect(ar, 'Arabic').not.toBe(en);
    expect(en).toContain('Oct');
    /* Arabic renders a month NAME rather than a number — the point of the helper. */
    expect(ar).toMatch(/[؀-ۿ]/);
  });

  it('writes the digits in Latin, as this platform does everywhere else', () => {
    expect(readableDate('2026-10-05', 'ar')).toContain('5');
    expect(readableDate('2026-10-05', 'ar')).not.toMatch(/[٠-٩]/);
  });

  /**
   * A stay date is a CALENDAR date, not an instant.
   *
   * Without `timeZone: 'UTC'` this renders the 4th for every reader west of Greenwich — a defect
   * that is invisible in Damascus and wrong in New York, and the reason the helper exists rather
   * than an inline `toLocaleDateString`.
   */
  it('does not slip a day for a reader in a western timezone', () => {
    const previous = process.env.TZ;

    process.env.TZ = 'America/Los_Angeles';
    try {
      expect(readableDate('2026-10-05', 'en')).toContain('5');
    } finally {
      process.env.TZ = previous;
    }
  });

  it('returns an unparseable value unchanged rather than inventing a date', () => {
    expect(readableDate('not-a-date', 'ar')).toBe('not-a-date');
  });
});

describe('a date that can be a year away', () => {
  /*
   * The reason the variant exists: without the year, a January trip this year and a January trip
   * next year read as the same day. Asserted as «the two renderings differ» rather than only «2027
   * appears», because the defect is the collision, and a year appended to one side only would
   * pass a substring check.
   */
  it('tells January of one year from January of the next, in every locale', () => {
    for (const locale of ['ar', 'en', 'de'] as const) {
      const thisYear = readableDateWithYear('2026-01-27', locale);
      const nextYear = readableDateWithYear('2027-01-27', locale);

      expect(nextYear, locale).not.toBe(thisYear);
      expect(nextYear, locale).toContain('2027');
      expect(thisYear, locale).toContain('2026');
    }
  });

  it('keeps everything readableDate says, and adds only the year', () => {
    for (const locale of ['ar', 'en', 'de'] as const) {
      const withYear = readableDateWithYear('2027-01-27', locale);

      expect(withYear.replace(/[\s,.]*2027[\s,.]*$/, ''), locale).toBe(
        readableDate('2027-01-27', locale).replace(/[\s,.]+$/, ''),
      );
    }
    expect(readableDateWithYear('2027-01-27', 'ar')).not.toMatch(/[٠-٩]/);
  });

  it('does not slip a day, or a year, for a reader in a western timezone', () => {
    const previous = process.env.TZ;

    process.env.TZ = 'America/Los_Angeles';
    try {
      expect(readableDateWithYear('2027-01-01', 'en')).toBe('Fri, Jan 1, 2027');
    } finally {
      process.env.TZ = previous;
    }
  });

  it('returns an unparseable value unchanged', () => {
    expect(readableDateWithYear('not-a-date', 'ar')).toBe('not-a-date');
  });
});
