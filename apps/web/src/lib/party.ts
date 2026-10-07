/**
 * The party a checkout URL describes, held to what the booking contract allows.
 *
 * ## Why the checkout cannot take `?adults=` as written (audit 2026-10-06)
 *
 * It read `Number(adults)` and nothing else, so a hand-edited or tampered link carried `0`, `-3`,
 * `abc` (NaN) or `40` straight into the summary («NaN ضيوف») and into the booking request. The API
 * refuses every one of them, which is the control that matters, but only AFTER the guest has typed
 * their name, phone and card details: the screen took everything and could never complete.
 *
 * ## Bounded, never trimmed to fit
 *
 * A typed or tampered value is brought inside the contract's ceilings (`bookingCreateSchema`: 30
 * adults, 20 children, 10 infants) and an unreadable one falls back. A party larger than the rooms
 * sleep is NOT trimmed: an earlier version held it to the beds and silently dropped children, so a
 * booking for two was made for four people. Over capacity, the API refuses and says why.
 */
export interface Party {
  readonly adults: number;
  readonly children: number;
  readonly infants: number;
}

const CEILING = { adults: 30, children: 20, infants: 10 } as const;

/** A whole number inside `[0, max]`, or the fallback for anything that is not a finite number. */
function whole(raw: string | undefined, fallback: number, max: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;

  const value = Number(raw);

  if (!Number.isFinite(value)) return fallback;

  return Math.min(Math.max(Math.trunc(value), 0), max);
}

/** The party as the URL states it, bounded by the contract alone. At least one adult. */
export function partyFromQuery(raw: {
  readonly adults: string | undefined;
  readonly children: string | undefined;
  readonly infants: string | undefined;
}): Party {
  return {
    adults: Math.max(1, whole(raw.adults, 2, CEILING.adults)),
    children: whole(raw.children, 0, CEILING.children),
    infants: whole(raw.infants, 0, CEILING.infants),
  };
}
