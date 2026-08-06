/**
 * The locale registry — the one place that knows which languages SAFRA speaks.
 *
 * §1.4 requires Arabic, English and German from launch, with RTL for Arabic. Arabic is the
 * default and the source of truth: every other catalogue is a translation OF it, and a key
 * that does not exist in Arabic does not exist.
 *
 * ## Why this moved out of the web app
 *
 * It lived in `apps/web/src/i18n/routing.ts`, which made the customer app the authority on
 * how many languages the platform has. The staff console, the transactional emails and the
 * API's error text all need the same answer, and three copies of a locale list is three
 * chances for a language to be half-added. `routing.ts` now builds next-intl's routing FROM
 * this list rather than declaring its own.
 */

/**
 * Every locale the platform serves, Arabic first.
 *
 * Adding a language is this array plus one catalogue file per surface. The completeness
 * tests then fail until every key is translated, which is the point: a language is either
 * added or it is not, and there is no state in between where some screens silently fall
 * back to Arabic without anyone noticing.
 */
export const LOCALES = ['ar', 'en', 'de'] as const;

export type Locale = (typeof LOCALES)[number];

/**
 * The source-of-truth locale.
 *
 * Arabic is not a fallback of convenience — SAFRA's staff and most of its customers work in
 * Arabic, and the copy is written here first. Translations are derived from it.
 */
export const DEFAULT_LOCALE: Locale = 'ar';

/** Text direction per locale. Arabic is the only RTL language at launch. */
export const LOCALE_DIRECTION: Record<Locale, 'rtl' | 'ltr'> = {
  ar: 'rtl',
  en: 'ltr',
  de: 'ltr',
};

/**
 * Names shown in the language switcher, each written in its own language.
 *
 * These are deliberately NOT translated. A German speaker looking for their language scans
 * for "Deutsch", not for "الألمانية" — an endonym is the one string that must stay the same
 * in every catalogue, so it lives here rather than in three of them.
 */
export const LOCALE_LABELS: Record<Locale, string> = {
  ar: 'العربية',
  en: 'English',
  de: 'Deutsch',
};

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/**
 * Narrows anything to a locale, falling back to Arabic.
 *
 * Used at every boundary where a locale arrives from outside — a URL segment, a
 * `preferred_locale` column, an `Accept-Language` header. A stale link or an unrecognised
 * column value should render a usable page in Arabic, not a 404 and not a crash.
 */
export function resolveLocale(value: string | null | undefined): Locale {
  return value && isLocale(value) ? value : DEFAULT_LOCALE;
}

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
