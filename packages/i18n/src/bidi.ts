/**
 * Putting a Latin or numeric run inside an Arabic sentence.
 *
 * ## Why it lives in the shared package
 *
 * It was `apps/web/src/lib/bidi.ts` until الإعدادات needed it: «120 دقيقة» composed as one string
 * and dropped into an RTL line renders as «دقيقة 120», which is the same failure as the reversed
 * date below wearing a different unit. Same move, same reasoning as `ARABIC_WESTERN_DIGITS` in
 * `locales.ts` — a second copy of a bidirectional rule in a second app is a second thing to keep
 * in step, and the failure is invisible to every string assertion in both.
 *
 * `apps/web/src/lib/bidi.ts` re-exports it, so the customer app's call sites are unchanged.
 *
 * ## The bug this fixes
 *
 * `«دفع في {date}»` with `date = '2026-08-08'` rendered as **«دفع في 08-08-2026»** — the date read
 * backwards. Found by generating the receipt PDF and looking at it (2026-08-11).
 *
 * Nothing is wrong with the string. The Unicode bidirectional algorithm resolves the paragraph as
 * right-to-left, and an ISO date is not one atom to it: `2026`, `08` and `08` are separate numeric runs
 * joined by hyphens, which are NEUTRAL. Neutral characters take the direction of their surroundings, so
 * in an RTL paragraph the three runs are laid out right to left — and the date is reversed while every
 * individual number is still correct. That is why it survives every string assertion: `slice(0, 10)` is
 * `'2026-08-08'` in the DOM, and the browser draws it the other way round.
 *
 * It is the same failure as the date-range arrow (`lib/arrows.ts`): a value whose meaning depends on
 * order, dropped into a paragraph that orders things the other way.
 *
 * ## Why an isolate and not `dir="ltr"`
 *
 * `dir="ltr"` works, and it is what the receipt's standalone date cells use — but it needs an ELEMENT,
 * and this value is interpolated into the middle of a sentence by `t('invoicePaidOn', { date })`, which
 * returns a plain string. Reaching for `t.rich` to wrap one placeholder in a `<span>` means the
 * translator now has markup in their catalogue entry, which is exactly what `{placeholder}` templates
 * exist to avoid.
 *
 * `U+2066 LEFT-TO-RIGHT ISOLATE` … `U+2069 POP DIRECTIONAL ISOLATE` does the same job in the string
 * itself: the run inside is laid out left to right, and — the important half — it is ISOLATED, so it
 * cannot affect how the Arabic around it is ordered either. An `LRM` mark or an `LRE` embedding would
 * influence the surrounding text; an isolate is the character pair designed for precisely this case.
 */

/** `U+2066 LEFT-TO-RIGHT ISOLATE`. */
const LRI = '⁦';

/** `U+2069 POP DIRECTIONAL ISOLATE`. */
const PDI = '⁩';

/**
 * Wraps a value so it keeps its own left-to-right order inside a sentence of any direction.
 *
 * For dates, references, amounts, phone numbers and anything else whose ORDER carries meaning. Use it
 * on the value passed to a catalogue placeholder — never on the sentence itself, which would isolate
 * the Arabic instead.
 *
 * ```ts
 * t('invoicePaidOn', { date: ltrIsolate(paidAt.slice(0, 10)) })
 * ```
 *
 * An empty value is returned untouched: two invisible control characters around nothing is not a
 * rendering instruction, it is two characters that make `''` stop being falsy.
 */
export function ltrIsolate(value: string): string {
  return value === '' ? value : `${LRI}${value}${PDI}`;
}
