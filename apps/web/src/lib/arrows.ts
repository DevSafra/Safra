import { LOCALE_DIRECTION, type Locale } from '@/i18n/routing';

/**
 * Arrow glyphs that agree with the reading direction.
 *
 * Extracted from `DateRange` and `BackLink` so the choice is a FUNCTION rather than an expression
 * buried in JSX — which is what let it be wrong in nine places at once (Bashar, 2026-08-10). A one-line
 * ternary inside a component cannot be unit-tested; this can, and is.
 *
 * The two point OPPOSITE ways for the same locale, and that is not a mistake:
 *
 * - a RANGE runs from its start to its end, so it follows the reading direction;
 * - BACK means "the way I came", so it opposes it.
 *
 * On an Arabic page that makes a range `←` and a back control `→` — which is also the convention the
 * partner portal already used for its previous-month arrow.
 */

/** `from → to`: points the way the reader reads. */
export function rangeArrow(locale: Locale): string {
  return LOCALE_DIRECTION[locale] === 'rtl' ? '←' : '→';
}

/** «رجوع»: points back the way the reader came, so against the reading direction. */
export function backArrow(locale: Locale): string {
  return LOCALE_DIRECTION[locale] === 'rtl' ? '→' : '←';
}
