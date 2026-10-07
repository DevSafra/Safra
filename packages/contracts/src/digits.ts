import { z } from 'zod';

/**
 * Arabic-Indic and Persian digits as ASCII, and the Arabic decimal mark as a point.
 *
 * The console is Arabic and its keyboard types «٢٠» and «٤٥٠٫٥». Every numeric field a person types
 * into goes through this before it is checked, because `Number('٢٠')` is NaN and a regex `\d`
 * without the u flag matches ASCII only (audit 2026-10-04): seats typed in Arabic were saved as «no
 * limit», an FAQ position as 0, and a trip's price and dates were refused with an error naming no
 * field.
 *
 * Length-preserving on purpose: one character in, one character out, so `typedDigits` can put the
 * caret back exactly where it was.
 */
export function westernDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, '.');
}

/**
 * The slice of an `<input>` that `typedDigits` touches, so this package needs no DOM types.
 */
export interface TypedField {
  value: string;
  readonly selectionStart: number | null;
  readonly selectionEnd: number | null;
  setSelectionRange(start: number, end: number): void;
}

/**
 * Rewrites a numeric field's own value to ASCII digits as it is typed, and returns it.
 *
 * Called from `onChange`, before the value reaches state, a regex or `FormData` (audit 2026-10-06).
 * Converting only where the value is READ left a dozen controls that each had to remember to do it,
 * and the ones that forgot stayed dark with nothing on screen saying why: a gift card amount, a
 * coupon value, a fine, a six-digit code. Converting the FIELD means the native `pattern`, the
 * button's arming check and the request body all see the same digits, and the reader sees them in
 * the Western form every other figure in both apps is printed in.
 *
 * The caret is restored because the DOM value is replaced underneath the reader: without it,
 * correcting a digit in the middle of «١٢٥٠» would throw the caret to the end. Fields that have no
 * selection API (`type="number"`, `email`) report `null` and are left alone.
 */
export function typedDigits(field: TypedField): string {
  const normalised = westernDigits(field.value);

  if (normalised === field.value) return normalised;

  const { selectionStart, selectionEnd } = field;

  field.value = normalised;

  if (selectionStart !== null && selectionEnd !== null) {
    field.setSelectionRange(selectionStart, selectionEnd);
  }

  return normalised;
}

/**
 * A string schema that reads Arabic-Indic and Persian digits as ASCII before `inner` checks it.
 *
 * The server half of `typedDigits`. A form normalises as the reader types, but the endpoint is the
 * control: a replayed request, another client or a script must not be refused «٢٠٠» that the
 * console would have accepted as «200».
 */
export function digitString<T extends z.ZodType<unknown, string>>(inner: T) {
  return z.string().transform(westernDigits).pipe(inner);
}
