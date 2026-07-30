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
    // SAFRA confirms to the customer once the partner approves — §6.3 step 7 puts
    // SAFRA in the middle, so staff and system can both finalise it.
    actors: ['staff', 'system'],
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
