import { ARABIC_WESTERN_DIGITS } from '@safra/i18n';

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
