import type { Locale } from './locales.js';
import { ar } from './messages/partner/ar.js';
import type { Translated } from './shape.js';

/**
 * لوحة الشريك's copy.
 *
 * Partial for the same reason the console's is: Arabic exists and the others do not yet, and a
 * type satisfied with 80 unreviewed English strings would produce a dashboard that LOOKS
 * translated and reads as machine output to the people running a business on it.
 */
export type PartnerMessages = Translated<typeof ar>;

/**
 * The Arabic catalogue with its LITERAL types intact, so `fill()` still type-checks placeholder
 * names. Same trade as `adminAr` — see the note there.
 */
export const partnerAr = ar;

const CATALOGUES: Partial<Record<Locale, PartnerMessages>> = { ar };

export const PARTNER_LOCALES = Object.keys(CATALOGUES) as readonly Locale[];

export function partnerMessages(locale: Locale): PartnerMessages {
  return CATALOGUES[locale] ?? ar;
}
