import { afterEach, describe, expect, it, vi } from 'vitest';

import { amount, count, marketToday } from './format';

/**
 * `marketToday` — today where the BUSINESS is, not where UTC is.
 *
 * The bug it replaced was `new Date().toISOString().slice(0, 10)` on three screens. Damascus is UTC+3,
 * so from 21:00 UTC the calendar ringed the wrong square as "today" and left the real yesterday
 * undimmed — and at 21:30 on the 31st, تقويم الإتاحة and التقويمات opened on the month that had just
 * ended.
 *
 * Time is frozen rather than compared against the clock: a test that asserted "the answer equals what
 * I compute the same way" would pass against the bug it is here to catch.
 */
describe('marketToday', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function at(instant: string): string {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(instant));

    return marketToday();
  }

  it('agrees with UTC during the day', () => {
    expect(at('2026-08-10T09:00:00Z')).toBe('2026-08-10');
  });

  it('is still the same day one minute before the offset carries it over', () => {
    expect(at('2026-08-10T20:59:00Z')).toBe('2026-08-10');
  });

  /* THE regression: 21:00 UTC is already tomorrow in Damascus. */
  it('has moved to tomorrow at 21:00 UTC, where the old code had not', () => {
    const instant = '2026-08-10T21:00:00Z';

    expect(at(instant)).toBe('2026-08-11');
    expect(at(instant)).not.toBe(new Date(instant).toISOString().slice(0, 10));
  });

  /* And the worse case: the month rolls over three hours before UTC does. */
  it('rolls into the next MONTH before UTC does', () => {
    expect(at('2026-08-31T21:30:00Z')).toBe('2026-09-01');
    expect(at('2026-08-31T21:30:00Z').slice(0, 7)).toBe('2026-09');
  });

  it('rolls into the next YEAR before UTC does', () => {
    expect(at('2026-12-31T21:30:00Z')).toBe('2027-01-01');
  });

  it('always answers a plain YYYY-MM-DD', () => {
    for (const instant of [
      '2026-01-01T00:00:00Z',
      '2026-06-15T12:34:56Z',
      '2026-02-28T21:00:00Z',
    ]) {
      expect(at(instant)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  /* A leap day is a real date in 2028, and the helper must not invent 2028-02-30. */
  it('handles a leap day', () => {
    expect(at('2028-02-28T21:30:00Z')).toBe('2028-02-29');
  });
});

/**
 * `count` — grouped, in Western digits.
 *
 * Worth pinning because the grouping is exactly why the calendars page does NOT use it for a YEAR:
 * `count(2026)` renders "2,026".
 */
describe('count', () => {
  it('groups thousands, which is why a year must not go through it', () => {
    expect(count(2026)).toMatch(/2.026/);
    expect(count(2026)).not.toBe('2026');
  });

  it('leaves a small number alone', () => {
    expect(count(31)).toBe('31');
    expect(count(0)).toBe('0');
  });
});

/**
 * `amount` — an absent figure is a dash, never a zero.
 *
 * "Null is not zero" is a rule this codebase enforces because a fabricated financial figure is more
 * damaging than an absent one.
 */
describe('amount', () => {
  it.each<string | null | undefined>([null, undefined, 'not-a-number', ''])(
    'renders %j as a dash',
    (value) => {
      expect(amount(value, 'USD')).toBe('—');
    },
  );

  it('renders a real amount with its symbol', () => {
    expect(amount('65.00', 'USD')).toContain('65.00');
    expect(amount('65.00', 'USD')).toContain('$');
  });

  /* SYP puts its Arabic symbol AFTER the number; a Latin symbol goes in front. */
  it('places the SYP symbol after the number and a Latin one before it', () => {
    expect(amount('100.00', 'SYP').trimEnd().endsWith('ل.س')).toBe(true);
    expect(amount('100.00', 'USD').startsWith('$')).toBe(true);
  });

  /**
   * A currency the console can ADD renders as money, not as its code.
   *
   * The symbols were a private five-entry copy of the console's table, so anything المدن could
   * add — dirhams, riyals, lira — fell through to «100.00 AED». The rule is about the symbol's
   * SCRIPT, so an Arabic one trails even though no list here has ever named AED.
   */
  it('writes a currency added after this file was, and puts its symbol correctly', () => {
    expect(amount('100.00', 'AED').trimEnd().endsWith('د.إ')).toBe(true);
    expect(amount('100.00', 'AED')).not.toContain('AED');

    expect(amount('100.00', 'GBP').startsWith('£')).toBe(true);
  });

  /**
   * The currency's own scale, not two.
   *
   * Hard-coded here, so `10.125 JOD` rendered `10.13` — a partner reconciling a payout against a
   * bank statement reading a third decimal the platform had rounded away.
   */
  it('keeps the third decimal of a three-decimal currency', () => {
    expect(amount('10.125', 'JOD')).toContain('10.125');
    expect(amount('10.125', 'IQD')).toContain('10.125');

    /* And still writes exactly two for a two-decimal one, rather than whatever it was given. */
    expect(amount('10.1', 'USD')).toContain('10.10');
  });

  it('does not round a zero away', () => {
    expect(amount('0.00', 'USD')).toContain('0.00');
  });
});
