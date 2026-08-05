import type { Locale } from './locales.js';
import { ar } from './messages/email/ar.js';
import { de } from './messages/email/de.js';
import { en } from './messages/email/en.js';
import type { Translated } from './shape.js';

/**
 * Transactional email copy, per locale.
 *
 * ## This one has to be complete
 *
 * Unlike the staff console, every locale here is required — the type below is a full
 * `Record<Locale, …>`, not a `Partial`. An email is sent to a customer in the language they
 * chose, at the moment they are waiting for it, and there is no switcher in an inbox. A
 * password-reset in the wrong language is a support ticket at best and an abandoned account
 * at worst.
 *
 * Adding a locale to `LOCALES` therefore breaks this file until its catalogue exists, which
 * is the intended order of events.
 */
export type EmailMessages = Translated<typeof ar>;

const CATALOGUES: Record<Locale, EmailMessages> = { ar, en, de };

/**
 * The email catalogue for a locale.
 *
 * Callers pass a `preferred_locale` straight from the database, so this takes a `Locale` and
 * leaves the narrowing to `resolveLocale` at the boundary — one place that decides what an
 * unrecognised column value means, rather than each mail function guessing.
 */
export function emailMessages(locale: Locale): EmailMessages {
  return CATALOGUES[locale];
}

/** The email catalogues, for the completeness tests. */
export const EMAIL_CATALOGUES: Readonly<Record<Locale, EmailMessages>> = CATALOGUES;
