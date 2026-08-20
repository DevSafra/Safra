import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { ERROR } from '@safra/contracts';

import { responseErrorCode } from './response-error-code.js';

/**
 * Probes run every few seconds per replica and would drown everything else. They
 * are the one thing genuinely not worth a line each.
 */
const SILENT_PATHS = new Set(['/api/v1/health', '/api/v1/health/ready']);

const logger = new Logger('Request');

/**
 * One log line per request, written when the response finishes.
 *
 * ## Why this was missing and why it matters
 *
 * Correlation IDs reached every log line — but only lines something else already
 * wrote. A request that simply succeeded produced no output, so the id could not
 * trace the ordinary case. Verified on 2026-08-02: a failed login and a password
 * reset produced one line between them, and only because SMTP was unreachable.
 *
 * Without this there is no traffic visibility, no latency data (so the p95 budget in
 * the project rules is unmeasurable), and no way to answer "what did this address
 * do?" during an incident — a security question, not merely an operational one.
 *
 * ## Middleware, not an interceptor
 *
 * This began as a Nest interceptor and silently missed the most important traffic:
 * guards run BEFORE interceptors, so every 401 and 403 — the rejections an
 * investigation actually cares about — was invisible, as was every 404 that matched
 * no route. Measured, not assumed: a `403` from `PermissionsGuard` produced no line
 * while a `401` thrown inside a handler did. Middleware runs before the guards and
 * hooks `finish`, so it records the outcome whatever produced it.
 *
 * ## What is deliberately NOT logged
 *
 * The query string, always. It is the part of a URL that routinely carries tokens —
 * `SANCTIONS_FEED_URL` is a live reminder that credentials end up there. Bodies and
 * headers are excluded for the same reason. The path is kept in full: booking and
 * partner references are identifiers rather than secrets, and an access log without
 * them cannot answer what it exists for.
 *
 * Level follows the status, with ONE exception. Logging every rejected request at `error` would
 * make the level meaningless; a 4xx is a warning worth counting, a 5xx is a real error. The
 * exception is `request.capacity` — a 503 that says the pool was full and the request never
 * started. That is the platform reporting its own load, not breakage, and at `error` it would be
 * indistinguishable from the 500s that must page somebody (`O-api-1`, and signal 12 in
 * `docs/alerting.md`). The code is left on the response by `AppExceptionFilter`.
 */
export function requestLogMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (SILENT_PATHS.has(request.path)) {
    next();
    return;
  }

  const started = process.hrtime.bigint();

  /**
   * `finish` rather than `close`: `close` also fires when the client disconnects
   * early, which would report a status that was never sent.
   */
  response.once('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1_000_000;
    const { statusCode } = response;

    const code = responseErrorCode(response);

    /*
      `request.path` only — never `originalUrl`, which carries the query string. The error code is
      appended because it is what makes the line QUERYABLE: "5xx that are not request.capacity" is
      the alert, and deriving it from prose is how alerting rules rot.
    */
    const line =
      `${request.method} ${request.path} ${statusCode} ${ms.toFixed(1)}ms` +
      (code ? ` ${code}` : '');

    if (statusCode >= 500 && code !== ERROR.REQUEST_CAPACITY) logger.error(line);
    else if (statusCode >= 400) logger.warn(line);
    else logger.log(line);
  });

  next();
}
