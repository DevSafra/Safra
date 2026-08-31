/**
 * The IANA time zones a city may be placed in.
 *
 * ## Why a menu rather than a text box (Bashar, 2026-08-31)
 *
 * «المنطقة الزمنية field should be as a menu to select not to type.» A zone is an identifier from a
 * standard, exactly like a currency code, and it is LOAD-BEARING: §5.3's same-day booking cutoff is
 * 17:00 in the CITY's local time, so a city created with `Asia/Damascas` — or with `Damascus`, or
 * with a zone that is simply the wrong one — closes its own bookings at the wrong hour, silently,
 * for as long as nobody notices. The API refuses a zone `Intl` does not know, which catches the
 * typo and not the plausible mistake.
 *
 * ## Why a written list rather than every zone the runtime knows
 *
 * `Intl.supportedValuesOf('timeZone')` answers with something over four hundred, which is a picker
 * nobody can use and which offers `Pacific/Chatham` beside the three markets SAFRA actually serves.
 * The same reasoning `CURRENCY_CATALOGUE` is written with: a lookup that answers for the whole world
 * also answers for places this platform will never operate in, and a wrong answer there is invisible.
 *
 * So this list mirrors the currency catalogue's coverage — one zone per market it can price in —
 * and adding a market is a one-line change with no migration. A city already stored with a zone
 * outside this list keeps it: the pickers add the current value as an option rather than silently
 * dropping it, which is the difference between a constrained field and a lossy one.
 */
export const TIMEZONE_CATALOGUE: readonly string[] = [
  'Asia/Damascus',
  'Asia/Amman',
  'Asia/Beirut',
  'Asia/Baghdad',
  'Asia/Riyadh',
  'Asia/Dubai',
  'Africa/Cairo',
  'Europe/Istanbul',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
];

/**
 * A zone's offset from UTC at a given instant, as `UTC+03:00`.
 *
 * Shown beside the identifier in the picker, because «Asia/Amman» and «Asia/Beirut» are two names
 * an operator cannot tell apart by eye and the offset is the thing they are actually choosing
 * between. Computed rather than written down: an offset is a fact about a date — Beirut and
 * Damascus have differed across a daylight-saving boundary before — and a constant would be a
 * second source of truth that goes stale twice a year.
 *
 * Takes the instant as a parameter rather than reading the clock, so it is testable and so a caller
 * cannot get a different answer from two calls a millisecond apart.
 */
export function utcOffset(zone: string, at: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    timeZoneName: 'longOffset',
  }).formatToParts(at);

  const name = parts.find((part) => part.type === 'timeZoneName')?.value ?? '';

  /* `longOffset` gives `GMT+03:00`, or a bare `GMT` at zero. Both are normalised. */
  return name === 'GMT' ? 'UTC+00:00' : name.replace('GMT', 'UTC');
}

/** Whether a zone is one the runtime recognises — the same check the API makes. */
export function isKnownTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(new Date(0));

    return true;
  } catch {
    return false;
  }
}
