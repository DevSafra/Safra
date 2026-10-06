import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

import type { NextFunction, Request, Response } from 'express';

/**
 * Which visitor a request from one of SAFRA's own front ends is made on behalf of.
 *
 * ## The defect this closes (Bashar, 2026-10-06)
 *
 * The three Next apps render on the server and call this API from there, so for most routes the
 * address this API saw was the WEB SERVER's. Every throttle here keys on `req.ip`, so every visitor
 * on one web instance shared one bucket: thirty session refreshes a minute for the whole site, sixty
 * quotes, a hundred and twenty per route. One script, or an ordinary busy minute, and the account
 * pages kept an expired session, checkout read «غير متاح» and property pages 404'd for everybody.
 * Measured: `X-RateLimit-Remaining` dropped by one per web render.
 *
 * ## Why a shared secret rather than trusting another proxy hop
 *
 * Raising `trust proxy` would make the web servers trusted hops — and with them anybody else who
 * reaches the API's port and sends `X-Forwarded-For`, which is how a caller chooses its own bucket
 * (see `account-tracker.ts`). A hop count also depends on the network layout, which is not chosen
 * yet. A secret only the three front ends hold works behind any host: the claim is honoured because
 * of WHO made it, not because of where it arrived from.
 *
 * ## What a caller without the secret gets
 *
 * Exactly what it got before: `req.ip` under `trust proxy`. The headers are not an error, they are
 * IGNORED — an internet client that sends them is an ordinary client, so there is nothing to probe.
 *
 * The header names are mirrored in `packages/session/src/internal-caller.ts`, which builds them;
 * `internal-caller.test.ts` drives this middleware with that builder so the two cannot drift.
 */
export const INTERNAL_CALLER_HEADER = 'x-safra-internal-caller';
export const VISITOR_ADDRESS_HEADER = 'x-safra-visitor-ip';

/**
 * Hashed first so the comparison is between two equal-length digests.
 *
 * `timingSafeEqual` throws on unequal lengths, and checking the length first would itself say how
 * long the secret is. A digest of each side makes every comparison the same 32 bytes.
 */
function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

export function secretMatches(expected: Buffer, presented: string): boolean {
  return timingSafeEqual(expected, digest(presented));
}

/** One header value, or nothing — a repeated header is not a value this protocol ever sends. */
function single(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined;
}

/**
 * The visitor's address, when — and only when — the request proves it came from a SAFRA front end.
 *
 * The address must also parse as one. It becomes a Redis key, an audit-log column and a log field,
 * so a value that is not an IP is refused rather than carried, even from a caller holding the
 * secret: the secret says who is speaking, not that what they forwarded is well formed.
 */
export function vouchedVisitorAddress(
  expected: Buffer | null,
  headers: Request['headers'],
): string | null {
  if (expected === null) return null;

  const presented = single(headers[INTERNAL_CALLER_HEADER]);
  const visitor = single(headers[VISITOR_ADDRESS_HEADER]);

  if (!presented || !visitor) return null;
  if (!secretMatches(expected, presented)) return null;

  return isIP(visitor) === 0 ? null : visitor;
}

/**
 * Express middleware that makes `req.ip` the visitor's address for a vouched request.
 *
 * ## Why `req.ip` itself, rather than a new field
 *
 * Every consumer already asks `req.ip`: the default throttler's tracker, the per-account tracker,
 * the audit interceptor, the request context the audit service reads, and a handful of controllers
 * that record where a sign-in came from. Overriding the one answer keeps them in agreement; a new
 * field would have to be threaded through each, and the one that was missed would go on charging
 * the web server's bucket.
 *
 * Shadowed on the INSTANCE — Express defines `ip` as a getter on the request prototype, so an own
 * property wins without touching anything another request sees.
 *
 * ## Both headers are removed, always
 *
 * Whether or not they were honoured. Nothing downstream has a reason to read them, and a secret
 * that stays on `req.headers` is one generic "log the request headers" away from a log line.
 *
 * MUST run before `requestIdMiddleware`, which copies `req.ip` into the request context.
 */
export function internalCallerMiddleware(
  secret: string | undefined,
): (request: Request, response: Response, next: NextFunction) => void {
  const expected = secret ? digest(secret) : null;

  return (request, _response, next) => {
    const visitor = vouchedVisitorAddress(expected, request.headers);

    delete request.headers[INTERNAL_CALLER_HEADER];
    delete request.headers[VISITOR_ADDRESS_HEADER];

    if (visitor !== null) {
      Object.defineProperty(request, 'ip', {
        value: visitor,
        configurable: true,
        enumerable: true,
      });
    }

    next();
  };
}
