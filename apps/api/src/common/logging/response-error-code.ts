import { isErrorCode, type ErrorCode } from '@safra/contracts';

/**
 * The error code of the response being written, parked where the ACCESS LOG can read it.
 *
 * ## Why the access log needs it
 *
 * `requestLogMiddleware` runs before the guards and hooks `finish`, which is what lets it record a
 * rejection no interceptor would ever see. The price is that it knows only the status code, and a
 * status code is not enough to separate two 5xx that mean opposite things: `request.capacity` is
 * the platform being busy, which is load, and everything else at 500 is breakage. One should page
 * and the other should not — see signal 12 in `docs/alerting.md`.
 *
 * `AppExceptionFilter` knows the code and runs before the response is written, so it leaves the
 * code here on the way past.
 *
 * ## Why `res.locals`
 *
 * It is Express' own per-response scratch space, it dies with the response, and it is already how
 * middleware and handlers pass values along a request. A module-level `WeakMap` would work too and
 * would be one more thing to explain.
 */
const LOCALS_KEY = 'safraErrorCode';

/** Carrier type, so this module does not have to import Express' `Response`. */
interface HasLocals {
  locals: Record<string, unknown>;
}

/** The same, for the READ side, where `locals` may not be there at all — see `responseErrorCode`. */
interface MayHaveLocals {
  locals?: Record<string, unknown> | undefined;
}

/** Records the code of the error response about to be written. */
export function tagResponseErrorCode(response: HasLocals, code: ErrorCode): void {
  response.locals[LOCALS_KEY] = code;
}

/**
 * The code recorded for this response, if one was.
 *
 * Validated rather than cast: `res.locals` is a shared bag any middleware can write to, and a log
 * line is not the place to discover that something else claimed the same key.
 *
 * `locals` is optional here although Express always provides it. The only caller is the access log,
 * which is the one piece of the request pipeline that must never be the reason a request fails —
 * it runs first, it wraps everything, and a response object that is not quite Express' own (a
 * test double, a future adapter) must degrade to a line without a code rather than to a 500.
 */
export function responseErrorCode(response: MayHaveLocals): ErrorCode | undefined {
  const value = response.locals?.[LOCALS_KEY];

  return typeof value === 'string' && isErrorCode(value) ? value : undefined;
}
