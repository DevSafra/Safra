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
 */
export function formatMoney(amount: string, currency: string, locale: Locale): string {
  const value = Number(amount);

  /*
    A blank string is treated as UNPARSEABLE rather than as zero.

    `Number('')` is `0` and finite, so a missing amount would have formatted as a real price of nothing.
    Falling through to the raw-value path shows the currency without inventing a figure.
  */
  if (!Number.isFinite(value) || amount.trim() === '') {
    return `${amount} ${currency}`.trim();
  }

  return new Intl.NumberFormat(locale === 'ar' ? 'ar-SY' : locale, {
    style: 'currency',
    currency,
    // Whole prices read better without trailing zeros; fractions still show them.
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
    // Western digits across all locales, matching the prototype.
    numberingSystem: 'latn',
  }).format(value);
}
