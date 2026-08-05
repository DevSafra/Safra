import { DEFAULT_LOCALE, type Locale } from './locales.js';
import { ar } from './messages/content/ar.js';
import { de } from './messages/content/de.js';
import { en } from './messages/content/en.js';
import type { Translated } from './shape.js';

/**
 * Copy that is written INTO stored data, not rendered from it.
 *
 * ## Why this is its own surface
 *
 * Everything else in this package is resolved per request, against the locale of whoever is
 * reading. `redactionMask` cannot be: it replaces a phone number in a message body at the moment
 * the message is written, and what gets stored is the final text. A partner writes in Arabic, a
 * German customer reads the thread, and both see the same stored string — because there is only
 * one stored string.
 *
 * That makes it a different kind of copy, and lumping it in with the rest would imply a
 * per-reader guarantee this cannot offer. Naming the category is the honest option.
 *
 * ## The consequence, stated
 *
 * Baked copy is written in `DEFAULT_LOCALE`. A German customer reading a redacted thread sees
 * `⟨محجوب⟩`. Rendering it per reader would mean storing a marker token and substituting on read —
 * which is the right design and a schema-and-render change well beyond moving copy out of code.
 * Recorded in `docs/FUTURE-WORK.md`; the other two locales are written here so that change is a
 * rendering change rather than also a translation one.
 */
export type ContentMessages = Translated<typeof ar>;

const CATALOGUES: Record<Locale, ContentMessages> = { ar, en, de };

/**
 * Copy for embedding in stored content.
 *
 * Defaults to `DEFAULT_LOCALE` rather than requiring a locale, because the callers genuinely do
 * not have one — a redaction happens on the way into the database, where "whose language" has no
 * answer yet.
 */
export function contentMessages(locale: Locale = DEFAULT_LOCALE): ContentMessages {
  return CATALOGUES[locale];
}

/** The content catalogues, for the completeness tests. */
export const CONTENT_CATALOGUES: Readonly<Record<Locale, ContentMessages>> = CATALOGUES;
