import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';

import { ERROR, type ErrorCode } from '@safra/contracts';
import { errorMessage } from '@safra/i18n';

import { tagResponseErrorCode } from '../logging/response-error-code.js';

/**
 * The last thing that touches an error before it becomes a response.
 *
 * ## The two defects it closes (`O-api-1`, measured 2026-08-20)
 *
 * 1. **A capacity condition answered 500.** Under scenario 2's deliberate concentration — 200
 *    concurrent booking transactions against 20 units, each holding a pool connection while it
 *    waits on a row lock another transaction holds — the pool of `DATABASE_POOL_MAX=20` is
 *    exhausted and `connectionTimeoutMillis` fires. 1,680 of 12,231 requests answered 500. A lock
 *    queue becoming a connection queue is inherent here: the exclusion constraint IS the
 *    reservation mechanism. But 500 is the wrong ANSWER for it — unretryable to a client, and it
 *    pages whoever owns the 5xx signal in `docs/alerting.md` for load rather than for breakage.
 * 2. **A 500 carried no `code`.** `{"statusCode":500,"message":"Internal server error"}` — the one
 *    refusal in the whole API a client could not resolve into the reader's language, although
 *    `request.unknown` exists and is translated in all three locales.
 *
 * ## What it deliberately does NOT do
 *
 * An `HttpException` is passed through **untouched**. Every deliberate refusal in this codebase is
 * built by `app-error.ts` and already carries a code; re-shaping the handful that do not would
 * change response bodies this filter has no mandate to change, and `app-error.ts` is explicit
 * about why a status→code table is the wrong instrument. The un-coded framework exceptions that
 * remain are recorded in the future-work register rather than fixed here as a side effect.
 *
 * ## Why the capacity set is so narrow
 *
 * A 503 with `Retry-After` is an INSTRUCTION to retry, and this API accepts non-idempotent writes.
 * Telling a client to repeat a booking that may already have been created is worse than the 500 it
 * replaces. So the set below is exactly the conditions under which the request **provably never
 * reached the database**: no statement was sent, so there is nothing to have half-happened, and a
 * retry is safe for a write as well as a read.
 *
 * That is why an outright connection failure (`ECONNREFUSED`, a dead socket mid-query), a
 * statement timeout, a deadlock and a full disk are all left as 500. They are either ambiguous
 * about what happened, or they are breakage that SHOULD page.
 */

/**
 * `pg-pool` reports both of these as a plain `Error` with no `code`, so the message is the only
 * thing to match on. Taken from `pg-pool@3.14.0` lines 224 and 276 rather than remembered:
 *
 * - `timeout exceeded when trying to connect` — the wait for a free pooled connection expired.
 *   This is the one scenario 2 produced 1,680 times.
 * - `Connection terminated due to connection timeout` — the TCP connect itself expired.
 *
 * Both happen while ACQUIRING a connection, before any statement is written to a socket. Matched
 * on the whole message, not a substring of our own choosing, so a reworded message in a future
 * release stops matching and the condition reverts to a 500 — loudly wrong rather than quietly
 * wrong. `app-exception.filter.test.ts` pins the strings.
 */
const POOL_ACQUISITION_MESSAGES: ReadonlySet<string> = new Set([
  'timeout exceeded when trying to connect',
  'Connection terminated due to connection timeout',
]);

/**
 * PostgreSQL `SQLSTATE`s that mean the server refused the CONNECTION.
 *
 * Every one of these is raised during connection establishment, so — like the two messages above —
 * no statement had been sent. Class 53 codes that are raised mid-statement (`53100` disk_full,
 * `53200` out_of_memory) are deliberately absent: they are breakage, they are not fixed by
 * retrying in two seconds, and a 503 would hide them from the alert that should be firing.
 */
const CONNECTION_REFUSED_SQLSTATES: ReadonlySet<string> = new Set([
  '53300', // too_many_connections
  '53400', // configuration_limit_exceeded
  '57P03', // cannot_connect_now — the server is still starting
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08004', // sqlserver_rejected_establishment_of_sqlconnection
]);

/**
 * `Retry-After`, in seconds, jittered.
 *
 * A fixed value synchronises every client that was refused in the same instant into one retry, so
 * the second wave is as concentrated as the first and the pool is exhausted again on schedule.
 * Spreading them over a few seconds is the whole reason the header is worth sending; the range is
 * short because a pool timeout clears in the time it takes the transactions ahead to commit, not
 * in minutes.
 */
const RETRY_AFTER_MIN_SECONDS = 1;
const RETRY_AFTER_MAX_SECONDS = 5;

