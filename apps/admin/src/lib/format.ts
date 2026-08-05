/**
 * Presentation formatters for the console.
 *
 * ## Why these are not in `console.ts`
 *
 * They were, and that was a real bug rather than an untidy one: `console.ts` imports the API
 * client, which is marked `server-only`, so a CLIENT component importing `shortDate` from there
 * dragged the whole server module — access tokens, session reading — into the browser bundle.
 * Next refused the build, correctly, and that refusal is the entire purpose of `server-only`.
 *
 * Formatting is neither server nor client work, so it lives here with no imports beyond the
 * string table and the locale constant, and both sides can use it.
 */
import { ARABIC_WESTERN_DIGITS } from '@/lib/numerals';
import { fill, t } from '@/lib/strings';

/**
 * Money, two decimals, Western digits.
 *
 * Every amount on this console reconciles against something outside it — a ledger, a bank
 * statement, a payment provider — and none of those render Arabic-Indic digits.
 */
export function money(amount: string | null | undefined): string {
  if (amount === null || amount === undefined) return t.admin.noData;

  const value = Number(amount);

  if (!Number.isFinite(value)) return t.admin.noData;

  return value.toLocaleString(ARABIC_WESTERN_DIGITS, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** A count, grouped. */
export function count(value: number): string {
  return value.toLocaleString(ARABIC_WESTERN_DIGITS);
}

/**
 * A percentage, one decimal.
 *
 * One decimal rather than none: a cancellation rate moving from 4.2% to 4.8% is a real signal
 * that rounding to "4%" and "5%" would either hide or exaggerate.
 */
export function percent(value: string): string {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) return t.admin.noData;

  return `${parsed.toLocaleString(ARABIC_WESTERN_DIGITS, { maximumFractionDigits: 1 })}${t.percentSign}`;
}

/**
 * `DD-MM-YYYY`, the handoff's date format (§4.1).
 *
 * Formatted from the ISO string by slicing rather than through a `Date`, so no timezone is
 * applied twice: the API already returns these as UTC calendar dates, and constructing a local
 * Date from `2026-08-04` shifts it a day west of Greenwich.
 */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return t.admin.noData;

  const [year, month, day] = iso.slice(0, 10).split('-');

  return day && month && year ? `${day}-${month}-${year}` : iso;
}

/**
 * A stay, with the parts the two dates SHARE written once — `04 ← 08-09-2026`.
 *
 * ## Why not two full dates
 *
 * It used to render `shortDate(checkIn) ← shortDate(checkOut)`, which is 159px of content in a
 * 133px column: the range overflowed its cell and painted on top of المبلغ, so `201.99 USD` and
 * the check-in date were printed over each other. Collapsing the shared month and year takes the
 * common case to 104px, which fits.
 *
 * It is also what the handoff draws — its bookings table reads `25 ← 28 تموز 2026`, one month and
 * one year for the pair. Repeating them says the same thing twice and costs the column that
 * pays for it. This keeps the console's numeric `DD-MM-YYYY` rather than the handoff's month
 * names, because every other date in the console is numeric and one screen in a different format
 * is a worse inconsistency than a shorter one — recorded in `docs/design-gap-report.md`.
 *
 * ## Where a range may break, and the two characters that decide it
 *
 * Nothing here is `whitespace-nowrap`: a value too wide for its column has to WRAP rather than
 * paint over المبلغ, which is the bug this function was written for. But a plain hyphen is also a
 * break opportunity, so a squeezed column split a date itself — measured between 940px and 1180px
 * of table width, `03-01-2027` rendered as `03-01-` and `2027` on two lines.
 *
 * The break therefore has to be forbidden inside a date and allowed at the space beside the arrow.
 * Two characters were tried:
 *
 * - `U+2011` NON-BREAKING HYPHEN, in place of `-`. WRONG, and wrong in a way that looks fine in a
 *   left-to-right test: it is bidi class ON (Other Neutral), so it SEPARATES the digit groups into
 *   three runs which an RTL line then lays out right-to-left. The console rendered `2026-09-08`.
 *   `U+002D` is class ES (European Separator) and joins them into one number run, which is exactly
 *   why the date survives an RTL line as written.
 * - `U+2060` WORD JOINER, fencing each `-`. RIGHT. It is class BN (Boundary Neutral), which UAX #9
 *   removes before resolving direction, so it cannot affect the order — and UAX #14 forbids a line
 *   break at it. Verified both ways in a browser, not assumed.
 *
 * So the hyphens stay `U+002D` and are fenced with word joiners. `minWidth` on each table is
 * separately set so the common cases never need to wrap at all, and `e2e/table-overflow.spec.ts`
 * holds that at three widths.
 */
