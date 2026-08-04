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
import { AR } from '@/lib/strings';

/**
 * Money, two decimals, Western digits.
 *
 * Every amount on this console reconciles against something outside it — a ledger, a bank
 * statement, a payment provider — and none of those render Arabic-Indic digits.
 */
export function money(amount: string | null | undefined): string {
  if (amount === null || amount === undefined) return AR.admin.noData;

  const value = Number(amount);

  if (!Number.isFinite(value)) return AR.admin.noData;

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

  if (!Number.isFinite(parsed)) return AR.admin.noData;

  return `${parsed.toLocaleString(ARABIC_WESTERN_DIGITS, { maximumFractionDigits: 1 })}٪`;
}

/**
 * `DD-MM-YYYY`, the handoff's date format (§4.1).
 *
 * Formatted from the ISO string by slicing rather than through a `Date`, so no timezone is
 * applied twice: the API already returns these as UTC calendar dates, and constructing a local
 * Date from `2026-08-04` shifts it a day west of Greenwich.
 */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return AR.admin.noData;

  const [year, month, day] = iso.slice(0, 10).split('-');

  return day && month && year ? `${day}-${month}-${year}` : iso;
}

/** `DD-MM-YYYY HH:MM` for an audit or ledger timestamp. */
export function shortDateTime(iso: string | null | undefined): string {
  if (!iso) return AR.admin.noData;

  return `${shortDate(iso)} ${iso.slice(11, 16)}`;
}

/** Just the clock part, for the audit table's الوقت column. */
export function clock(iso: string | null | undefined): string {
  return iso ? iso.slice(11, 16) : AR.admin.noData;
}

/**
 * Currency symbols, for figures that lead with one.
 *
 * The handoff writes amounts as `$3,214` and `12,500 ل.س` — symbol before a Latin amount,
 * after an Arabic one. A trailing ISO code instead (`3,000.00 USD`) gets REORDERED by the
 * bidirectional algorithm inside an RTL line and renders as `USD 3,000.00`, which reads as a
 * label rather than an amount. Observed on the payments KPI cards.
 */
const SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  SYP: 'ل.س',
  JOD: 'د.أ',
  LBP: 'ل.ل',
};

/**
 * An amount with its symbol, in the position that reads correctly.
 *
 * SYP puts its symbol after the number because ل.س is Arabic text and belongs at the Arabic
 * end; everything else prefixes a Latin symbol. Callers wrap the result in `Ltr` so the whole
 * run is treated as one left-to-right token.
 */
export function amount(value: string | null | undefined, currency: string): string {
  if (value === null || value === undefined) return AR.admin.noData;

  const symbol = SYMBOLS[currency] ?? currency;

  return currency === 'SYP' || currency === 'JOD' || currency === 'LBP'
    ? `${money(value)} ${symbol}`
    : `${symbol}${money(value)}`;
}
