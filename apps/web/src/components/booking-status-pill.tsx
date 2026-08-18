import { statusTone, type Tone } from '@safra/ui';

/**
 * A booking status as a coloured pill.
 *
 * Colour is never the only signal — the label carries the meaning — so the palette is reinforcement
 * for sighted users rather than the information itself (§14.1).
 *
 * The tone classes: the console draws its pills as a coloured outline on no fill; this app keeps its
 * softer tinted style, because the two are different products read by different people.
 *
 * What they share is the COLOUR — `statusTone` decides that for both, so a booking a customer sees as
 * cancelled is the same red an operator sees. It used to be `faint` here and `bad` there, which meant
 * a support call started with the two of them looking at differently-coloured versions of one
 * booking (Bashar, 2026-08-06).
 *
 * Extracted from the account page when that page became the eight sections of handoff §6: the
 * overview and حجوزاتي both draw it, and two copies of a status palette is the exact thing the
 * one-status-one-colour rule exists to prevent.
 */
const TONES: Record<Tone, string> = {
  ok: 'border-ok/40 bg-ok/10 text-ok',
  teal: 'border-teal/40 bg-teal/10 text-teal',
  lime: 'border-lime/40 bg-lime/10 text-lime',
  sky: 'border-sky/40 bg-sky/10 text-sky',
  indigo: 'border-indigo/40 bg-indigo/10 text-indigo',
  pend: 'border-pend/40 bg-pend/10 text-pend',
  gold: 'border-gold/40 bg-gold/10 text-gold',
  warn: 'border-warn/40 bg-warn/10 text-warn',
  orange: 'border-orange/40 bg-orange/10 text-orange',
  bad: 'border-bad/40 bg-bad/10 text-bad',
  crimson: 'border-crimson/40 bg-crimson/10 text-crimson',
  faint: 'border-line bg-field text-faint',
  slate: 'border-slate/40 bg-slate/10 text-slate',
  stone: 'border-stone/40 bg-stone/10 text-stone',
};

/**
 * The three states a CUSTOMER is shown, from the eight the database keeps.
 *
 * Bashar, 2026-08-18: حجوزاتي shows ملغى, قيد التأكيد and مؤكد, and nothing else. The eight-value
 * enum is an operational vocabulary — `checked_in` and `disputed` are things SAFRA and the partner
 * act on — and a customer looking at their own trip needs one question answered: is it on.
 *
 * ## Why this lives beside the pill rather than in each page
 *
 * The overview and حجوزاتي draw the same booking in the same row. Two collapses written separately
 * drift, and the drift is silent: one screen says «مكتمل» and the other «مؤكد» about one booking,
 * which is the fault the one-status-one-word rule exists to prevent. One function, both callers.
 *
 * ## It decides the COLOUR as well as the word
 *
 * The caller passes the mapped value to `StatusPill`, so `statusTone` colours what is actually
 * written. Collapsing only the label would leave «مؤكد» green on a `confirmed` booking and teal on
 * a `completed` one — one word in two colours, which reads as a rendering fault (§ status rule).
 *
 * ## `disputed` is مؤكد, deliberately
 *
 * A dispute is a complaint about a stay, not a change to whether the booking stands. It is visible
 * on the booking itself and under النزاعات; showing it here as ملغى would tell somebody their
 * booking was cancelled when it was not, on the screen about their own money.
 */
const CUSTOMER_STATES: Readonly<Record<string, string>> = {
  cancelled: 'cancelled',

  draft: 'pending_confirmation',
  pending_payment: 'pending_confirmation',
  pending_confirmation: 'pending_confirmation',

  confirmed: 'confirmed',
  checked_in: 'confirmed',
  completed: 'confirmed',
  disputed: 'confirmed',
};

export function customerBookingStatus(status: string): string {
  /*
    An unmapped status reads as «قيد التأكيد», not «مؤكد».

    A ninth value added to the enum and not to this map must not tell a customer their booking is
    confirmed — that is a claim about their trip we would be making without knowing. "Not settled
    yet" is the honest fallback, and it is the same instinct as `statusTone`'s `faint`.
  */
  return CUSTOMER_STATES[status] ?? 'pending_confirmation';
}

export function StatusPill({
  status,
  label,
}: {
  readonly status: string;
  readonly label: string;
}) {
  return (
    <span
      data-status-pill
      className={`rounded-full border px-2.5 py-0.5 text-xs ${TONES[statusTone(status)]}`}
    >
      {label}
    </span>
  );
}
