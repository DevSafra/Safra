/**
 * The booking state machine (SRS §6.2).
 *
 * Transitions are declared as data rather than scattered across `if` statements, so
 * an illegal move is impossible to write by accident and the whole lifecycle is
 * readable in one place. §6.2 lists the states; this adds which moves between them
 * are legal and who may make them.
 */
export type BookingStatus =
  | 'draft'
  | 'pending_payment'
  | 'pending_confirmation'
  | 'confirmed'
  | 'cancelled'
  | 'checked_in'
  | 'completed'
  | 'disputed';

/** Who is permitted to drive a given transition (§6.2's "who changes it" column). */
export type Actor = 'system' | 'customer' | 'partner' | 'staff';

export interface Transition {
  from: BookingStatus;
  to: BookingStatus;
  actors: Actor[];
  /** Short description, used in timeline events and error messages. */
  label: string;
}

export const TRANSITIONS: Transition[] = [
  // ── Creation and payment ────────────────────────────────────────────────────
  {
    from: 'draft',
    to: 'pending_payment',
    actors: ['customer', 'system'],
    label: 'payment_started',
  },
  {
    from: 'pending_payment',
    to: 'pending_confirmation',
    actors: ['system'],
    label: 'payment_captured',
  },
  /**
   * EC-001: the customer closed the page mid-payment. The booking expires rather
   * than holding inventory indefinitely — the SLA sweep drives this.
   */
  {
    from: 'pending_payment',
    to: 'cancelled',
    actors: ['system', 'customer'],
    label: 'payment_expired',
  },
  { from: 'draft', to: 'cancelled', actors: ['customer', 'system'], label: 'abandoned' },

  // ── Partner confirmation window (§6.4) ─────────────────────────────────────
  {
    from: 'pending_confirmation',
    to: 'confirmed',
    /*
      The PARTNER is the actor this window exists for (§6.4, §8.3).

      This listed only `staff` and `system`, on the reading that «SAFRA confirms to the customer
      once the partner approves» — but that sentence is about who tells the CUSTOMER, not about who
      may move the booking. `partnerDecision` has always asserted this transition with the actor
      `'partner'`, so the two halves contradicted each other from the commit that introduced them,
      and every partner acceptance answered **409 booking.transition_invalid**.

      What that cost: the portal renders «قبول» on a two-hour clock, the press failed silently, the
      SLA sweep then expired the booking, cancelled it, refunded and compensated the customer — and
      raised a violation and a $10 fine against the partner, for not answering a request they had
      answered. Rejection was unaffected, because `cancelled` always listed `partner`.

      Found on 2026-09-04 by pressing the button. Nothing caught it: `booking-state.test.ts`
      asserts the customer cannot confirm, that a partner can cancel, and that a partner cannot
      confirm from `pending_payment` — three neighbours of the one case that matters.
    */
    actors: ['partner', 'staff', 'system'],
    label: 'confirmed',
  },
  {
    from: 'pending_confirmation',
    to: 'cancelled',
    // Partner rejection, SLA expiry, or a staff decision all land here.
    actors: ['partner', 'staff', 'system'],
    label: 'cancelled_before_confirmation',
  },

  // ── Stay lifecycle ─────────────────────────────────────────────────────────
  {
    from: 'confirmed',
    to: 'checked_in',
    actors: ['partner', 'staff'],
    label: 'checked_in',
  },
  /**
   * Undoing a check-in, which the platform has always DONE and this table never named.
   *
   * `ArrivalsService.undoCheckIn` has performed this move since the arrivals screen was built —
   * with a direct `UPDATE` carrying `status = 'checked_in'` in its predicate and no consultation
   * of this table at all. So the table has been incomplete rather than restrictive, and reading it
   * to answer "what may staff do from here" gave an answer the platform's own behaviour
   * contradicted. Added 2026-08-25 when the console started deriving its controls from here.
   *
   * A desk clerk checking in the wrong room is the most ordinary mistake the screen produces, and
   * the reverse move stops at `confirmed`: `completed` and `disputed` are states other parts of
   * the platform have acted on, and reversing those is not a front-desk decision.
   */
  {
    from: 'checked_in',
    to: 'confirmed',
    actors: ['partner', 'staff'],
    label: 'check_in_undone',
  },
  {
    from: 'confirmed',
    to: 'cancelled',
    actors: ['customer', 'staff'],
    label: 'cancelled_after_confirmation',
  },
  {
    from: 'checked_in',
    to: 'completed',
    actors: ['system', 'staff'],
    label: 'completed',
  },

  // ── Disputes (§13.1) ───────────────────────────────────────────────────────
  { from: 'confirmed', to: 'disputed', actors: ['customer', 'staff'], label: 'disputed' },
  {
    from: 'checked_in',
    to: 'disputed',
    actors: ['customer', 'staff'],
    label: 'disputed',
  },
  { from: 'completed', to: 'disputed', actors: ['customer', 'staff'], label: 'disputed' },
  { from: 'disputed', to: 'completed', actors: ['staff'], label: 'dispute_resolved' },
  { from: 'disputed', to: 'cancelled', actors: ['staff'], label: 'dispute_cancelled' },
  /**
   * Back to where the booking WAS when the dispute opened — added 2026-08-25.
   *
   * §6.2 defines `Disputed` as «يوجد نزاع مفتوح على الحجز» — a booking that HAS an open dispute.
   * That makes it an overlay on the lifecycle rather than a destination in it: when the dispute
   * closes the overlay lifts, and the booking is wherever it actually was. Without these two edges
   * the only ways out were `completed` and `cancelled`, so a dispute raised on a stay that had not
   * happened yet could only be closed by declaring it finished or killing it.
   *
   * The pre-dispute state is DERIVED from the booking's own stamps rather than remembered in a
   * column — see `DisputeService.restoreBookingStatus`. A column would be a second thing to keep
   * true; `checked_in_at` and `confirmed_at` already say where it was.
   */
  { from: 'disputed', to: 'checked_in', actors: ['staff'], label: 'dispute_closed' },
  { from: 'disputed', to: 'confirmed', actors: ['staff'], label: 'dispute_closed' },
];

