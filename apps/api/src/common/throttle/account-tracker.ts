import { createHash } from 'node:crypto';

import type { ExecutionContext } from '@nestjs/common';

/**
 * Rate-limit tracking for endpoints that name an account.
 *
 * ## The problem this solves
 *
 * Throttling `POST /auth/login` on IP alone means one person fumbling their password consumes the
 * budget for everyone sharing that egress address. In Syria — where SAFRA's partners are — that is
 * not a corner case: carrier-grade NAT puts thousands of subscribers behind one address, and a
 * single hotel's front desk retrying a typo can lock out every other partner on the same carrier.
 * The symptom is «محاولات كثيرة» on a first attempt, which reads as the product being broken.
 *
 * ## Why the key is IP **and** email, not email alone
 *
 * Keying on email alone would fix the NAT problem and introduce a worse one: anybody who knows an
 * address could spend that account's budget from anywhere and keep the real owner locked out. A
 * targeted denial of service against one person's ability to sign in, available to a stranger.
 *
 * IP + email gives each (person, network) pair its own budget. One NAT user cannot starve another,
 * and a stranger cannot starve anybody — provided the IP half cannot be chosen by the caller, which
 * is what `clientIp` below is about.
 *
 * ## What still protects against credential stuffing
 *
 * Three things, and this tracker is only one of them:
 *
 * 1. **A per-IP ceiling stays on every auth route** — tighter than the global floor. An attacker
 *    cycling a thousand addresses from one host is bounded by it whatever emails they use, which
 *    is exactly the shape of a stuffing run.
 * 2. **The per-ACCOUNT lockout is untouched** — five failed attempts locks the account for fifteen
 *    minutes, and that is enforced in `AuthService` against the user row, not against a counter in
 *    Redis. A distributed attack spread across a botnet still hits it on the fifth guess per
 *    account, because it does not care where the attempts came from.
 * 3. **This tracker itself** bounds attempts per (person, network) to ten a minute.
 *
 * The layer that was doing the credential-stuffing work is (1) and (2). Keying (3) on the account
 * as well removes collateral damage without removing either.
 *
 * ## The email is HASHED into the key
 *
 * Redis keys turn up in `MONITOR` output, in slow-query logs and in whatever a hosting provider
 * captures. An address is personal data (§14, GDPR), and there is no reason for the counter to
 * carry a readable one — a truncated SHA-256 distinguishes accounts just as well.
 */

/**
 * Where the client actually is — `req.ip`, and never the raw header.
 *
 * ## What this used to do, and why it was wrong
 *
 * It read `x-forwarded-for` and took the LEFT-MOST entry, on the reasoning that behind a proxy the
 * left-most entry is the original client. True, and unusable: a proxy APPENDS, so whatever the client
 * sent is still sitting on the left. The left-most entry is therefore client-controlled in every
 * deployment, including a correctly configured one.
 *
 * Two consequences, both measured against a running instance on 2026-08-20:
 *
 * 1. **The limit was bypassable.** Twenty wrong-password attempts against one account with a varying
 *    `X-Forwarded-For` drew twenty 401s and not one 429; the same twenty without the header were
 *    refused after ten.
 * 2. **Worse, it was aimable.** Forging the header to a VICTIM's address and naming their email
 *    spends *their* (person, network) budget, so the next real sign-in from that address is refused.
 *    That is the targeted denial of service this file's own header says keying on IP + email
 *    eliminated — "a stranger cannot starve anybody" — reintroduced by the one line that decided
 *    which IP.
 *
 * ## Why `req.ip` is the right answer
 *
 * Express computes it under `trust proxy`, which `main.ts` sets to `1` — exactly the number of hops
 * we terminate through. It walks XFF from the RIGHT and stops at the first address a trusted hop did
 * not vouch for, so entries a client prepended are ignored. Behind the documented single proxy that
 * is the real client address and a forged prefix changes nothing.
 *
 * The residual is unchanged and already recorded: `trust proxy` must match the actual number of
 * proxies. Two hops with the setting left at 1 makes `req.ip` forgeable again — for the rate limiter
 * and for everything else that asks where a request came from, which is the point of keeping one
 * answer rather than two.
 */
function clientIp(req: Record<string, unknown>): string {
  return typeof req['ip'] === 'string' && req['ip'].length > 0 ? req['ip'] : 'unknown';
}

/**
 * The account this request is about, if it names one.
 *
 * Read from the parsed body — Express' body parser runs as middleware, before guards, so it is
 * there. Normalised to lower case and trimmed, or `Bob@x.com` and `bob@x.com` would get a bucket
 * each and an attacker would simply vary the case.
 */
export function accountOf(req: Record<string, unknown>): string | null {
  const body = req['body'];

  if (typeof body !== 'object' || body === null) return null;

  const email = (body as Record<string, unknown>)['email'];

  if (typeof email !== 'string') return null;

  const normalised = email.trim().toLowerCase();

  return normalised.length > 0 ? normalised : null;
}

/** `ip|hash(email)` — see the note above about why both, and why hashed. */
export function accountTracker(req: Record<string, unknown>): string {
  const account = accountOf(req);
  const digest = account
    ? createHash('sha256').update(account).digest('hex').slice(0, 16)
    : 'anonymous';

  return `${clientIp(req)}|${digest}`;
}

/**
 * Whether the account throttler applies to this request.
 *
 * Keyed on the SHAPE of the request rather than on a decorator: an endpoint whose body carries an
 * email is an endpoint about one account, and that is precisely the set that should be throttled
 * per account — login, registration, password reset, email verification. A decorator would be one
 * more thing to remember on the next auth route somebody adds.
 */
export function skipUnlessAccountNamed(context: ExecutionContext): boolean {
  const req = context.switchToHttp().getRequest<Record<string, unknown>>();

  return accountOf(req) === null;
}
