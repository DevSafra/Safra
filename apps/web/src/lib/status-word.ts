import { statusWord, type StatusVocabulary } from '@safra/i18n';

import type { Locale } from '@/i18n/routing';

/**
 * A database state's word, from the canonical catalogue rather than from this app's own copy.
 *
 * ## Why the customer site reads statuses from a TypeScript module
 *
 * Every other word a customer reads lives in `messages/web/*.json`, because next-intl resolves ICU
 * there and JSON is what a translation service accepts — see `packages/i18n/src/web.ts`. Statuses
 * are the exception, and Bashar's decision of 2026-09-08 is the reason: *«The same state should
 * use the same terminology everywhere… Partners, customers and administrators should not need to
 * translate status names mentally between applications.»*
 *
 * Held to that by a test comparing three catalogues, the words would still have been three copies
 * that a person edits one of. Read from one module at runtime, they cannot diverge at all — which
 * is the difference between a rule that is enforced and a rule that is structural. Twenty-two of
 * the fifty-eight shared states were divergent on the morning that decision was taken.
 *
 * The canonical module carries all three languages side by side, so «add a language» is still one
 * file rather than a hunt.
 */
export function localStatus(
  vocabulary: StatusVocabulary,
  value: string,
  locale: Locale,
): string {
  return statusWord(vocabulary, value, locale);
}
