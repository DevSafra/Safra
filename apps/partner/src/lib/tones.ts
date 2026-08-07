import type { Tone } from '@safra/ui';

/**
 * Tone classes for this app.
 *
 * The COLOUR comes from `statusTone` in `@safra/ui`, shared with the console and the customer
 * site, so a status is the same colour everywhere in the project — rule 1 of the standing status
 * rule. Only the pill's SHAPE is local.
 *
 * Lifted out of `properties/page.tsx`, where it was declared inline, once a second screen needed
 * it: two copies of a colour map is exactly how a status comes to be one colour on one screen and
 * another elsewhere.
 */
export const TONES: Record<Tone, string> = {
  ok: 'border-ok bg-ok/15 text-ok',
  teal: 'border-teal bg-teal/15 text-teal',
  lime: 'border-lime bg-lime/15 text-lime',
  sky: 'border-sky bg-sky/15 text-sky',
  indigo: 'border-indigo bg-indigo/15 text-indigo',
  pend: 'border-pend bg-pend/15 text-pend',
  gold: 'border-gold bg-gold/15 text-gold',
  warn: 'border-warn bg-warn/15 text-warn',
  orange: 'border-orange bg-orange/15 text-orange',
  bad: 'border-bad bg-bad/15 text-bad',
  crimson: 'border-crimson bg-crimson/15 text-crimson',
  faint: 'border-line bg-field text-faint',
  slate: 'border-slate bg-slate/15 text-slate',
  stone: 'border-stone bg-stone/15 text-stone',
};
