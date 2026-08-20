import { HttpStatus } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { ERROR } from '@safra/contracts';
import { errorMessage } from '@safra/i18n';

import { CodedThrottlerGuard } from './coded-throttler.guard.js';
import { codeOf } from '../errors/app-error.js';

/**
 * The 429 has to be translatable, because a throttled customer is a customer reading a refusal.
 *
 * `@nestjs/throttler` answers `{"statusCode":429,"message":"ThrottlerException: Too Many Requests"}` —
 * no code, an English sentence, and the framework's class name in the body. Scenario 2 of the load
 * test found it on 2026-08-20 the loud way: 2,259,751 of 2,259,812 booking attempts were refused by
 * the limiter and every single one failed the scenario's own check that a refusal carries a code.
 *
 * `safra/no-hardcoded-text` cannot see this, and never could — the string lives in a dependency. So
 * the guard is what holds the rule, and this is what holds the guard.
 */
describe('CodedThrottlerGuard', () => {
  /** Reaching the protected method the way Nest reaches it, without assembling a container. */
  const refuse = (): unknown => {
    const guard = new CodedThrottlerGuard(
      // The guard under test never touches its collaborators before throwing.
      [] as never,
      {} as never,
      {} as never,
    );

    try {
      /*
        `void` because the method's signature returns a promise it never resolves — it throws
        synchronously. Awaiting a promise that is never returned would hang the test.
      */
      void (
        guard as unknown as { throwThrottlingException: () => Promise<void> }
      ).throwThrottlingException();
    } catch (error) {
      return error;
    }

    return undefined;
  };

  it('refuses with 429', () => {
    const error = refuse() as { getStatus: () => number };

    expect(error.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
  });

  it('carries the error code a client can translate', () => {
    expect(codeOf(refuse())).toBe(ERROR.REQUEST_TOO_MANY);
  });

  /**
   * The body's `message` is for logs, and it comes from the catalogue like every other one — so the
   * English is written once, in the place a translator can find it.
   */
  it('resolves its English message from the catalogue', () => {
    const error = refuse() as { getResponse: () => { message?: unknown } };

    expect(error.getResponse().message).toBe(errorMessage(ERROR.REQUEST_TOO_MANY, 'en'));
  });

  /**
   * The regression, stated as the thing that must NOT be in the body.
   *
   * A response that names the framework tells a caller what to look up exploits for, and it is free
   * to withhold.
   */
  it('does not name the framework or send a bare English sentence', () => {
    const body = JSON.stringify(
      (refuse() as { getResponse: () => unknown }).getResponse(),
    );

    expect(body).not.toContain('ThrottlerException');
    expect(body).not.toContain('Too Many Requests');
  });

  /**
   * It must not say WHICH limiter fired.
   *
   * The `account` throttler only applies where a request body names an email, so "you hit the
   * per-account limit" would confirm the address is one the API treats as an account — an
   * enumeration oracle of the kind `O-sec-2` closed on registration.
   */
  it('does not reveal which limiter refused the request', () => {
    const body = JSON.stringify(
      (refuse() as { getResponse: () => unknown }).getResponse(),
    ).toLowerCase();

    expect(body).not.toContain('account');
    expect(body).not.toContain('default');
  });
});