export function dateRange(
  checkIn: string | null | undefined,
  checkOut: string | null | undefined,
): string {
  if (!checkIn || !checkOut) return t.admin.noData;

  const from = checkIn.slice(0, 10).split('-');
  const to = checkOut.slice(0, 10).split('-');

  // Anything unexpected falls back to both dates in full rather than to a wrong date.
  if (from.length !== 3 || to.length !== 3) {
    return fill(t.table.dateRange, { from: shortDate(checkIn), to: shortDate(checkOut) });
  }

  const [fromYear, fromMonth, fromDay] = from as [string, string, string];
  const [toYear, toMonth, toDay] = to as [string, string, string];

  /** `U+2060` either side of each hyphen — bidi-transparent, and unbreakable. See above. */
  const glue = '\u2060-\u2060';
  const full = (day: string, month: string, year: string) =>
    `${day}${glue}${month}${glue}${year}`;

  // A one-night stay checking in and out on the same date reads as one date, not a range.
  if (fromYear === toYear && fromMonth === toMonth && fromDay === toDay) {
    return full(toDay, toMonth, toYear);
  }

  const start =
    fromYear !== toYear
      ? full(fromDay, fromMonth, fromYear)
      : fromMonth !== toMonth
        ? `${fromDay}${glue}${fromMonth}`
        : fromDay;

  return fill(t.table.dateRange, { from: start, to: full(toDay, toMonth, toYear) });
}

/**
 * Today's date written out in Arabic — "الأربعاء، 5 آب 2026".
 *
 * Formatted on the SERVER from the server's clock, so it agrees with the counters beside it. A
 * browser-rendered date can disagree across a midnight boundary, and "today's bookings" under
 * yesterday's date is the kind of small inconsistency that costs trust in every other number on
 * the screen.
 *
 * `ARABIC_WESTERN_DIGITS` for the same reason every other figure in the console uses it: Arabic
 * with Western digits, so `5` and `2026` are the numerals staff read everywhere else rather than
 * `٥` and `٢٠٢٦` on this one line.
 *
 * UTC deliberately. Every launch market is UTC+2/+3, and the API reports its counters on UTC
 * calendar days — a date rendered in the viewer's zone would occasionally name a different day
 * than the numbers underneath it.
 *
 * Lives here rather than in the dashboard because the shell shows it on all nineteen other
 * sections too, and two copies of a date format drift.
 */
export function todayLong(): string {
  return new Intl.DateTimeFormat(ARABIC_WESTERN_DIGITS, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date());
}

/** `DD-MM-YYYY HH:MM` for an audit or ledger timestamp. */
export function shortDateTime(iso: string | null | undefined): string {
  if (!iso) return t.admin.noData;

  return `${shortDate(iso)} ${iso.slice(11, 16)}`;
}

/** Just the clock part, for the audit table's الوقت column. */
export function clock(iso: string | null | undefined): string {
  return iso ? iso.slice(11, 16) : t.admin.noData;
}

/**
 * Currency symbols, for figures that lead with one.
 *
 * The handoff writes amounts as `$3,214` and `12,500 ل.س` — symbol before a Latin amount,
 * after an Arabic one. A trailing ISO code instead (`3,000.00 USD`) gets REORDERED by the
 * bidirectional algorithm inside an RTL line and renders as `USD 3,000.00`, which reads as a
 * label rather than an amount. Observed on the payments KPI cards.
 */
const SYMBOLS = t.currencySymbol;

/**
 * An amount with its symbol, in the position that reads correctly.
 *
 * SYP puts its symbol after the number because ل.س is Arabic text and belongs at the Arabic
 * end; everything else prefixes a Latin symbol. Callers wrap the result in `Ltr` so the whole
 * run is treated as one left-to-right token.
 */
export function amount(value: string | null | undefined, currency: string): string {
  if (value === null || value === undefined) return t.admin.noData;

  const symbol = SYMBOLS[currency] ?? currency;

  return currency === 'SYP' || currency === 'JOD' || currency === 'LBP'
    ? `${money(value)} ${symbol}`
    : `${symbol}${money(value)}`;
}
