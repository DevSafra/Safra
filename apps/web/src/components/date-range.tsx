import { rangeArrow } from '@/lib/arrows';
import type { Locale } from '@/i18n/routing';

/**
 * A date range, with the arrow pointing the way the reader READS.
 *
 * ## The bug this fixes
 *
 * Every range was written `{from} → {to}`, a hard-coded right-pointing arrow. On the Arabic pages the
 * bidi algorithm places the two dates correctly — check-in rightmost, because RTL puts the first
 * logical item on the right — and then the arrow points back at it:
 *
 *     2026-08-25 → 2026-08-22        (Arabic: reads right to left)
 *                                     the arrow runs from check-OUT to check-IN
 *
 * So the dates said "22nd to 25th" and the arrow said the opposite. Reported from a screenshot
 * (Bashar, 2026-08-10).
 *
 * ## Why the glyph and not the order
 *
 * The order is already right and must not be touched: `from` stays first in the DOM so the bidi
 * algorithm and a screen reader both get the real sequence. It is the GLYPH that has a direction
 * baked into it, and the fix is to choose the one that agrees with the paragraph — which is the same
 * convention the rest of the project already follows, where `←` is the "next month" arrow on an
 * Arabic screen and `→` is "previous".
 *
 * Not solved by forcing the range into an LTR isolate either: that would make the check-in appear on
 * the LEFT of an Arabic line, which is correct bidi and the wrong reading order for the reader.
 */
export function DateRange({
  from,
  to,
  locale,
}: {
  readonly from: string;
  readonly to: string;
  readonly locale: Locale;
}) {
  const arrow = rangeArrow(locale);

  return (
    <>
      {from} {arrow} {to}
    </>
  );
}
