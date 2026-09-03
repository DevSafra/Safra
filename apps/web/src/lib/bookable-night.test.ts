import { describe, expect, it } from 'vitest';

import { dayAfter, night, retryFrom } from './bookable-night.js';

/**
 * The night the customer site offers when §5.3 has closed the one the clock names.
 *
 * Every case here is a path a person reaches: the landing page's search form, its stay-type chips,
 * its attribute shortcuts and its «موصى به من سفرة» rail all take their night from this decision.
 * They took it from four separate expressions until 2026-09-02, and three of the four were wrong
 * after 17:00 Damascus.
 */
describe('retryFrom', () => {
  it('stands by an answer that found something', () => {
    expect(retryFrom({ items: [{}], notice: undefined })).toBeNull();
  });

  /**
   * The regression. Before the fix the caller kept today's date, and the form it fed offered a
   * night the API had just refused — «لا نتائج» for the whole evening.
   */
  it('moves to the date the API named when the night is closed', () => {
    const again = retryFrom({ items: [], notice: { firstBookableDate: '2026-09-03' } });

    expect(again).toStrictEqual({
      checkIn: '2026-09-03',
      checkOut: '2026-09-04',
      stay: '?checkIn=2026-09-03&checkOut=2026-09-04&adults=2',
    });
  });

  /**
   * An empty night is an ANSWER, not a refusal.
   *
   * Retrying it from a date nobody named would turn «nothing is free tonight» into a silent change
   * of subject — the visitor asked about tonight and would be shown tomorrow without being told.
   */
  it('leaves an empty night alone when the API named no other date', () => {
    expect(retryFrom({ items: [], notice: undefined })).toBeNull();
  });

  /** A search that failed for any other reason is not a closed night either. */
  it('does not redirect a search that simply failed', () => {
    expect(retryFrom({ items: [] })).toBeNull();
  });

  /**
   * A closed night that still returned rows keeps its rows.
   *
   * The notice and the items are independent: the API can name a first bookable date while the
   * cached read still carries stays from cities whose own cutoff has not passed. Throwing those
   * away would empty a section that had something to show.
   */
  it('keeps rows that came back alongside a notice', () => {
    expect(
      retryFrom({ items: [{}, {}], notice: { firstBookableDate: '2026-09-03' } }),
    ).toBeNull();
  });
});

describe('dayAfter', () => {
  it('crosses the end of a month', () => {
    expect(dayAfter('2026-09-30')).toBe('2026-10-01');
  });

  it('crosses the end of a year', () => {
    expect(dayAfter('2026-12-31')).toBe('2027-01-01');
  });

  /**
   * February in a leap year.
   *
   * `Date.UTC(2028, 1, 29)` is a real day and `Date.UTC(2027, 1, 29)` silently becomes 1 March —
   * which is the correct answer for the day after 28 February, and the reason this is built from
   * UTC parts rather than from a local `new Date(string)` that shifts by timezone.
   */
  it('handles a leap day', () => {
    expect(dayAfter('2028-02-28')).toBe('2028-02-29');
    expect(dayAfter('2028-02-29')).toBe('2028-03-01');
  });

  /** No timezone shift: the site speaks the API's calendar dates, not the runner's clock. */
  it('does not shift by the machine timezone', () => {
    expect(dayAfter('2026-09-02')).toBe('2026-09-03');
  });
});

describe('night', () => {
  it('builds the query a link appends', () => {
    expect(night('2026-09-03', '2026-09-05').stay) //
      .toBe('?checkIn=2026-09-03&checkOut=2026-09-05&adults=2');
  });
});
