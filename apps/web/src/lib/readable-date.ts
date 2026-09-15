import type { Locale } from '@/i18n/routing';

/**
 * A calendar date as a person reads it — «الأحد ٥ أكتوبر» rather than «2026-10-05».
 *
 * ## Why this is a function rather than an expression
 *
 * The options are not obvious and getting any of them wrong is invisible until somebody in the
 * wrong place reads the wrong day:
 *
 * - **`ar-SY`, never a bare `ar`.** A bare `ar` resolves to a default region whose month names are
 *   the Levantine ones on some engines and the Egyptian ones on others, and «أيلول» against
 *   «سبتمبر» is a difference a Syrian reader notices immediately. Same reasoning `formatMoney` and
 *   the date-range field already record.
 * - **`numberingSystem: 'latn'`.** This platform writes Arabic with Western digits — the approved
 *   prototype does, and mixing Eastern Arabic numerals into a page of Latin prices is harder to
 *   scan rather than more authentic.
 * - **`timeZone: 'UTC'`.** A stay date is a CALENDAR date, not an instant. Formatting
 *   `2026-10-05` in a browser west of Greenwich renders the 4th, which is the sort of defect that
 *   only shows up for readers in one half of the world.
 *
 * The month and weekday NAMES come from `Intl` rather than from a catalogue — the documented
 * exception in `docs/i18n.md`, because a hand-written list of twelve month names in three
 * languages is a translation task nobody asked for and `Intl` already has them right.
 */
export function readableDate(iso: string, locale: Locale): string {
  const at = new Date(`${iso}T00:00:00Z`);

  /* Unparseable in, unchanged out — never a date this invented. */
  if (Number.isNaN(at.getTime())) return iso;

  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SY' : locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    numberingSystem: 'latn',
    timeZone: 'UTC',
  }).format(at);
}

/**
 * A month and a year — «أكتوبر 2025» — for a date whose DAY is not the point.
 *
 * A review's date is the case this exists for. `readableDate` above names the weekday, which is
 * exactly right for an arrival («الأحد ٥ أكتوبر» is a plan somebody has to keep) and noise on a
 * review nobody is going to diarise. The year is the half that matters instead, and it is the half
 * a day-and-month rendering drops: «5 أكتوبر» under a quote says nothing about whether the guest
 * stayed last month or three years ago, and on a review that is the first thing a reader weighs.
 *
 * Same three choices as `readableDate`, for the same three reasons: `ar-SY` so the months are the
 * Levantine ones, Latin digits because this platform writes Arabic with them, and UTC because a
 * calendar date is not an instant.
 */
export function readableMonth(iso: string, locale: Locale): string {
  const at = new Date(`${iso}T00:00:00Z`);

  if (Number.isNaN(at.getTime())) return iso;

  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SY' : locale, {
    year: 'numeric',
    month: 'long',
    numberingSystem: 'latn',
    timeZone: 'UTC',
  }).format(at);
}
