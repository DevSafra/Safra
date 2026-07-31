/**
 * Exact decimal arithmetic for money.
 *
 * Every amount is a decimal STRING, never a number. JavaScript numbers are
 * IEEE-754 doubles: `0.1 + 0.2 !== 0.3`, and `55.05 * 3 === 165.14999999999998`.
 * A booking total is a legal obligation, so all arithmetic here is done in integer
 * minor units and only formatted back to a decimal string at the boundary.
 *
 * These lived in `bookings/pricing.service.ts` until the wallet needed them too.
 * Three modules across two domains now depend on them, so they belong somewhere
 * neutral: a wallet reaching into a booking service for its addition is the kind
 * of import that quietly turns a layered codebase into a graph.
 */

/**
 * The scale every stored money amount actually has.
 *
 * Not the currency's own scale — the column's. Every money column in the schema is
 * `numeric(14,2)`, so two decimals is what the database will keep whatever
 * `currencies.decimals` says.
 *
 * That matters for JOD, which is a three-decimal currency: `currencies.decimals`
 * records 3, but a JOD amount stored in one of these columns is rounded to 2 by
 * PostgreSQL regardless. Computing at scale 2 here makes the loss happen in one
 * predictable place instead of at whichever write reaches the database first.
 * Widening the columns is a schema-wide change and is tracked in the roadmap; it is
 * deliberately not smuggled in behind a wallet feature.
 */
export const MONEY_SCALE = 2;

/** Parses a decimal string into integer minor units. Never uses parseFloat. */
export function toMinor(value: string, scale: number): bigint {
  const trimmed = value.trim();
  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;

  const [whole = '0', fraction = ''] = unsigned.split('.');
  // Pad or truncate the fraction to the currency's scale, so "55.5" and "55.50"
  // both become 5550 for a 2-decimal currency.
  const padded = (fraction + '0'.repeat(scale)).slice(0, scale);

  const minor = BigInt(whole || '0') * 10n ** BigInt(scale) + BigInt(padded || '0');
  return negative ? -minor : minor;
}

/** Formats integer minor units back into a decimal string. */
export function fromMinor(minor: bigint, scale: number): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const divisor = 10n ** BigInt(scale);

  const whole = abs / divisor;
  const fraction = abs % divisor;

  const body =
    scale === 0
      ? whole.toString()
      : `${whole.toString()}.${fraction.toString().padStart(scale, '0')}`;

  return negative ? `-${body}` : body;
}

/**
 * Applies a fractional rate (0.07) to minor units, rounding half-up.
 *
 * The rate is scaled to an integer first so the multiplication stays in bigint —
 * `baseMinor * 0.07` would reintroduce float error on the very value we are
 * protecting.
 */
export function applyRate(minor: bigint, rate: number): bigint {
  const RATE_SCALE = 1_000_000n; // six decimal places of rate precision
  const scaledRate = BigInt(Math.round(rate * Number(RATE_SCALE)));

  const product = minor * scaledRate;
  // Round half-up rather than truncating, so a fee is never systematically short.
  return (product + RATE_SCALE / 2n) / RATE_SCALE;
}

/** Working precision for decimal-string multiply and divide. */
const SCALE = 8;

/** Multiplies two decimal strings exactly, at a fixed output scale. */
export function multiplyDecimalStrings(a: string, b: string, outScale: number): string {
  const aMinor = toMinor(a, SCALE);
  const bMinor = toMinor(b, SCALE);

  const productMinor = aMinor * bMinor; // now at 2 * SCALE
  const divisor = 10n ** BigInt(2 * SCALE - outScale);

  return fromMinor((productMinor + divisor / 2n) / divisor, outScale);
}

/**
 * Divides two decimal strings exactly, at a fixed output scale, rounding half-up.
 *
 * Needed for cross-currency conversion. SAFRA stores only `X → SYP` rates, so
 * converting JOD to USD means JOD → SYP → USD, and the second leg is a division.
 * Doing it as `Number(a) / Number(b)` would put a float back in the middle of a
 * money path at SYP magnitudes, which is precisely where doubles stop representing
 * every integer.
 */
export function divideDecimalStrings(a: string, b: string, outScale: number): string {
  const bMinor = toMinor(b, SCALE);

  if (bMinor === 0n) {
    // Callers convert between configured FX rates, which are constrained to be
    // greater than zero. Reaching here means a rate of 0 was persisted anyway, and
    // returning any number would be inventing one.
    throw new Error('Division by zero in decimal arithmetic.');
  }

  // Scale the numerator up by the output scale plus the working scale, so the
  // integer division below lands with `outScale` digits of result and one spare
  // for the rounding decision.
  const aMinor = toMinor(a, SCALE) * 10n ** BigInt(outScale + 1);
  const quotient = aMinor / bMinor;

  // Round half-up on the spare digit, then drop it.
  const negative = quotient < 0n;
  const abs = negative ? -quotient : quotient;
  const rounded = (abs + 5n) / 10n;

  return fromMinor(negative ? -rounded : rounded, outScale);
}
