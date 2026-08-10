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

/**
 * The sidebar's element id, shared by the hamburger's `aria-controls` and the aside itself.
 *
 * A constant rather than a literal in both files, for the reason the console records: `aria-controls`
 * pointing at an id that does not exist is invisible to everyone except the screen-reader user it
 * was added for. Named for this app rather than reusing `console-nav` — they are separate documents
 * and a shared name would suggest a shared element.
 */
export const SIDEBAR_ID = 'partner-nav';

/** Re-exported so components interpolate copy without also importing the package. */
export { fill };

/** A property's state in Arabic, falling back to the raw value rather than blank. */
export function propertyStatus(status: string): string {
  return t.propertyStatus[status] ?? status.replace(/_/g, ' ');
}

/** A trip trait in Arabic, falling back to the raw key rather than blank. */
export function tripAttribute(key: string): string {
  return t.tripAttribute[key] ?? key;
}

/** A property type in Arabic, falling back to the raw code rather than blank. */
export function propertyType(code: string | null): string {
  if (!code) return '';

  return t.propertyType[code] ?? code.replace(/_/g, ' ');
}

/** A violation kind in Arabic, falling back to the raw enum rather than blank. */
export function violationKind(kind: string): string {
  return t.violationKind[kind] ?? kind.replace(/_/g, ' ');
}

/** A payout state in Arabic, falling back to the raw value rather than blank. */
export function payoutStatus(status: string): string {
  return t.payoutStatus[status] ?? status.replace(/_/g, ' ');
}

/** An availability day's state, in Arabic. Unknown values fall back to the raw value. */
export function dayStatus(status: string): string {
  return partnerAr.dayStatus[status] ?? status;
}
