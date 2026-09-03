import { currencyDecimals, currencyOption, symbolTrails } from '@safra/contracts';

import type { Locale } from '@/i18n/routing';

interface Translated {
  nameAr: string;
  nameEn?: string | null;
  nameDe?: string | null;
}

interface Described {
  descriptionAr?: string | null;
  descriptionEn?: string | null;
  descriptionDe?: string | null;
}

/**
 * Picks the right translation, falling back to Arabic.
 *
 * Arabic is the source language: §1.4 requires all three, but content is authored
 * in Arabic first and English/German may lag. Falling back to Arabic shows real
 * content rather than an empty string — a missing German name should never render
 * a blank card.
 */
export function localisedName(value: Translated, locale: Locale): string {
  if (locale === 'en') return value.nameEn?.trim() || value.nameAr;
  if (locale === 'de') return value.nameDe?.trim() || value.nameAr;
  return value.nameAr;
}

/**
 * The same choice for the `{ ar, en, de }` shape the property detail uses.
 *
 * Lifted out of `property/[slug]/page.tsx`, where it lived as a local `pick`. Being local is how the
 * checkout page came to re-implement it as `locale === 'ar' ? name.ar : name.en || name.ar` — which
 * answers ENGLISH to a German reader, and 241 properties have a German name that differs. One helper,
 * so there is nowhere for a fifth variant to appear.
 */
export function localisedText(
  value: { ar: string | null; en: string | null; de: string | null },
  locale: Locale,
): string {
  if (locale === 'en') return value.en?.trim() || value.ar || '';
  if (locale === 'de') return value.de?.trim() || value.ar || '';

  return value.ar || '';
}

export function localisedDescription(value: Described, locale: Locale): string | null {
  if (locale === 'en') return value.descriptionEn?.trim() || value.descriptionAr || null;
  if (locale === 'de') return value.descriptionDe?.trim() || value.descriptionAr || null;
  return value.descriptionAr || null;
}

/**
 * Formats an amount for display.
 *
 * Amounts arrive from the API as decimal STRINGS and are parsed only here, at the
 * point of display. Nothing upstream does arithmetic on a float — a rounding error
 * in a price is not recoverable once it has been shown to a customer.
 *
 * ## `exact` — for a column of figures rather than a price
 *
 * A price reads better without trailing zeros, which is why `$380` is the default. On a RECEIPT it does
 * not: the breakdown printed `$380`, `$1.99`, `$381.99` down one column, and the whole number looks
 * like a different kind of number from the two beside it. `exact` pins two decimals so a column of
 * amounts aligns and every figure carries the same precision as the stored value.
 */
export function formatMoney(
  amount: string,
  currency: string,
  locale: Locale,
  options: { readonly exact?: boolean } = {},
): string {
  const value = Number(amount);

  /*
    A blank string is treated as UNPARSEABLE rather than as zero.

    `Number('')` is `0` and finite, so a missing amount would have formatted as a real price of nothing.
    Falling through to the raw-value path shows the currency without inventing a figure.
  */
  if (!Number.isFinite(value) || amount.trim() === '') {
    return `${amount} ${currency}`.trim();
  }

  /*
    The CURRENCY's own scale, not two.

    `maximumFractionDigits: 2` overrode the table `Intl` already has, so a three-decimal currency
    lost a digit here exactly as it did in the console and the partner portal: `10.125` rendered
    `10.13`. The scale comes from `@safra/contracts` rather than from `Intl` so that all three
    apps answer the same question the same way — the console cannot use `Intl`'s table without
    also inheriting answers for codes this platform will never price in.
  */
  const scale = currencyDecimals(currency);

  const number = new Intl.NumberFormat(locale === 'ar' ? 'ar-SY' : locale, {
    // Whole prices read better without trailing zeros; fractions still show them.
    minimumFractionDigits: options.exact || !Number.isInteger(value) ? scale : 0,
    maximumFractionDigits: scale,
    // Western digits across all locales, matching the prototype.
    numberingSystem: 'latn',
  }).format(value);

  /*
    The SYMBOL comes from the catalogue, and the number is formatted on its own.

    `style: 'currency'` used to do both, and it wrote the currency in `Intl`'s spelling for the
    READER's locale rather than in this platform's. On an Arabic page that made every dollar price
    «US$ 100» — Bashar asked for the «US» gone (2026-09-03), and it was never ours to print: the
    header's own currency menu offers «$», because `CURRENCY_CATALOGUE` says the symbol for USD is
    «$». One product cannot spell a currency two ways on one screen.

    `currencyDisplay: 'narrowSymbol'` was the obvious fix and is the wrong one, measured rather
    than assumed: under `ar-SY` it leaves USD as «US$» anyway, and it renders SYP as «£» — the
    pound sign, for a currency this platform writes «ل.س». It trades a cosmetic complaint for a
    wrong symbol on the launch market's own money.

    `symbolTrails` decides the side, so an Arabic-script symbol follows the number and a Latin one
    leads it. That rule already exists for the console and the partner portal; this is the third
    app finally asking it the same question.
  */
  const symbol = currencyOption(currency)?.symbol;

  /* Never a guessed symbol: a code the catalogue does not know keeps its code. */
  if (!symbol) return `${number} ${currency}`;

  return symbolTrails(symbol) ? `${number} ${symbol}` : `${symbol}${number}`;
}
