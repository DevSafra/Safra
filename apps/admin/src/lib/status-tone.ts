import type { Tone } from '@/components/admin-table';

/**
 * A booking status's colour, in one place because two screens draw it.
 *
 * ## Why this is not a local `statusTone` like every other section's
 *
 * Every registry defines its own — properties, payments, ads, disputes, gift cards, comms — and
 * that is right while a status is drawn in exactly one table. Bookings is the exception: the
 * الحجوزات registry and the booking DETAIL screen both show one, and they had drifted (Bashar,
 * 2026-08-05). The detail screen's own copy called `checked_in` green where the table calls it
 * sky, `completed` green where the table calls it faint, and coloured everything it did not
 * recognise GOLD — so a booking waiting on the customer was amber in the table and gold one click
 * later, and a booking waiting on the PARTNER lost the purple that §14 makes an explicit rule.
 *
 * Sharing the function is the fix, not copying the switch: a copy is what drifted.
 *
 * ## The vocabulary, from the handoff
 *
 * `pending_confirmation` is `--pend` purple — an explicit rule (§1, §14) — because a paid booking
 * still waiting on a partner is not good news and gold would read as if it were. `pending_payment`
 * is amber: there the platform is waiting on the CUSTOMER, which is a different situation calling
 * for a different action.
 */
export function bookingStatusTone(status: string): Tone {
  switch (status) {
    case 'confirmed':
      return 'ok';
    case 'checked_in':
      return 'sky';
    case 'pending_confirmation':
      return 'pend';
    case 'pending_payment':
      return 'warn';
    case 'cancelled':
    case 'disputed':
      return 'bad';
    default:
      // `completed` and `draft` — done or not started; neither needs attention.
      return 'faint';
  }
}
