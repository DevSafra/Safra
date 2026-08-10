import { cityLocalNow } from '@safra/contracts';
import { ARABIC_WESTERN_DIGITS } from '@safra/i18n';

/**
 * The primary launch market's zone — the same fallback `SearchService.resolveTimezone` uses.
 *
 * A partner's properties can sit in different cities, but one calendar grid has one "today", so it
 * is the platform's market rather than a per-property answer.
 */
const MARKET_TIME_ZONE = 'Asia/Damascus';

/**
 * Today's date where the business is, as `YYYY-MM-DD`.
 *
 * NOT `new Date().toISOString().slice(0, 10)`, which is what this replaced. That returns the date in
 * UTC, and Damascus is UTC+3 — so for the three hours after 21:00 UTC every day, the calendar rang
 * the wrong square as "today" and left the real yesterday undimmed. `cityLocalNow` reads the IANA
 * database rather than assuming a constant offset, which matters the moment a second market is added:
 * Beirut observes DST and Damascus has not since 2022.
 */
export function marketToday(): string {
  return cityLocalNow(new Date(), MARKET_TIME_ZONE).date;
}

/**
 * An amount with its symbol, in the position that reads correctly.
 *
 * The same rule the console follows (§4.1): SYP puts `ل.س` after the number because it is Arabic
 * text and belongs at the Arabic end; everything else prefixes a Latin symbol. A trailing ISO code
 * gets REORDERED by the bidirectional algorithm inside an RTL line and renders as `USD 95.00`,
 * which reads as a label rather than an amount.
 *
 * Western digits throughout: every figure a partner sees here reconciles against a payout, and no
 * bank statement is written in Arabic-Indic numerals.
 */
const SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  SYP: 'ل.س',
  JOD: 'د.أ',
  LBP: 'ل.ل',
};

export function amount(value: string | null | undefined, currency: string): string {
  if (value === null || value === undefined) return '—';

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) return '—';

  const money = parsed.toLocaleString(ARABIC_WESTERN_DIGITS, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const symbol = SYMBOLS[currency] ?? currency;

  return currency === 'SYP' || currency === 'JOD' || currency === 'LBP'
    ? `${money} ${symbol}`
    : `${symbol}${money}`;
}

/** A count, grouped. */
export function count(value: number): string {
  return value.toLocaleString(ARABIC_WESTERN_DIGITS);
}
