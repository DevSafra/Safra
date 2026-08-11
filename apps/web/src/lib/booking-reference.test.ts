import { describe, expect, it } from 'vitest';

import { isBookingReference } from './booking-reference';

/**
 * The shape check behind `/booking/[reference]`.
 *
 * The page echoes the reference onto a genuine SAFRA page without looking anything up, so this predicate
 * is the only thing standing between a crafted URL and an official-looking sentence under the real
 * branding. The phishing strings below are the ones that motivated it.
 */
describe('isBookingReference', () => {
  it.each([
    ['a production reference', 'BKG-2026-000123'],
    ['the last of a year', 'BKG-2026-999999'],
    ['a fixture reference', 'BKG-TEST-180ebd2c'],
    ['a fixture with six', 'BKG-TEST-1a2b3c'],
  ])('accepts %s', (_label, reference) => {
    expect(isBookingReference(reference)).toBe(true);
  });

  /**
   * Prose is the whole point.
   *
   * Each of these rendered as «Booking reference …» on a real page before the check existed.
   */
  it.each([
    'ACCOUNT-SUSPENDED-CALL-1-555-0100',
    'CALL-US-NOW',
    'YOUR-BOOKING-IS-CANCELLED',
    'PAY-AGAIN-AT-safra-secure.example',
  ])('refuses the phishing string %j', (reference) => {
    expect(isBookingReference(reference)).toBe(false);
  });

  it.each([
    ['empty', ''],
    ['a path traversal', '../../etc/passwd'],
    ['a tag', '<script>alert(1)</script>'],
    ['a url', 'https://evil.example'],
    ['the prefix alone', 'BKG-'],
    ['a wrong prefix', 'PAY-2026-000123'],
    ['no groups', 'BKG2026000123'],
    ['a lower-case prefix', 'bkg-2026-000123'],
    ['too long a tail', 'BKG-2026-0001234567'],
    ['too short a tail', 'BKG-2026-00012'],
    ['a trailing space', 'BKG-2026-000123 '],
    ['an embedded newline', 'BKG-2026-000123\nBKG-2026-000124'],
  ])('refuses %s', (_label, reference) => {
    expect(isBookingReference(reference)).toBe(false);
  });

  /* Anchored at both ends, or a valid reference could carry a payload after it. */
  it('is anchored, so a valid prefix does not admit a suffix', () => {
    expect(isBookingReference('BKG-2026-000123-CALL-US')).toBe(false);
    expect(isBookingReference('PLEASE-BKG-2026-000123')).toBe(false);
  });

  /* Length is bounded, so a megabyte of text is refused without a scan. */
  it('refuses an absurdly long string', () => {
    expect(isBookingReference(`BKG-2026-${'0'.repeat(5_000)}`)).toBe(false);
  });
});
