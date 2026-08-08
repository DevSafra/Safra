import IntlMessageFormat from 'intl-messageformat';

import { adminAr, errorMessage, fill, type Locale } from '@safra/i18n';

/**
 * The staff console's copy, and the lookups that read it.
 *
 * ## What changed and why
 *
 * The copy itself moved to `@safra/i18n` (`messages/admin/ar.ts`). This file used to hold an
 * 818-line constant named `AR`, which put the LANGUAGE in the name of every one of the 577
 * call sites reading it: `AR.bookings.title` cannot become German without editing all 577.
 * `t.bookings.title` can, so the binding below is the only line that names a locale.
 *
 * What stays here is lookup LOGIC, not copy — `bookingStatus`, `label`, `auditAction`,
 * `roleName`, `apiError`. Each maps a machine value onto a catalogue entry and decides what
 * to do when there is no entry, which is a decision about this app rather than about wording.
 *
 * ## Why `adminAr` and not `adminMessages(locale)`
 *
 * The console is Arabic-only (Bashar, 2026-08-03). `adminAr` carries the literal types that
 * let `fill()` check placeholder names at compile time, so `fill(t.staff.inviteSent, { emial })`
 * does not build. `adminMessages(locale)` returns the widened type, which a registry of three
 * languages has to, and there is no reason to pay that while there is one language.
 *
 * When a second console language arrives this becomes `adminMessages(locale)` — one line, here
 * — and placeholder checking hands over to the `completeness` tests in `@safra/i18n`.
 */
export const CONSOLE_LOCALE: Locale = 'ar';

export const t = adminAr;

/**
 * The sidebar's element id, shared by the hamburger's `aria-controls` and the aside itself.
 *
 * A constant rather than a literal in both files: `aria-controls` pointing at an id that does not
 * exist is invisible to everyone except the screen-reader user it was added for.
 */
export const SIDEBAR_ID = 'console-nav';

/** Re-exported so components interpolate copy without also importing the package. */
export { fill };

/** The booking status in Arabic, falling back to the raw value rather than blank. */
export function bookingStatus(status: string): string {
  return t.bookingStatus[status] ?? status.replace(/_/g, ' ');
}

/**
 * Looks a value up in one of the enum maps.
 *
 * Falls back to the raw key with underscores spaced out, which is deliberately ugly: an
 * untranslated status should look like a missing translation, not like a design choice.
 */
export function label(
  map: Record<string, string>,
  value: string | null | undefined,
): string {
  if (!value) return t.admin.noData;

  return map[value] ?? value.replace(/_/g, ' ');
}

/** A city's `categories` array arrives pre-joined; translate each part. */
export function cityCategories(joined: string): string {
  return joined
    .split(' · ')
    .map((part) => t.enums.cityCategory[part] ?? part)
    .join(' · ');
}

/**
 * A cancellation reason, which is EITHER a `system.*` code or a person's own sentence.
 *
 * Deliberately not `label()`: that falls back to `value.replace(/_/g, ' ')`, which is right for an
 * enum key and wrong for prose — it would quietly rewrite a reason somebody typed. So an unknown
 * value is returned exactly as stored, which covers both a human's words and the English
 * sentences written into rows before the codes existed.
 */
export function cancellationReason(reason: string): string {
  return t.enums.cancellationReason[reason] ?? reason;
}

/**
 * A timeline event's payload, as readable label/value pairs.
 *
 * Replaces printing the JSON verbatim. The reasoning for showing the payload at all is that a
 * timeline which SUMMARISES loses the detail a dispute turns on — which fine was applied, which
 * occurrence number — and that argues for dropping no field, not for showing braces. So every
 * entry survives: an unknown key falls back to itself, and an unknown value is printed as stored.
 *
 * A non-scalar value (a nested object, an array) is re-serialised rather than flattened, because
 * flattening it is where a field would actually go missing.
 */
export function payloadEntries(
  payload: unknown,
): readonly { key: string; label: string; value: string }[] {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload))
    return [];

  return Object.entries(payload as Record<string, unknown>).map(([key, value]) => ({
    key,
    label: t.enums.payloadKey[key] ?? key,
    value: payloadValue(value),
  }));
}

/**
 * Each scalar type named rather than `String(value)` over whatever is left.
 *
 * `String()` on an unexpected object yields `[object Object]`, which is a field silently replaced
 * by nothing — the one outcome this rendering exists to prevent. Lint flags it; the fix is to say
 * what a string, a number and a boolean each become, and to let everything else keep its JSON.
 */
function payloadValue(value: unknown): string {
  if (value === null || value === undefined) return t.admin.noData;

  // Only a string can be a code, so only a string is looked up.
  if (typeof value === 'string') return t.enums.payloadValue[value] ?? value;

  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  return JSON.stringify(value) ?? t.admin.noData;
}

/** The Arabic name for an audit action, falling back to the raw key rather than blank. */
export function auditAction(action: string): string {
  return t.auditAction[action] ?? action.replace(/[._]/g, ' ');
}

/** The Arabic name for a role, falling back to the raw value rather than blank. */
export function roleName(role: string | undefined): string {
  if (!role) return '';

  return t.roles[role] ?? role.replace(/_/g, ' ');
}

/**
 * The Arabic message for a failed API call.
 *
 * ## What this used to do
 *
 * It regex-matched the API's ENGLISH prose:
 *
 * ```ts
 * if (/invalid email or password/i.test(message)) return AR.errors.credentials;
 * ```
 *
 * Six patterns, and everything else fell through to "something went wrong". Two problems, both
 * live: rewording an API message silently broke the Arabic with no test failing, and the 77
 * conditions with no pattern showed an operator a generic string when the API knew exactly
 * what had happened.
 *
 * The API now answers with a stable `code`, so this is a catalogue lookup over all 101 of them.
 * `errorMessage` handles a code this build does not recognise — an API deployed ahead of the
 * console — by falling back rather than printing the code.
 */
export function apiError(code: string | null): string {
  return errorMessage(code, CONSOLE_LOCALE);
}

/**
 * A message whose wording depends on a COUNT.
 *
 * ## Why `fill` cannot do this
 *
 * `fill` substitutes placeholders. That is the right tool for «{city} · {type}» and the wrong one
 * for «{nights} ليلة», because Arabic agreement is not substitution: the noun changes with the
 * number, and it changes at boundaries an English speaker does not expect.
 *
 * - 3–10 is `few` and takes the broken plural — «٥ ليالٍ».
 * - **11–99 is `many` and takes the SINGULAR** — «١٥ ليلة», never «١٥ ليالٍ».
 * - 100 and above is `other`, singular again.
 *
 * The console printed «٤ ليلة» — correct for one night, wrong for four — on the booking detail an
 * operator reads all day. Teaching `fill` these rules would turn a placeholder substituter into a
 * small translation library; using ICU, which the customer app already speaks, keeps one mechanism
 * across both apps and puts the rules in `Intl.PluralRules` where they belong.
 *
 * ## Counts arrive as NUMBERS
 *
 * Not as `count(n)`. `IntlMessageFormat` formats the digits itself in `ar`, so the Arabic-Indic
 * numerals still appear — and passing a pre-formatted string would give `Intl.PluralRules` nothing
 * numeric to classify, so every message would silently resolve to `other` and read as the
 * singular. That failure leaves every test green, which is why the counts are typed as numbers.
 */
export function plural(message: string, values: Record<string, number | string>): string {
  return String(new IntlMessageFormat(message, CONSOLE_LOCALE).format(values));
}
