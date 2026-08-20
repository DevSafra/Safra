import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

import { errorMessage } from '@safra/i18n';
import type { ErrorCode } from '@safra/contracts';

/**
 * Throwing an error the client can translate.
 *
 * ## The problem
 *
 * Every exception in this API used to carry an English sentence:
 *
 * ```ts
 * throw new NotFoundException('Booking not found.'); // the old form
 * ```
 *
 * Which reached an Arabic customer as English. `auth-form.tsx` mapped the API's `message`
 * straight into the error under the input, so the screens where wording matters most were the
 * ones that ignored the reader's language entirely. The staff console worked around it by
 * regex-matching the prose, for six of the eighty-four messages — the other seventy-eight
 * showed "something went wrong" while the API knew exactly what had happened.
 *
 * ## The shape
 *
 * `{ statusCode, code, message }`.
 *
 * - `code` is the contract. Stable, translatable, `booking.not_found`.
 * - `message` is the English text, kept for logs and for any client that has not been taught the
 *   codes. Not a UI string any more, which is what frees it to be reworded.
 * - `statusCode` is preserved because Nest's default filter omits it once the body is an object,
 *   and clients read it.
 *
 * ## Why the status stays at the call site
 *
 * A table mapping code → status would be tidier, and it would also silently move the 44 existing
 * `NotFoundException`s onto whatever the table said. One helper per status keeps that decision
 * exactly where it already is, so this migration cannot change a single response code — which
 * matters when the paths involved are authentication and payment.
 */

/** The body every error response carries. */
interface ErrorBody {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly message: string;
  /**
   * The values the message interpolates, forwarded so a CLIENT can interpolate them too.
   *
   * Seventeen catalogue entries carry a placeholder — `{min}`, `{maxMb}`, `{max}` and friends. The
   * body used to spend them on the English `message` and drop them, so a client resolving the code
   * against the reader's own language had nothing to fill the placeholder with and printed it
   * literally: «يجب أن تكون كلمة المرور {min} أحرف على الأقل.» on the registration form, reported by
   * Bashar (2026-08-14).
   *
   * Omitted entirely when there are none, so the common body is unchanged.
   */
  readonly params?: Readonly<Record<string, string | number>>;
}

/**
 * Builds the body, resolving the English text from the catalogue.
 *
 * `en` is not a default here, it is a decision: the API's own language for logs and non-localised
 * clients is English, independent of `DEFAULT_LOCALE` being Arabic. Localisation happens where the
 * reader is known, which is never inside the API.
 */
function body(status: number, code: ErrorCode, params?: ErrorParams): ErrorBody {
  return {
    statusCode: status,
    code,
    message: errorMessage(code, 'en', params),
    ...(params ? { params } : {}),
  };
}

/** Values interpolated into the message — `{maxNights}`, `{key}`. */
export type ErrorParams = Readonly<Record<string, string | number>>;

/** 400 — the request is malformed or the values are not acceptable. */
export function badRequest(code: ErrorCode, params?: ErrorParams): HttpException {
  return new BadRequestException(body(HttpStatus.BAD_REQUEST, code, params));
}

/** 401 — not authenticated, or the credential offered was wrong. */
export function unauthorized(code: ErrorCode, params?: ErrorParams): HttpException {
  return new UnauthorizedException(body(HttpStatus.UNAUTHORIZED, code, params));
}

/** 403 — authenticated, and not allowed. */
export function forbidden(code: ErrorCode, params?: ErrorParams): HttpException {
  return new ForbiddenException(body(HttpStatus.FORBIDDEN, code, params));
}

/**
 * 404 — absent, or deliberately reported absent.
 *
 * Also the answer for a record outside a scoped staff member's cities: a 403 would confirm it
 * exists, which is information they are not scoped to have. See `rbac/scope.sql.ts`.
 */
export function notFound(code: ErrorCode, params?: ErrorParams): HttpException {
  return new NotFoundException(body(HttpStatus.NOT_FOUND, code, params));
}

/** 409 — the request conflicts with the current state. */
export function conflict(code: ErrorCode, params?: ErrorParams): HttpException {
  return new ConflictException(body(HttpStatus.CONFLICT, code, params));
}

/**
 * 429 — refused by the rate limiter.
 *
 * Exists because `@nestjs/throttler` does not use these helpers: its `ThrottlerGuard` throws its own
 * `ThrottlerException`, whose body is `{statusCode, message: 'ThrottlerException: Too Many Requests'}`
 * — no code, an English sentence, and the framework's class name in a client-facing response.
 * `CodedThrottlerGuard` throws this instead so a throttled request answers in the same shape as
 * every other refusal.
 */
export function tooManyRequests(code: ErrorCode, params?: ErrorParams): HttpException {
  return new HttpException(
    body(HttpStatus.TOO_MANY_REQUESTS, code, params),
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

/** 503 — a dependency is unavailable and the client should retry. */
export function unavailable(code: ErrorCode, params?: ErrorParams): HttpException {
  return new ServiceUnavailableException(
    body(HttpStatus.SERVICE_UNAVAILABLE, code, params),
  );
}

/**
 * Reads the code back off a thrown exception.
 *
 * For the API's own call sites that catch and re-dispatch — and for tests, which is the honest
 * reason it is exported: asserting on a code is what makes them independent of the wording.
 */
export function codeOf(error: unknown): ErrorCode | undefined {
  if (!(error instanceof HttpException)) return undefined;

  const response = error.getResponse();

  if (typeof response !== 'object' || response === null) return undefined;

  const code = (response as { code?: unknown }).code;

  return typeof code === 'string' ? (code as ErrorCode) : undefined;
}
