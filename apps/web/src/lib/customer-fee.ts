import { currencyDecimals } from '@safra/contracts';

import { moneyFromMinor, moneyToMinor } from '@/lib/localise';

/**
 * Rate precision, and it matches `applyRate` in the API exactly.
 *
 * Six decimal places, scaled to an integer before multiplying so the money value never meets a
 * float. Divergence here would be invisible and would surface as a card and a checkout differing
 * by one minor unit — the class of bug this whole file exists to close.
 */
const RATE_SCALE = 1_000_000n;

/**
 * A displayed price with SAFRA's fee already in it.
 *
 * ## Why the customer site does this at all
 *
 * Because a price a guest reads has to be the price a guest pays. The search API folds the fee into
 * `stayTotal` and `nightlyFrom` server-side; the property page prints a UNIT's own `basePrice`,
 * which is the partner's rate and has no fee in it — so that one page said «$100 / الليلة» while
 * every card around it said «$101.99» (Bashar, 2026-09-03, with three screenshots).
 *
 * ## Why the arithmetic is here and not in the API
 *
 * `basePrice` is the partner's rate. It is what a partner typed, what the partner portal shows back
 * to them, and what the payable is computed from — so it must not silently become something else in
 * a shared payload. The public property endpoint already sends the RULE alongside it (`fees`), and
 * this applies it at the point of display. The rule still has one source: the Rules Engine setting.
 *
 * ## Exact, never a float
 *
 * Minor units throughout, for the reason `formatMoney` gives: a rounding error in a price is not
 * recoverable once somebody has seen it. A percentage fee rounds half-up at the currency's own
 * scale, which is what `pricing.service.ts` does when it charges the same fee.
 */
export function priceWithCustomerFee(
  base: string,
  currency: string,
  fees: { readonly customerFeeMode: string; readonly customerFeeValue: number },
): string {
  const scale = currencyDecimals(currency);
  const baseMinor = moneyToMinor(base, scale);

  /* Unparseable in, unchanged out — never a figure this invented. */
  if (baseMinor === null) return base;

  if (fees.customerFeeMode === 'percent') {
    const rate = BigInt(Math.round(fees.customerFeeValue * Number(RATE_SCALE)));
    /* Half-up, as `applyRate` rounds it, so a fee is never systematically short. */
    const feeMinor = (baseMinor * rate + RATE_SCALE / 2n) / RATE_SCALE;

    return moneyFromMinor(baseMinor + feeMinor, scale);
  }

  const flatMinor = moneyToMinor(fees.customerFeeValue.toFixed(scale), scale) ?? 0n;

  return moneyFromMinor(baseMinor + flatMinor, scale);
}
