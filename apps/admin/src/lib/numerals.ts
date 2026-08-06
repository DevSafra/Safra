/**
 * Re-exported so the console's existing `@/lib/numerals` imports keep working.
 *
 * The constant itself moved to `@safra/i18n` on 2026-08-06, when لوحة الشريك needed the same
 * one: "Arabic copy, western digits" is a decision about the LOCALE, and a second copy in a
 * second app is a second thing to keep in step. The reasoning lives with it there.
 */
export { ARABIC_WESTERN_DIGITS } from '@safra/i18n';
