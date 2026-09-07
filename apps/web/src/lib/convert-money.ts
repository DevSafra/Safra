import type { Locale } from '@/i18n/routing';
import { formatMoney } from '@/lib/localise';
import { ACCOUNTING_CURRENCY } from '@safra/contracts';

/**
 * Converting a price into the currency somebody asked to read it in.
 *
 * ## Why this is its own module
 *
 * The logic used to live in `currency.ts`, which is `server-only` — it reads the currency cookie.
 * The BASKET needs the same arithmetic in the browser: a guest adding a suite to two double rooms
 * changes the total, and pre-computing every combination of types and quantities server-side is
 * exponential in the number of room types.
 *
 * So the pure part moved here and `currency.ts` calls it. One implementation, both sides — because
 * two would be two answers to «what does this cost», and the card would come to disagree with the
 * charge. Everything it needs is plain data (a target code, a rate table, a locale), which is also
 * what makes it passable from a server component to a client one.
 */
export interface FxRate {
  readonly base: string;
  readonly quote: string;
  readonly rate: string;
}

/**
 * The pivot every derived cross-rate goes through — the currency every rate is QUOTED IN.
 *
 * `SYP`, not USD, and the difference is the whole reason cross-currency display never worked.
 *
 * `fx_rates` stores one shape: `base → SYP`. `FxRateService` completes every pair with the
 * accounting currency — «Base currency, ISO 4217. The pair is completed with SYP» — so the rate
 * graph is a star with SYP at the centre and nothing else in it.
 *
 * This said `USD`, on the reasoning that listings are priced in USD. That conflates what a listing
 * is priced IN with what the rates are quoted AGAINST. With USD as the pivot, `rateBetween` reached
 * the guard below on its first step for every USD price — `from === PIVOT` — and returned null, so
 * the only currency a USD listing could ever be shown in was SYP, the one it had a direct rate to.
 *
 * Measured on 2026-09-07: a guest selecting EUR or TRY saw `$201.99`, unchanged, with no notice.
 * Entering a EUR rate through the new console screen did not fix it, because the arithmetic could
 * not use the rate — which is why the screen alone would have looked like a success.
 */
const PIVOT = ACCOUNTING_CURRENCY;

function finite(value: string): number | null {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The rate from one currency to another, directly, inverted, or through USD.
 *
 * Returns null rather than 1 when no path exists: a missing rate must show the original amount,
 * not the same number wearing another currency's symbol.
 */
export function rateBetween(
  from: string,
  to: string,
  rates: readonly FxRate[],
): number | null {
  if (from === to) return 1;

  const direct = rates.find((r) => r.base === from && r.quote === to);

  if (direct) return finite(direct.rate);

  const inverse = rates.find((r) => r.base === to && r.quote === from);

  if (inverse) {
    const value = finite(inverse.rate);

    return value === null || value === 0 ? null : 1 / value;
  }

  if (from === PIVOT || to === PIVOT) return null;

  const toPivot = rateBetween(from, PIVOT, rates);
  const fromPivot = rateBetween(PIVOT, to, rates);

  return toPivot === null || fromPivot === null ? null : toPivot * fromPivot;
}

/**
 * A price for a BROWSE surface, in the visitor's currency where that is possible.
 *
 * Returns the formatted string and whether it was converted, because the caller has to say so: an
 * unlabelled converted figure reads as a quote, and it is not one.
 */
export function convertMoney(
  amount: string,
  currency: string,
  locale: Locale,
  target: string,
  rates: readonly FxRate[],
): { text: string; converted: boolean; original: string } {
  const original = formatMoney(amount, currency, locale);
  const value = Number(amount);
  const rate = rateBetween(currency, target, rates);

  /*
    `amount.trim() === ''` is checked SEPARATELY from `Number.isFinite`, because `Number('')` is 0.

    Without it a missing amount multiplied cleanly to zero and rendered as «٠ ل.س» — a price of
    nothing, presented as a converted figure. `formatMoney` guards the same case for the same
    reason; this is the second place that reasoning has to exist, and a test found it.
  */
  if (
    currency === target ||
    rate === null ||
    amount.trim() === '' ||
    !Number.isFinite(value)
  ) {
    return { text: original, converted: false, original };
  }

  /*
    Rounded to whole units for a converted figure, deliberately.

    «١٥٦٠٠٠٠٫٠٠ ل.س» claims a precision the rate does not have — it is one number a staff member
    typed, not a live mid-market quote — and two decimal places on an estimate invite somebody to
    reconcile it against a card statement. The exact amount is the one in its own currency, which
    is shown beside it.
  */
  return {
    text: formatMoney(String(Math.round(value * rate)), target, locale),
    converted: true,
    original,
  };
}
