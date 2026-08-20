import { HttpStatus } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { ERROR } from '@safra/contracts';

import { SecondFactorRequiredException } from '../../auth/auth.service.js';
import { SignInRefundInterceptor } from './sign-in-refund.interceptor.js';
import { recordThrottleKey } from './throttle-keys.js';
import { unauthorized } from '../errors/app-error.js';

/**
 * The per-IP ceiling must count FAILED sign-ins only (`O-sec-3`).
 *
 * Scenario 4 of the load test, 2026-08-20: a legitimate customer with correct credentials, on the
 * same egress address as a stuffing run and well inside their own per-account allowance, signed in
 * 0 times out of 30. Everybody behind one carrier-grade NAT address shares that ceiling, and in the
 * Syrian market that is thousands of subscribers.
 */

/** A storage double that records refunds instead of talking to Redis. */
function storage() {
  const refunded: { key: string; throttler: string }[] = [];

  return {
    refunded,
    refund(key: string, throttler: string) {
      refunded.push({ key, throttler });

      return Promise.resolve();
    },
  };
}

function contextFor(request: object) {
  return { switchToHttp: () => ({ getRequest: () => request }) } as never;
}

/**
 * Runs the interceptor over an outcome and settles, so the `tap` has fired.
 *
 * `SUCCESS` is a sentinel rather than a string: the parameter also carries thrown exceptions, and
 * `'success' | unknown` collapses to `unknown`, which reads as though anything is accepted.
 */
const SUCCESS = Symbol('a sign-in that worked');

async function run(outcome: unknown, options: { counted?: boolean } = {}) {
  const request = {};
  const store = storage();

  if (options.counted !== false) {
    recordThrottleKey(request, 'default', 'ip-key');
    recordThrottleKey(request, 'account', 'account-key');
  }

  const interceptor = new SignInRefundInterceptor(store as never);
  const handler = {
    handle: () => (outcome === SUCCESS ? of({ ok: true }) : throwError(() => outcome)),
  };

  await new Promise<void>((resolve) => {
    interceptor.intercept(contextFor(request), handler as never).subscribe({
      next: () => resolve(),
      error: () => resolve(),
    });
  });

  return store.refunded;
}

describe('SignInRefundInterceptor', () => {
  it('refunds the per-IP hit when the sign-in succeeds', async () => {
    expect(await run(SUCCESS)).toEqual([{ key: 'ip-key', throttler: 'default' }]);
  });

  /**
   * The password was accepted and only the code is outstanding. A staff sign-in costs two requests
   * to `/auth/login`, and charging the first to the failure budget would make every staff member
   * twice as expensive as a customer to the address they share.
   */
  it('refunds when the password was right and only the second factor is pending', async () => {
    const refunded = await run(new SecondFactorRequiredException());

    expect(refunded).toEqual([{ key: 'ip-key', throttler: 'default' }]);
  });

  it('does not refund a wrong password', async () => {
    expect(await run(unauthorized(ERROR.AUTH_CREDENTIALS_INVALID))).toEqual([]);
  });

  it('does not refund a wrong authenticator code', async () => {
    expect(await run(unauthorized(ERROR.AUTH_CODE_INVALID))).toEqual([]);
  });

  /**
   * A locked account is a failed sign-in. Nobody got in, and at scale it is what an attack
   * produces — so it belongs in the budget the ceiling is now counting.
   */
  it('does not refund an attempt against a locked account', async () => {
    expect(await run(unauthorized(ERROR.AUTH_LOCKED))).toEqual([]);
  });

  /**
   * THE security property of this change. Ten a minute per (IP, account) bounds the Argon2id
   * verifications a single address can force for a single account; refunding it too would let
   * anybody holding one valid credential drive password checks at an unbounded rate.
   */
  it('never refunds the per-account throttler', async () => {
    const refunded = await run(SUCCESS);

    expect(refunded.some((entry) => entry.throttler === 'account')).toBe(false);
  });

  /**
   * The realistic case is `increment` having failed open because Redis was unreachable. Nothing
   * was counted, so there is nothing to give back — and a refund against a key that was never
   * incremented would hand out budget that was never spent.
   */
  it('refunds nothing when the request was never counted', async () => {
    expect(await run(SUCCESS, { counted: false })).toEqual([]);
  });

  /** A successful sign-in must not be turned into a failure by a refund that goes wrong. */
  it('does not fail the request when the refund throws', async () => {
    const request = {};
    recordThrottleKey(request, 'default', 'ip-key');

    const interceptor = new SignInRefundInterceptor({
      refund: () => Promise.reject(new Error('redis is down')),
    } as never);

    const delivered = await new Promise<unknown>((resolve, reject) => {
      interceptor
        .intercept(contextFor(request), { handle: () => of({ ok: true }) } as never)
        .subscribe({ next: resolve, error: reject });
    });

    expect(delivered).toEqual({ ok: true });
  });

  /** The exception type the refund keys on has to keep answering 401 with its code. */
  it('recognises the second-factor exception by its code, not its wording', () => {
    const exception = new SecondFactorRequiredException();

    expect(exception.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    expect((exception.getResponse() as { code: string }).code).toBe(
      ERROR.AUTH_CODE_REQUIRED,
    );
  });
});