/**
 * The statuses that hold inventory.
 *
 * Must match the WHERE clause of the exclusion constraint exactly. If these two ever
 * disagree, either the database rejects a legitimate booking or it permits a double
 * booking — so they sit side by side and an invariant test parses the migration to
 * confirm they match.
 *
 * `pending_payment` IS included, and that is the important entry. §6.2 defines no
 * "reserved" state, so the payment window is the hold: without it two customers can
 * both start paying for the last room, both be charged, and only the second discover
 * at capture time that the dates are gone. Holding from insert moves the rejection
 * to BEFORE any money moves, which is the only acceptable place for it. EC-001's
 * 30-minute expiry is what stops an abandoned checkout holding dates forever.
 */
export const BLOCKING_STATUSES: BookingStatus[] = [
  'pending_payment',
  'pending_confirmation',
  'confirmed',
  'checked_in',
  /**
   * `disputed` HOLDS INVENTORY, and leaving it out would have been a double booking.
   *
   * Added 2026-08-25, with the status itself, and this is the implication that decided the design.
   * Until then nothing could write `disputed`, so its absence here cost nothing. The moment a
   * dispute moves a live booking out of `confirmed` or `checked_in`, those two statuses stop
   * applying — and a status outside this list does not hold its dates. A guest disputing the room
   * they are standing in (EC-006, EC-007) would have had their nights released for sale while they
   * were still in it.
   *
   * Blocking a DEPARTED stay's dates costs nothing: they are in the past and nobody books
   * backwards. Blocking a live one is the entire point.
   */
  'disputed',
];

/** Terminal states: nothing leaves them except a dispute, which is handled above. */
export const TERMINAL_STATUSES: BookingStatus[] = ['cancelled'];

export function canTransition(
  from: BookingStatus,
  to: BookingStatus,
  actor: Actor,
): boolean {
  return TRANSITIONS.some(
    (t) => t.from === from && t.to === to && t.actors.includes(actor),
  );
}

export function transitionLabel(from: BookingStatus, to: BookingStatus): string | null {
  return TRANSITIONS.find((t) => t.from === from && t.to === to)?.label ?? null;
}

/** The moves available from a state, for building a UI or an error message. */
export function allowedTransitions(from: BookingStatus, actor: Actor): BookingStatus[] {
  return TRANSITIONS.filter((t) => t.from === from && t.actors.includes(actor)).map(
    (t) => t.to,
  );
}
