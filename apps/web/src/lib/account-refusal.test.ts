import { describe, expect, it } from 'vitest';

import { refusalFor } from './account';

/**
 * What an account page is allowed to conclude from a refused status.
 *
 * ## The assertion that matters is the negative one
 *
 * `refusalFor(403)` must not be `'unauthenticated'`. That single equivalence — 401 and 403 folded
 * into one outcome — put «انتهت الجلسة، سجّل الدخول مجدداً» in front of anybody whose account has
 * no customer profile, which is every one of the platform's ~3,000 partner accounts if they sign
 * in on the customer site. The sentence is false, and the action it recommends produces the same
 * token, the same 403 and the same sentence: a loop with no exit and a misleading cause.
 *
 * Nothing else would have caught it. The API's own tests are right — it answers a specific coded
 * 403 — and every page renders exactly what this function tells it to. The defect lived entirely
 * in the translation between them, which is why the translation is now a named function with a
 * test rather than two conditions inside a fetch helper.
 */
describe('refusalFor', () => {
  it('treats an expired token as a sign-in prompt', () => {
    expect(refusalFor(401)).toBe('unauthenticated');
  });

  /** THE test. A valid session that is refused must never be reported as no session. */
  it('never reports a 403 as an expired session', () => {
    expect(refusalFor(403)).not.toBe('unauthenticated');
    expect(refusalFor(403)).toBe('failed');
  });

  /**
   * Everything else falls through, so `authedFetch` can tell an ordinary failure (which becomes
   * `failed` anyway) from a body it should parse. A 404 answered as a refusal here would hide a
   * mistyped path behind a load-failure message.
   */
  it('leaves every other status to the caller', () => {
    for (const status of [200, 201, 204, 400, 404, 409, 429, 500, 503]) {
      expect(refusalFor(status), String(status)).toBeNull();
    }
  });
});