/** How far down a `cause` chain to look. `pg-pool` wraps once; nothing here wraps deeper. */
const MAX_CAUSE_DEPTH = 3;

/** Every error in a `cause` chain, outermost first, bounded so a cycle cannot hang the filter. */
function chain(error: unknown): unknown[] {
  const seen: unknown[] = [];
  let current = error;

  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current != null; depth += 1) {
    if (seen.includes(current)) break;
    seen.push(current);
    current = (current as { cause?: unknown }).cause;
  }

  return seen;
}

/**
 * Whether this error means the request never reached the database.
 *
 * Exported for the test, which is the honest reason: asserting on the classification directly is
 * what keeps the two lists above under test without standing up a pool.
 */
export function isCapacityFailure(error: unknown): boolean {
  return chain(error).some((link) => {
    if (typeof link !== 'object' || link === null) return false;

    const { message, code } = link as { message?: unknown; code?: unknown };

    if (typeof message === 'string' && POOL_ACQUISITION_MESSAGES.has(message))
      return true;

    return typeof code === 'string' && CONNECTION_REFUSED_SQLSTATES.has(code);
  });
}

/**
 * A body the parser refused to buffer.
 *
 * `body-parser` throws `PayloadTooLargeError` with `type: 'entity.too.large'` BEFORE any guard,
 * pipe or handler runs, so nothing downstream can turn it into a sensible answer — it arrives here
 * as an unhandled error and, until 2026-08-21, was answered 500 «حدث خطأ ما».
 *
 * That is a bad answer twice over. It tells the caller the platform broke when the platform worked
 * exactly as configured, and it hides the one fact that would let them fix it: the file is too big.
 * Bashar found it uploading a 400KB signed contract against a 100kb default nobody had noticed.
 *
 * Matched on `type` rather than on the message: the message is English prose from a dependency and
 * would change under us, while the type is body-parser's own stable discriminator.
 */
export function isBodyTooLarge(error: unknown): boolean {
  return chain(error).some((link) => {
    if (typeof link !== 'object' || link === null) return false;

    return (link as { type?: unknown }).type === 'entity.too.large';
  });
}

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AppExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    /**
     * Nothing can be done once the status line is out — a streamed media response that fails
     * halfway is the realistic case. Writing a second body would corrupt the first.
     */
    if (response.headersSent) {
      this.logger.error(
        `Error after the response had started; the client sees a truncated body. ` +
          `${describe(exception)}`,
      );
      return;
    }

    if (exception instanceof HttpException) {
      this.passThrough(exception, response);
      return;
    }

    /*
      Before the capacity check: an oversized body is a CLIENT problem with a precise remedy, and
      answering it as a capacity failure would tell the caller to retry the very thing that cannot
      succeed.
    */
    if (isBodyTooLarge(exception)) {
      this.logger.warn(`Refused an oversized request body. ${describe(exception)}`);

      response.status(HttpStatus.PAYLOAD_TOO_LARGE).json({
        statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
        code: ERROR.REQUEST_BODY_TOO_LARGE,
        message: 'Request body too large.',
      });

      return;
    }

    if (isCapacityFailure(exception)) {
      this.refuseForCapacity(exception, response);
      return;
    }

    this.unexpected(exception, response);
  }

  /**
   * Reproduces Nest's own handling of an `HttpException`, byte for byte.
   *
   * An object body is sent as-is; a string body becomes `{statusCode, message}`. Both are what
   * `BaseExceptionFilter` does, and matching it exactly is the point — this filter is here for the
   * errors that were NOT `HttpException`s, and it must not become a second opinion about the ones
   * that were.
   */
  private passThrough(exception: HttpException, response: Response): void {
    const status = exception.getStatus();
    const payload = exception.getResponse();
    const body =
      typeof payload === 'object' && payload !== null
        ? payload
        : { statusCode: status, message: payload };

    const code = (body as { code?: unknown }).code;

    // Tagged so the access log can name a 4xx by its code, not only by its status.
    if (typeof code === 'string') tagResponseErrorCode(response, code as ErrorCode);

    response.status(status).json(body);
  }

  /** 503 + `Retry-After`: busy, not broken, and safe to send again. */
  private refuseForCapacity(exception: unknown, response: Response): void {
    const seconds =
      RETRY_AFTER_MIN_SECONDS +
      Math.floor(Math.random() * (RETRY_AFTER_MAX_SECONDS - RETRY_AFTER_MIN_SECONDS + 1));

    /**
     * `warn`, not `error`, and this is the point of the whole item: a capacity refusal is the
     * platform telling the truth about its own load. Logged at `error` it would be
     * indistinguishable from breakage in the one signal that pages somebody.
     */
    this.logger.warn(
      `At capacity — no database connection could be acquired, so the request was ` +
        `refused before it started. Answered 503, retry after ${seconds}s. ` +
        `${describe(exception)}`,
    );

    tagResponseErrorCode(response, ERROR.REQUEST_CAPACITY);

    response
      .status(HttpStatus.SERVICE_UNAVAILABLE)
      .header('Retry-After', String(seconds))
      .json(bodyFor(HttpStatus.SERVICE_UNAVAILABLE, ERROR.REQUEST_CAPACITY));
  }

  /**
   * 500, with a code the client can translate and a stack the client never sees.
   *
   * The body is generic on purpose and was verified against the real thing under load: no SQL, no
   * bound parameters, no guest email. The detail goes to the log, where the correlation ID
   * established by `requestIdMiddleware` ties it back to the access-log line.
   */
  private unexpected(exception: unknown, response: Response): void {
    this.logger.error(
      `Unhandled error; answered 500. ${describe(exception)}`,
      exception instanceof Error ? framesOnly(exception) : undefined,
    );

    tagResponseErrorCode(response, ERROR.REQUEST_UNKNOWN);

    response
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json(bodyFor(HttpStatus.INTERNAL_SERVER_ERROR, ERROR.REQUEST_UNKNOWN));
  }
}

