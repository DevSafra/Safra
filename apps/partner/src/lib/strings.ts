import IntlMessageFormat from 'intl-messageformat';

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

/**
 * A COUNTED sentence, through ICU — the same mechanism the console and the customer app use.
 *
 * Arabic has six plural forms and `fill()` substitutes placeholders without knowing any of them,
 * so «# حجز» renders «4 حجز» — correct for one, wrong for four. The portal had no plural handling
 * at all until مستحقاتي needed one (2026-09-04); teaching `fill` the rules would turn a
 * substituter into a small translation library, and `Intl.PluralRules` already knows them.
 *
 * ## Counts arrive as NUMBERS, not through `count()`
 *
 * `IntlMessageFormat` formats the digits itself, so the Western digits this platform uses in
 * Arabic still appear. A pre-formatted string would give `Intl.PluralRules` nothing numeric to
 * classify, every message would silently resolve to `other`, and the failure would leave every
 * test green — which is why the values are typed as numbers.
 */
export function plural(message: string, values: Record<string, number | string>): string {
  return String(new IntlMessageFormat(message, PARTNER_LOCALE).format(values));
}

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

/** A verification state in Arabic, falling back to the raw value rather than blank. */
export function verificationStatus(status: string): string {
  return t.verificationStatus[status] ?? status.replace(/_/g, ' ');
}

/** A contract's state in Arabic, falling back to the raw value rather than blank. */
export function contractStatus(status: string): string {
  return t.contractStatus[status] ?? status.replace(/_/g, ' ');
}

/** A contract KIND in Arabic — «عقد شراكة أساسي», not `base`. */
export function contractKind(kind: string): string {
  return t.contractKinds[kind] ?? kind.replace(/_/g, ' ');
}

/** An availability day's state, in Arabic. Unknown values fall back to the raw value. */
export function dayStatus(status: string): string {
  return partnerAr.dayStatus[status] ?? status;
}
