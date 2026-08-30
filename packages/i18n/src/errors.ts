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
/**
 * The message for an API REFUSAL, read from the response body.
 *
 * ## The bug this fixes
 *
 * Bashar hit «حدث خطأ ما. حاول مرة أخرى.» replacing a dispute photograph on 2026-08-30. The API
 * had answered precisely — `upload.image_too_small`, with `params: { min: 400 }` — and the console
 * showed nothing of it.
 *
 * Every caller resolved the CODE and dropped the PARAMS. `errorMessage` then found a template
 * carrying `{min}`, could not fill it, and did the right thing with the wrong information: it
 * refuses to print a surviving placeholder and falls back to the generic sentence. So **twenty-six
 * parameterised messages could never render in any app** — every size limit, every range, every
 * «الحد الأقصى {max}» — and each one read as «something went wrong».
 *
 * It survived because nothing was broken enough to fail: the screen showed Arabic, just the wrong
 * Arabic, and each app had written its own two-line extraction that looked obviously correct.
 *
 * ## So there is one reader, here
 *
 * It takes the BODY rather than a code, because the params only exist on the body. `code` first,
 * then `message` — the console's own BFF routes refuse malformed bodies before the API is called
 * and put the code in `message`, having no upstream response to copy a `code` from.
 */
/**
 * The `params` of an API refusal, cleaned to what a message can substitute.
 *
 * Two apps had written this privately — `asParams` in `checkout-form` and again in `auth-form` —
 * and the five other refusal readers had not written it at all, which is why every parameterised
 * message read as «حدث خطأ ما». Strings and numbers only: a nested object or an array in a
 * template would render as `[object Object]`, and the body is not ours to trust in shape.
 */
export function errorParams(body: unknown): Record<string, string | number> | undefined {
  const raw =
    typeof body === 'object' && body !== null && 'params' in body
      ? (body as { params?: unknown }).params
      : undefined;

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;

  const clean: Record<string, string | number> = {};

  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string' || typeof value === 'number') clean[key] = value;
  }

  return Object.keys(clean).length > 0 ? clean : undefined;
}

export function errorFromBody(body: unknown, locale: Locale = DEFAULT_LOCALE): string {
  if (typeof body !== 'object' || body === null) return errorMessage(null, locale);

  const params = errorParams(body);

  if ('code' in body && typeof body.code === 'string') {
    return errorMessage(body.code, locale, params);
  }

  if ('message' in body && typeof body.message === 'string') {
    return errorMessage(body.message, locale, params);
  }

  return errorMessage(null, locale);
}

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
  const filled = params
    ? template.replace(/\{(\w+)\}/g, (match, name: string) => {
        const value = params[name];

        return value === undefined ? match : String(value);
      })
    : template;

  /*
    A placeholder that survived is a BUG, and the generic message is the honest way to show it.

    Seventeen entries here carry one. If a caller resolves such a code without the values — because
    the API forgot to forward them, or a new parameterised message was added and one call site
    missed — the reader would otherwise be shown «يجب أن تكون كلمة المرور {min} أحرف على الأقل.»,
    which is what Bashar reported on the registration form (2026-08-14).

    Returning the generic sentence loses precision and keeps the page truthful. Stripping the
    placeholder instead was considered and rejected: «كلمة المرور أحرف على الأقل» is a broken
    sentence, and a broken sentence reads as a broken product rather than as a missing number.

    This is a NET, not the fix. The fix is that `ZodValidationPipe` and `app-error` both forward
    their parameters; `errors-complete.test.ts` holds the catalogues to agreeing on the names.
  */
  if (/\{\w+\}/.test(filled)) {
    return catalogue[GENERIC] ?? fallback[GENERIC] ?? '';
  }

  return filled;
}

/** The error catalogues, for the completeness tests. */
export const ERROR_CATALOGUES: Readonly<Record<Locale, ErrorCatalogue>> = CATALOGUES;
