import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

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
 * Level follows the status. Logging every rejected request at `error` would make the
 * level meaningless; a 4xx is a warning worth counting, a 5xx is a real error.
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

    // `request.path` only — never `originalUrl`, which carries the query string.
    const line = `${request.method} ${request.path} ${statusCode} ${ms.toFixed(1)}ms`;

    if (statusCode >= 500) logger.error(line);
    else if (statusCode >= 400) logger.warn(line);
    else logger.log(line);
  });

  next();
}
