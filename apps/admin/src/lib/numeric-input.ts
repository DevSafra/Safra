import { westernDigits } from '@safra/contracts';

/**
 * A whole number as an operator TYPED it, in either digit set (audit 2026-10-04).
 *
 * `Number('٢٠')` is NaN, and NaN serialises to `null` in JSON, so seats typed on an Arabic keyboard
 * were saved as «no limit» and a position as 0, with no error. Empty is `null` (the field's own
 * «not set»); digits in either set are the number; anything else goes to the API AS TYPED, where
 * the schema refuses it and the form shows the refusal. Never a silent guess.
 */
export function wholeNumber(text: string): number | string | null {
  const value = westernDigits(text).trim();

  if (value === '') return null;

  return /^[0-9]+$/.test(value) ? Number(value) : text;
}
