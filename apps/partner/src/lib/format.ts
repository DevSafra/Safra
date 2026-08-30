import { cityLocalNow, currencyDecimals, symbolTrails } from '@safra/contracts';
import { ARABIC_WESTERN_DIGITS } from '@safra/i18n';

import { t } from '@/lib/strings';

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
 * The same rule the console follows (§4.1), and now literally the same code: an Arabic-script
 * symbol goes after the number because it belongs at the Arabic end, a Latin one prefixes it. A
 * trailing ISO code gets REORDERED by the bidirectional algorithm inside an RTL line and renders
 * as `USD 95.00`, which reads as a label rather than an amount.
 *
 * Three things were decided here and all three were wrong. The SYMBOLS were a private copy of the
 * console's table, five codes deep, so a unit priced in dirhams rendered «100.00 AED» — the code,
 * because the map had no entry — and a symbol is copy, which `docs/i18n.md` says belongs in the
 * catalogue. The SCALE was hard-coded to two, so a JOD or IQD amount lost its third decimal. The
 * POSITION was a list of three codes naming two the platform has retired.
 *
 * Western digits throughout: every figure a partner sees here reconciles against a payout, and no
 * bank statement is written in Arabic-Indic numerals.
 */

export function amount(value: string | null | undefined, currency: string): string {
  if (value === null || value === undefined) return '—';

  /*
    A BLANK is absent, not zero.

    `Number('')` and `Number('  ')` are both `0`, which is finite — so without this a missing amount
    rendered as «$0.00». That is the "null is not zero" rule failing in the one place it matters most:
    a fabricated financial figure is more damaging than an absent one, and a partner reading a payout
    of zero has been told something false rather than nothing.
  */
  if (value.trim() === '') return '—';

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) return '—';

  const scale = currencyDecimals(currency);
  const money = parsed.toLocaleString(ARABIC_WESTERN_DIGITS, {
    minimumFractionDigits: scale,
    maximumFractionDigits: scale,
  });
  const symbol = t.currencySymbol[currency] ?? currency;

  return symbolTrails(symbol) ? `${money} ${symbol}` : `${symbol}${money}`;
}

/** A count, grouped. */
export function count(value: number): string {
  return value.toLocaleString(ARABIC_WESTERN_DIGITS);
}
