import 'server-only';

import { cookies } from 'next/headers';

import type { Locale } from '@/i18n/routing';
import { formatMoney } from './localise';

/**
 * Showing prices in the currency a visitor asked for.
 *
 * ## The rule this file exists to enforce
 *
 * **A converted price is an ESTIMATE. A contractual price is not, and is never converted.**
 *
 * Browse surfaces — search cards, a property page, favourites — exist to help somebody compare, and
 * a Syrian visitor comparing nightly rates in dollars is doing arithmetic in their head that this
 * can do for them. Checkout, invoices, the wallet and gift cards are the amounts a person is
 * actually charged, holds, or is owed; converting those would put a number on screen that no
 * receipt will ever match.
 *
 * The separation is enforced by which module a page imports: `convertForDisplay` is here, and the
 * contractual surfaces go on calling `formatMoney` directly with the amount's own currency. There
 * is deliberately no flag that turns conversion off — a flag is a thing somebody sets wrongly.
 *
 * ## Rates are incomplete, and that is a normal state
 *
 * `fx_rates` holds whatever staff have recorded. Today that is one pair, USD→SYP. So conversion is
 * best-effort: when the pair cannot be derived the amount is shown in its OWN currency, unchanged
 * and unlabelled. A visitor who picked euros and sees dollars has learned something true; a visitor
 * who sees a euro figure invented from no rate has not.
 */

/** The currencies the footer offers. An allow-list, because it becomes a cookie value. */
export const DISPLAY_CURRENCIES = ['USD', 'EUR', 'SYP'] as const;

export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];

/**
 * What prices are shown in when the visitor has not chosen.
 *
 * USD, because that is what listings are priced in and it is therefore the one value that converts
 * nothing and can never be wrong.
 */
export const DEFAULT_DISPLAY_CURRENCY: DisplayCurrency = 'USD';

/**
 * Not `HttpOnly`: nothing here is a credential, and a later client-side price widget would need to
 * read it. `SameSite=Lax` so following a link into the site keeps the choice; `Secure` outside
 * development, where there is no TLS to be secure about.
 */
export const CURRENCY_COOKIE = 'safra_currency';

/** The pivot every derived rate goes through. Listings are priced in it. */
const PIVOT: DisplayCurrency = 'USD';

export interface FxRate {
  readonly base: string;
  readonly quote: string;
  readonly rate: string;
}

export interface CurrencyCatalogue {
  readonly currencies: readonly { readonly code: string; readonly symbol: string }[];
  readonly rates: readonly FxRate[];
}

/** A value is only a display currency if it is one of ours — a cookie is caller-supplied input. */
export function isDisplayCurrency(value: unknown): value is DisplayCurrency {
  return (
    typeof value === 'string' && (DISPLAY_CURRENCIES as readonly string[]).includes(value)
  );
}

/** The visitor's chosen currency, or the default. Never throws; a bad cookie is simply ignored. */
export async function displayCurrency(): Promise<DisplayCurrency> {
  const chosen = (await cookies()).get(CURRENCY_COOKIE)?.value;

  return isDisplayCurrency(chosen) ? chosen : DEFAULT_DISPLAY_CURRENCY;
}

/**
 * The multiplier from one currency to another, or null when it cannot be derived.
 *
 * Three ways, in order of how much they are trusted:
 *
 * 1. **A recorded pair.** What staff entered, used as-is.
 * 2. **Its inverse.** `1 / rate`, and this is an assumption rather than data: it holds while a rate
 *    is a pure exchange ratio and stops holding the moment a spread or a fee is baked into it.
 *    Acceptable for an indicative browse price and for nothing else.
 * 3. **Through the pivot.** `X → USD → Y`, which is the only way a pair nobody recorded is
 *    reachable at all.
 *
 * Returning null rather than 1 is the whole point: a missing rate must not silently relabel an
 * amount as a currency it is not.
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
 * unlabelled converted figure reads as a quote, and it is not one. Every caller renders the
 * `converted` case with the original amount beside it.
 */
export function convertForDisplay(
  amount: string,
  currency: string,
  locale: Locale,
  target: DisplayCurrency,
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

    `١٥٦٠٠٠٠٫٠٠ ل.س` claims a precision the rate does not have — it is one number a staff member
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

function finite(value: string): number | null {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}
