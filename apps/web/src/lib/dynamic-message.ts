/**
 * Looking up a catalogue key that is only known at runtime.
 *
 * ## Why this needs a helper at all
 *
 * `apps/web/src/i18n/request.ts` declares next-intl's `Messages` type, so `t('hoem.title')` is a
 * compile error. That is the point of it, and it also rejects the handful of lookups whose key is
 * genuinely data: a city's `categories` (`coastal`), a wallet entry's `reason`
 * (`sla_compensation`), a property's type code. Those come out of the database as strings and
 * cannot be literal types.
 *
 * The two bad ways out are casting the key to `never` at each site, which switches the checking
 * off wherever somebody finds it convenient, and dropping the augmentation, which switches it off
 * everywhere. This is the third: ONE place that admits the key is dynamic, checks it exists, and
 * decides what happens when it does not.
 *
 * ## The fallback is the real reason
 *
 * Without `has()`, next-intl renders a missing key AS the key — a customer reading `propertyTypes`
 * where a property type should be. An enum value added to the database before the catalogue is not
 * hypothetical, it is the normal order of events. So an unknown key falls back to a caller-supplied
 * string, and the caller decides whether that is a dash or the raw value.
 */

/** The shape of a next-intl translator, narrowed to what this needs. */
interface Translator {
  (key: never): string;
  has: (key: never) => boolean;
}

/**
 * Translates a runtime-determined key, or returns `fallback` if the catalogue has no entry.
 *
 * ```ts
 * dynamicMessage(tc, category, category)   // raw value if untranslated — visibly a gap
 * dynamicMessage(tr, entry.reason, '—')    // a dash where a label would be noise
 * ```
 */
export function dynamicMessage(t: Translator, key: string, fallback: string): string {
  return t.has(key as never) ? t(key as never) : fallback;
}
