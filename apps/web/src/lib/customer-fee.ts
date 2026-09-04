import { currencyDecimals } from '@safra/contracts';

import { addMoney, moneyFromMinor, moneyToMinor } from '@/lib/localise';

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

/** One breakdown line as the invoice endpoint sends it. */
export interface FeeLine {
  readonly key: string;
  readonly amount: string;
  readonly deduction: boolean;
}

/**
 * The lines as the CUSTOMER sees them: the service fee folded into the accommodation.
 *
 * Bashar, 2026-09-03, three times and finally «the total/final price should only be displayed to
 * the customer/guest» — SAFRA's fee is between the platform and the partner as far as a guest is
 * concerned, and it is not to be named on their screens.
 *
 * **Folded, not dropped.** An invoice is a document somebody may hand to an employer or an
 * accountant, and its lines have to reach its total. Removing a charged line would leave a
 * breakdown that is short by the fee with nothing accounting for the gap — which states the fee to
 * anyone who subtracts, and states it as an error. Adding it into the accommodation line keeps the
 * arithmetic exact and the fee unnamed, and it leaves the discount, gift-card and wallet lines
 * alone, which a customer does need to see.
 *
 * Nothing about the booking, the ledger or the partner's payable changes; those keep the fee
 * itemised, which is where it belongs. This is a rendering of an unchanged record.
 */
export function customerLines<T extends FeeLine>(
  lines: readonly T[],
  currency: string,
  feeVisible: boolean,
): T[] {
  const fee = lines.find((line) => line.key === 'serviceFee');

  /* Named: the invoice is the API's own breakdown, itemised, exactly as staff see it. */
  if (feeVisible || !fee) return [...lines];

  return lines
    .filter((line) => line.key !== 'serviceFee')
    .map((line) =>
      line.key === 'accommodation'
        ? { ...line, amount: addMoney(line.amount, fee.amount, currency) }
        : line,
    );
}
