import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

import { runWithRequestContext } from './request-context.js';

/** Standard header, and the one Cloudflare and most load balancers already set. */
const HEADER = 'x-request-id';

/**
 * An inbound ID must look like one before it is trusted.
 *
 * The value ends up in every log line for the request. Without a bound, a client can
 * inject newlines and forge whole log entries, or attach a megabyte of text to every
 * line. Restricting it to a modest run of URL-safe characters removes both.
 */
const SAFE_ID = /^[A-Za-z0-9_-]{8,128}$/;

/**
 * Gives every request a correlation ID and makes it ambiently available.
 *
 * Reuses an upstream `x-request-id` when there is one, so a trace started at the load
 * balancer or in the web app stays a single trace rather than becoming two unrelated
 * halves at the API boundary. Generates one otherwise.
 *
 * Always echoed back in the response header. That is what lets a support conversation
 * begin with an ID rather than "it broke around two o'clock" — the customer or the
 * browser devtools has the exact key to the request.
 */
export function requestIdMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const inbound = request.header(HEADER);
  const requestId = inbound && SAFE_ID.test(inbound) ? inbound : randomUUID();

  response.setHeader(HEADER, requestId);

  /**
   * `next()` is called INSIDE the context, so everything downstream — guards,
   * interceptors, controllers, services, and anything they await — runs within it.
   * Calling it outside would leave the context covering only this function.
   */
  /*
    The ORIGIN travels with the correlation ID, so `AuditService` can record §15's IP and device
    without every administrative service taking a parameter it would only pass along.

    `request.ip` honours Express's `trust proxy` setting, which is how it stays correct behind the
    load balancer rather than recording the proxy on every row.
  */
  runWithRequestContext(
    {
      requestId,
      ipAddress: request.ip,
      userAgent: request.header('user-agent'),
    },
    () => {
      next();
    },
  );
}
