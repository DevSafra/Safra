import { describe, expect, it } from 'vitest';

import { readableDate } from './readable-date.js';

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
