import { ERROR, isErrorCode, type ErrorCode } from '@safra/contracts';

import { DEFAULT_LOCALE, type Locale } from './locales.js';
import { ar } from './messages/errors/ar.js';
import { de } from './messages/errors/de.js';
import { en } from './messages/errors/en.js';

/**
 * Turning an API error code into something a person can read, in their language.
 *
 * This is the client half of the contract in `@safra/contracts/error-codes`: the API answers
 * with a code, and whoever is rendering it — the customer app, the staff console, a future
 * partner app — resolves it here against the locale of the person actually reading.
 */

/**
 * Codes with no specific message, deliberately.
 *
 * A condition that indicates a bug or a misbehaving client tells the client nothing beyond
 * "something went wrong" (rule 1). The detail is already in the server log, where it is
 * useful and where it is not also a hint for somebody probing the API. `internal.*` codes
 * therefore have no catalogue entry and land on the generic message below.
 */
const CATALOGUES = { ar, en, de } as const;

/** Every locale's fallback when a code is unknown or deliberately generic. */
const GENERIC: ErrorCode = ERROR.REQUEST_UNKNOWN;

type ErrorCatalogue = Partial<Record<string, string>>;

/**
 * The message for a code, in a locale.
 *
 * Three fallbacks, in order, because this function runs at the point a user is already
 * looking at a failure and must not add a second one:
 *
 * 1. The code in the requested locale.
 * 2. The generic message in the requested locale — for an `internal.*` code, or one this
 *    build does not know because the API is newer than the client.
 * 3. The generic message in Arabic, which is the only entry guaranteed to exist.
 *
 * It never returns the raw code and never returns empty. A user reading
 * `conversation.not_found_or_closed` has been shown an implementation detail; a user reading
 * nothing at all cannot tell a failure from a slow network.
 */
export function errorMessage(
  code: string | null | undefined,
  locale: Locale = DEFAULT_LOCALE,
  params?: Readonly<Record<string, string | number>>,
): string {
  const catalogue: ErrorCatalogue = CATALOGUES[locale] ?? CATALOGUES[DEFAULT_LOCALE];
  const fallback: ErrorCatalogue = CATALOGUES[DEFAULT_LOCALE];

  const template =
    (code && isErrorCode(code) ? catalogue[code] : undefined) ??
    catalogue[GENERIC] ??
    fallback[GENERIC] ??
    '';

  /*
    Substituted here rather than by `fill()`: the template is `string` at this point, not a
    literal, so there are no placeholder names for the compiler to check. That is inherent —
    the code arrives over HTTP and cannot be a literal type. The `errors-complete` test
    covers the gap by asserting the placeholders agree across all three locales, which is the
    failure this would otherwise ship: a German translation using {days} where the Arabic
    uses {maxDays}.
  */
  if (!params) return template;

  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];

    return value === undefined ? match : String(value);
  });
}

/** The error catalogues, for the completeness tests. */
export const ERROR_CATALOGUES: Readonly<Record<Locale, ErrorCatalogue>> = CATALOGUES;
