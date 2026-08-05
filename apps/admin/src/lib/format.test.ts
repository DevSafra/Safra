import { describe, expect, it } from 'vitest';

import { dateRange, shortDate } from './format';

/**
 * The separator `dateRange` writes inside a date: a `U+002D` hyphen fenced by `U+2060` WORD
 * JOINER.
 *
 * Spelt out here so the tests below fail loudly if either half is "simplified" away. Both are
 * load-bearing and neither is visible: the hyphen must be `U+002D` because that bidi class is what
 * keeps `08-09-2026` from rendering as `2026-09-08` on an RTL line, and the joiners are what stop
 * a squeezed column splitting the date across two lines. See the note on `dateRange`.
 */
const H = '\u2060-\u2060';

/**
 * The bookings table's stay column.
 *
 * Written after the column overflowed its cell and painted over المبلغ: `201.99 USD` and a
 * check-in date were printed on top of each other, because two full dates are 159px of content
 * in a 133px column. Collapsing what the two dates share is the fix, and these pin the collapsing
 * rules — every one of them changes how wide the result is.
 */
describe('dateRange', () => {
  it('writes the month and year once when both dates share them', () => {
    expect(dateRange('2026-09-04', '2026-09-08')).toBe(`04 ← 08${H}09${H}2026`);
  });

  it('writes the year once when the months differ', () => {
    expect(dateRange('2026-08-28', '2026-09-03')).toBe(`28${H}08 ← 03${H}09${H}2026`);
  });

  it('writes both dates in full across a year boundary', () => {
    expect(dateRange('2026-12-28', '2027-01-03')).toBe(
      `28${H}12${H}2026 ← 03${H}01${H}2027`,
    );
  });

  /**
   * Not "04 ← 04-09-2026".
   *
   * A range whose ends are the same date is one date, and printing an arrow between two identical
   * values reads as a rendering fault rather than as a same-day booking.
   */
  it('collapses an identical pair to a single date', () => {
    expect(dateRange('2026-09-04', '2026-09-04')).toBe(`04${H}09${H}2026`);
  });

  /** A missing end is not a range, and must not render as one. */
  it('reports a dash when either end is missing', () => {
    expect(dateRange(null, '2026-09-08')).toBe('—');
    expect(dateRange('2026-09-04', undefined)).toBe('—');
    expect(dateRange(null, null)).toBe('—');
  });

  /** Full ISO timestamps, as the API sends them, are sliced to the calendar date. */
  it('accepts a full ISO timestamp', () => {
    expect(dateRange('2026-09-04T14:00:00.000Z', '2026-09-08T11:00:00.000Z')).toBe(
      `04 ← 08${H}09${H}2026`,
    );
  });

  /**
   * Something unparseable falls back to both values rather than to a wrong date.
   *
   * A date column that silently invents a plausible date is worse than one that looks odd: the
   * reader has no way to tell an invented date from a real one.
   */
  it('falls back rather than guessing at an unparseable value', () => {
    const result = dateRange('not-a-date', '2026-09-08');

    expect(result).toContain('08');
    expect(result).toContain('←');
  });

  /**
   * The hyphen is `U+002D` and never `U+2011`.
   *
   * The two are visually identical and only one reads correctly: `U+002D` is bidi class ES and
   * joins the digit groups into one number run, `U+2011` is class ON and splits them, so an RTL
   * line lays the three groups out right to left and the console showed `2026-09-08`. Asserted on
   * the character because no screenshot review would catch the difference.
   */
  it('separates a date with U+002D, never the non-breaking hyphen', () => {
    const result = dateRange('2026-08-28', '2026-09-03');

    expect(result).toContain('-');
    expect(result).not.toContain('\u2011');
  });

  /**
   * Each hyphen is fenced with `U+2060` WORD JOINER, and the only breakable spaces are at the arrow.
   *
   * `U+2060` is bidi class BN, which UAX #9 removes before resolving direction — so unlike
   * `U+2011` it cannot reorder anything — and UAX #14 forbids a line break at it. Without it a
   * table between 940px and 1180px wide split `03-01-2027` across two lines.
   */
  it('fences every hyphen with a word joiner so a date cannot split', () => {
    const result = dateRange('2026-12-28', '2027-01-03');

    // Four hyphens in a cross-year range, every one of them fenced on both sides.
    expect(result.match(/\u2060-\u2060/g)).toHaveLength(4);
    expect(result).not.toMatch(/(^|[^\u2060])-/);
    expect(result).not.toMatch(/-([^\u2060]|$)/);

    // Three space-separated parts: the start, the arrow, the end — the only break points.
    expect(result.split(' ')).toHaveLength(3);
  });
});

describe('shortDate', () => {
  /** Unchanged by the range work — the audit log and the ledger still read `DD-MM-YYYY`. */
  it('still writes a plain hyphenated date', () => {
    expect(shortDate('2026-09-04')).toBe('04-09-2026');
    expect(shortDate('2026-09-04T14:00:00.000Z')).toBe('04-09-2026');
  });

  it('reports a dash for nothing', () => {
    expect(shortDate(null)).toBe('—');
  });
});
