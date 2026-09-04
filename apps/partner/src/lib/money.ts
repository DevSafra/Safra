import { currencyDecimals } from '@safra/contracts';

/**
 * Adding two money strings, exactly.
 *
 * ## Why not `Number(a) + Number(b)`
 *
 * Because a total a partner reads is a claim about their money, and floating point makes claims it
 * cannot keep: `0.1 + 0.2` is `0.30000000000000004`, and a sum of nine payouts is nine chances for
 * one of those to surface as a figure that is a minor unit away from the rows above it. The whole
 * point of the summary is that it agrees with the list.
 *
 * So the arithmetic happens in MINOR UNITS as integers — the same discipline `applyRate` in the
 * API and `priceWithCustomerFee` on the customer site both follow — and the scale comes from the
 * CURRENCY, so a three-decimal dinar keeps its third digit instead of being rounded to cents.
 *
 * ## Unparseable in, first argument out
 *
 * Never a figure this invented. A caller summing a list is better served by a total that is short
 * by one unreadable row than by `NaN` on a screen about money — and `amount()` renders a bad value
 * visibly rather than silently, so the row itself still shows the problem.
 */
export function addMoney(a: string, b: string, currency: string): string {
  const scale = currencyDecimals(currency);
  const left = toMinor(a, scale);
  const right = toMinor(b, scale);

  if (left === null || right === null) return a;

  return fromMinor(left + right, scale);
}

/** A decimal money string as minor units, or `null` when it is not one. */
function toMinor(value: string, scale: number): bigint | null {
  if (!/^-?\d+(\.\d+)?$/.test(value.trim())) return null;

  const [whole = '0', fraction = ''] = value.trim().split('.');
  const padded = fraction.padEnd(scale, '0').slice(0, scale);
  const negative = whole.startsWith('-');
  const digits = `${whole.replace('-', '')}${padded}`;

  return BigInt(negative ? `-${digits}` : digits);
}

/** Minor units back to the decimal string the formatter expects. */
function fromMinor(value: bigint, scale: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale);
  const fraction = scale === 0 ? '' : `.${digits.slice(digits.length - scale)}`;

  return `${negative ? '-' : ''}${whole}${fraction}`;
}
