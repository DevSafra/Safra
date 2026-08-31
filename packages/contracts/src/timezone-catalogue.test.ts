import { describe, expect, it } from 'vitest';

import { TIMEZONE_CATALOGUE, isKnownTimezone, utcOffset } from './timezone-catalogue.js';

/**
 * The picker that replaced a text box for «المنطقة الزمنية» (Bashar, 2026-08-31).
 *
 * A zone is load-bearing: §5.3's same-day cutoff is 17:00 in the CITY's local time, so an entry
 * here that the runtime cannot resolve would create cities whose bookings close at the wrong hour.
 * The API refuses an unknown zone, which means a bad entry in this list is a menu option that can
 * only ever earn a refusal — the shape the currency catalogue is written to avoid.
 */
describe('TIMEZONE_CATALOGUE', () => {
  it('offers only zones the runtime can resolve', () => {
    for (const zone of TIMEZONE_CATALOGUE) {
      expect(isKnownTimezone(zone), zone).toBe(true);
    }
  });

  /* The opposite control: the check is capable of saying no. */
  it('rejects a zone that is not one', () => {
    expect(isKnownTimezone('Asia/Damascas')).toBe(false);
    expect(isKnownTimezone('Damascus')).toBe(false);
  });

  /** The three markets that exist. A list that lost one would strand every city in it. */
  it('covers every market the platform serves today', () => {
    expect(TIMEZONE_CATALOGUE).toContain('Asia/Damascus');
    expect(TIMEZONE_CATALOGUE).toContain('Asia/Amman');
    expect(TIMEZONE_CATALOGUE).toContain('Asia/Beirut');
  });

  it('lists each zone once', () => {
    expect(new Set(TIMEZONE_CATALOGUE).size).toBe(TIMEZONE_CATALOGUE.length);
  });
});

/**
 * The offset beside the name, which is the thing an operator is really choosing between.
 *
 * Asserted at a FIXED instant rather than now: an offset is a fact about a date, and a test that
 * read the clock would change its answer across a daylight-saving boundary — which is exactly the
 * property that makes writing offsets down as constants wrong.
 */
describe('utcOffset', () => {
  /* Mid-January: northern winter, so no zone here is on summer time. */
  const winter = new Date('2026-01-15T12:00:00Z');
  /* Mid-July: Beirut and Istanbul diverge from Damascus and Amman. */
  const summer = new Date('2026-07-15T12:00:00Z');

  it('writes an offset in the shape the picker shows', () => {
    expect(utcOffset('Asia/Damascus', winter)).toMatch(/^UTC[+-]\d{2}:\d{2}$/);
  });

  it('answers UTC+00:00 at zero rather than a bare GMT', () => {
    expect(utcOffset('Europe/London', winter)).toBe('UTC+00:00');
  });

  it('follows the season rather than a written-down constant', () => {
    expect(utcOffset('Europe/London', summer)).toBe('UTC+01:00');
    expect(utcOffset('Europe/London', winter)).toBe('UTC+00:00');
  });

  /**
   * The offset is what separates two names an operator cannot tell apart by eye.
   *
   * Deliberately NOT asserted between Damascus and Beirut: both sit at UTC+03:00 today — Syria
   * abolished daylight saving in 2022 and Lebanon's summer time lands on the same offset — so an
   * assertion that they differ would be asserting something false. Two zones that genuinely differ
   * are what proves the value carries information.
   */
  it('separates zones that are actually in different places', () => {
    expect(utcOffset('America/New_York', winter)).toBe('UTC-05:00');
    expect(utcOffset('Asia/Damascus', winter)).toBe('UTC+03:00');
    expect(utcOffset('Asia/Damascus', winter)).not.toBe(
      utcOffset('America/New_York', winter),
    );
  });
});
