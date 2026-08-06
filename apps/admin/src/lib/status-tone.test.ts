import { describe, expect, it } from 'vitest';

import { bookingStatusTone } from './status-tone';

/**
 * The handoff's colour vocabulary for a booking status.
 *
 * Pinned exhaustively because the two screens that draw a status agreed on nothing until
 * 2026-08-05 — the detail screen kept its own three-branch version, which is how `checked_in`
 * came out green, `completed` came out green, and everything it did not recognise came out gold.
 * The browser test proves both screens now call THIS function; these prove the function is right.
 *
 * `pending_confirmation` is the one worth defending. Purple is an explicit rule (§1, §14): a paid
 * booking waiting on a partner is not good news, and gold reads as if it were.
 */
describe('bookingStatusTone', () => {
  it.each([
    ['confirmed', 'ok'],
    ['checked_in', 'sky'],
    ['pending_confirmation', 'pend'],
    ['pending_payment', 'warn'],
    ['cancelled', 'bad'],
    ['disputed', 'bad'],
    ['completed', 'faint'],
    ['draft', 'faint'],
  ])('paints %s as %s', (status, tone) => {
    expect(bookingStatusTone(status)).toBe(tone);
  });

  /**
   * An unknown status is faint, never gold.
   *
   * A status added to the enum and not to this map must not arrive wearing a colour that claims
   * the operator needs to act on it. Faint says "no signal", which is the truth.
   */
  it('gives a status it has never seen no signal at all', () => {
    expect(bookingStatusTone('some_future_status')).toBe('faint');
  });
});
