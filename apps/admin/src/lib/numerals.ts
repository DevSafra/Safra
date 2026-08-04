/**
 * Arabic copy, WESTERN digits.
 *
 * `nu-latn` forces `0-9` instead of the `٠-٩` an `ar` locale would otherwise pick. This is
 * what the approved design uses throughout — "الأربعاء 23 تموز 2026", "عمولة الشريك 7٪" —
 * and there are three reasons not to override it:
 *
 * - Arabic-Indic zero is `٠`, a small raised dot. "٠ بغرامة شريك" reads as a stray bullet,
 *   not as "zero with a partner fine", and a counter whose zero is invisible is worse than
 *   no counter.
 * - Every figure on this console gets reconciled against something outside it — a ledger, a
 *   bank statement, a payment provider, a sanctions file — and none of those render
 *   Arabic-Indic digits. A number that has to be compared against an external record should
 *   look the same in both places.
 * - References like `BKG-2026-000388` are Latin by construction, so mixed digit systems
 *   would appear in the same table row.
 *
 * Grouping and the decimal separator still follow Arabic conventions, which is the point of
 * keeping the `ar-SY` base rather than switching to `en-US`.
 *
 * `ca-gregory` pins the calendar: an `ar` locale can resolve to Umm al-Qura on some
 * platforms, which would render a different year than the one in the database.
 */
export const ARABIC_WESTERN_DIGITS = 'ar-SY-u-nu-latn-ca-gregory';