/**
 * The same `{statusCode, code, message}` shape `app-error.ts` produces.
 *
 * Built here rather than by calling those helpers because they return an exception to throw, and
 * this is the end of the line — there is nothing left to throw it at.
 */
function bodyFor(status: number, code: ErrorCode): Record<string, unknown> {
  return { statusCode: status, code, message: errorMessage(code, 'en') };
}

/** Long enough to identify a statement, short enough that one error cannot flood a log. */
const MAX_LOGGED_MESSAGE = 600;

function truncate(text: string): string {
  return text.length <= MAX_LOGGED_MESSAGE
    ? text
    : `${text.slice(0, MAX_LOGGED_MESSAGE)}… (${text.length} chars)`;
}

/**
 * One error's message, with the BOUND PARAMETERS removed.
 *
 * ## The finding this exists for (2026-08-20, live)
 *
 * `DrizzleQueryError`'s message is built as `Failed query: <sql>\nparams: <values>` — the values,
 * not the placeholders. Verified against the running API while proving the 503 path: a failing
 * sign-in wrote `params: someone@safra.test,1` to the log. On the paths that write a user row the
 * same line would carry the Argon2id hash and the encrypted TOTP secret.
 *
 * `JsonLogger` cannot help. Its redaction works on object KEYS, and this is one flat string.
 *
 * This is not new — Nest's default filter logged the exception too — but this filter is what logs
 * it now, and rule 1 is explicit that full PII never goes to a log.
 *
 * **The SQL itself is kept.** It is the useful half, it names no person, and an error line that
 * cannot say which statement failed is not worth writing. Only the values go.
 */
function safeMessage(error: Error): string {
  const { query, params } = error as { query?: unknown; params?: unknown };

  if (typeof query === 'string' && Array.isArray(params)) {
    return `Failed query: ${truncate(query)} — ${params.length} bound parameter(s), NOT logged`;
  }

  return truncate(error.message);
}

/**
 * For the LOG only. Never reaches a client — see the note on the generic body.
 *
 * Walks the `cause` chain so the underlying driver error is described too: its `code` is the
 * SQLSTATE, which is the single most useful thing in a database failure and is not personal data.
 */
function describe(exception: unknown): string {
  if (!(exception instanceof Error)) return `Non-Error thrown: ${typeof exception}`;

  return chain(exception)
    .filter((link): link is Error => link instanceof Error)
    .map((link) => {
      const code = (link as { code?: unknown }).code;
      const sqlstate = typeof code === 'string' ? ` [${code}]` : '';

      return `${link.name}${sqlstate}: ${safeMessage(link)}`;
    })
    .join(' ← ');
}

/**
 * A stack with its first line removed.
 *
 * `Error.prototype.stack` begins with `name: message`, so logging the stack of a
 * `DrizzleQueryError` re-introduces exactly the bound parameters `safeMessage` just took out. The
 * frames are what a stack is FOR; the message is already on the line above it.
 */
function framesOnly(error: Error): string | undefined {
  const stack = error.stack;

  if (!stack) return undefined;

  const firstFrame = stack.indexOf('\n    at ');

  return firstFrame === -1 ? undefined : stack.slice(firstFrame + 1);
}
