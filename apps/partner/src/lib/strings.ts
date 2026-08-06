import { fill, partnerAr, type Locale } from '@safra/i18n';

/**
 * لوحة الشريك's copy, and the lookups that read it.
 *
 * The same binding the console uses (`apps/admin/src/lib/strings.ts`): one line names the locale,
 * every call site says `t.nav.properties` and knows nothing about which language that is.
 *
 * `partnerAr` rather than `partnerMessages(locale)` while there is one language, because the
 * literal types are what let `fill()` check placeholder names at compile time. Switching is one
 * line here when a second language arrives.
 */
export const PARTNER_LOCALE: Locale = 'ar';

export const t = partnerAr;

/** Re-exported so components interpolate copy without also importing the package. */
export { fill };

/** A property's state in Arabic, falling back to the raw value rather than blank. */
export function propertyStatus(status: string): string {
  return t.propertyStatus[status] ?? status.replace(/_/g, ' ');
}
