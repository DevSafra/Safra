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
