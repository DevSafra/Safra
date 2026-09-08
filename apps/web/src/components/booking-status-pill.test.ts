import { describe, expect, it } from 'vitest';

import { customerBookingStatus } from './booking-status-pill';

/**
 * The collapse from eight operational statuses to the four a customer reads.
 *
 * Asserted value by value rather than "returns one of four", because the interesting failures are
 * not shape failures — they are a booking that stands being shown as ملغى, one that never completed
 * being shown as مؤكد, or one that is UNPAID being shown as though somebody else were deciding.
 * Each would be this function quietly telling somebody something untrue about their own trip.
 *
 * ## Why four, when Bashar said three
 *
 * «حجوزاتي shows ملغى, قيد التأكيد and مؤكد, and nothing else» (2026-08-18) was correct while every
 * payment was a card: a card settles inside the checkout session, so `pending_payment` lasted
 * seconds and «قيد التأكيد» was true a moment later.
 *
 * `manual_transfer` is now the only rail checkout can offer, so an unpaid booking is a state that
 * LASTS and that the customer must act on — and «قيد التأكيد» says the opposite, that somebody else
 * is deciding. Read on BKG-2026-450171 on 2026-09-08: «قيد التأكيد», «الإجمالي المدفوع $196.99» and
 * a partner-response deadline, on a booking the partner could not see, for which no money had
 * arrived, and which the EC-001 sweep was about to cancel. The word «بانتظار الدفع» was already in
 * the catalogue and nothing reached it.
 */
describe('customerBookingStatus', () => {
  it.each([
    ['draft', 'pending_confirmation'],
    ['pending_confirmation', 'pending_confirmation'],
  ])('shows %s as awaiting confirmation', (status, expected) => {
    expect(customerBookingStatus(status)).toBe(expected);
  });

  /*
    The state the CUSTOMER must act on keeps its own word.

    Not folded in above: «قيد التأكيد» means «somebody else is deciding», and an unpaid booking is
    waiting on the reader. Asserted as `not.toBe` as well, because the defect this replaces was a
    collapse — a future tidy-up that folds it back would otherwise pass.
  */
  it('shows an unpaid booking as awaiting PAYMENT, not awaiting a partner', () => {
    expect(customerBookingStatus('pending_payment')).toBe('pending_payment');
    expect(customerBookingStatus('pending_payment')).not.toBe('pending_confirmation');
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

  /* Whatever it returns must be a key the catalogue can label — the four, and only the four. */
  it('returns only the four states the customer vocabulary carries', () => {
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
      new Set(['pending_payment', 'pending_confirmation', 'confirmed', 'cancelled']),
    );
  });
});
