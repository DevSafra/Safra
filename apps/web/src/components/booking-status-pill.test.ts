import { describe, expect, it } from 'vitest';

import { customerBookingStatus } from './booking-status-pill';

/**
 * The collapse from eight operational statuses to the three a customer reads.
 *
 * Asserted value by value rather than "returns one of three", because the interesting failures are
 * not shape failures — they are a booking that stands being shown as ملغى, or one that never
 * completed being shown as مؤكد. Both would be this function quietly telling somebody something
 * untrue about their own trip.
 */
describe('customerBookingStatus', () => {
  it.each([
    ['draft', 'pending_confirmation'],
    ['pending_payment', 'pending_confirmation'],
    ['pending_confirmation', 'pending_confirmation'],
  ])('shows %s as awaiting confirmation', (status, expected) => {
    expect(customerBookingStatus(status)).toBe(expected);
  });

  it.each([
    ['confirmed', 'confirmed'],
    ['checked_in', 'confirmed'],
    ['completed', 'confirmed'],
  ])('shows %s as confirmed', (status, expected) => {
    expect(customerBookingStatus(status)).toBe(expected);
  });

  /* A dispute is a complaint about a stay, not a cancellation of it (Bashar, 2026-08-18). */
  it('shows a disputed booking as confirmed, never as cancelled', () => {
    expect(customerBookingStatus('disputed')).toBe('confirmed');
    expect(customerBookingStatus('disputed')).not.toBe('cancelled');
  });

  it('shows a cancelled booking as cancelled', () => {
    expect(customerBookingStatus('cancelled')).toBe('cancelled');
  });

  /**
   * A ninth enum value must not arrive claiming the booking is confirmed.
   *
   * This is the assertion that survives somebody else's change: adding to `booking_status` without
   * touching this map is the likely future mistake, and the failure mode worth forbidding is the
   * optimistic one.
   */
  it('never invents a confirmation for a status it does not know', () => {
    for (const unknown of ['refunded', 'no_show', '', 'CONFIRMED']) {
      expect(customerBookingStatus(unknown), unknown).toBe('pending_confirmation');
    }
  });

  /* Whatever it returns must be a key the catalogue can label — the three, and only the three. */
  it('returns only the three states the customer vocabulary carries', () => {
    const every = [
      'draft',
      'pending_payment',
      'pending_confirmation',
      'confirmed',
      'cancelled',
      'checked_in',
      'completed',
      'disputed',
    ];

    expect(new Set(every.map(customerBookingStatus))).toStrictEqual(
      new Set(['pending_confirmation', 'confirmed', 'cancelled']),
    );
  });
});
