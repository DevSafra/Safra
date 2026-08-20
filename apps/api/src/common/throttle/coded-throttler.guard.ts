import { Injectable, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

import { ERROR } from '@safra/contracts';

import { tooManyRequests } from '../errors/app-error.js';
import { recordThrottleKey } from './throttle-keys.js';

/**
 * `ThrottlerGuard`, refusing in the shape this API refuses everything else.
 *
 * ## What it replaces
 *
 * `@nestjs/throttler` throws its own `ThrottlerException`, and the body reaching the client is
 *
 *     {"statusCode":429,"message":"ThrottlerException: Too Many Requests"}
 *
 * Three things wrong with that, and the first two are binding rules rather than taste:
 *
 * 1. **No `code`.** "The API answers with an error CODE, not a sentence" — every other refusal in
 *    this codebase carries one, and a client resolves it against the reader's locale. A 429 carried
 *    nothing resolvable, so there was no way to show a throttled Syrian customer anything but
 *    English or a blank.
 * 2. **A hardcoded English sentence on a customer-facing path.** `safra/no-hardcoded-text` cannot
 *    see it because the string is inside a dependency, which is exactly why this went unnoticed: the
 *    lint rule is a floor, not a ceiling.
 * 3. **`ThrottlerException` names the framework** in a response anyone can read. Minor, and free to
 *    remove.
 *
 * Found by scenario 2 of the load test on 2026-08-20: 2.26M of 2.26M booking attempts were refused
 * by the limiter and every one of them failed the scenario's own check that a refusal carries a code.
 *
 * ## Why the message is not tailored per throttler
 *
 * Two throttlers are configured — the per-IP `default` and the per-(IP, account) `account` — and the
 * guard knows which one fired. It deliberately does not say: telling a caller WHICH limit they hit
 * tells an attacker whether the address they are guessing exists, since the `account` limiter only
 * applies where a request body names one. `O-sec-2` closed that oracle on registration; this keeps it
 * closed here. One code, one wording, both cases.
 */
@Injectable()
export class CodedThrottlerGuard extends ThrottlerGuard {
  /**
   * Overridden for its THROW, not for any of its arguments.
   *
   * The base signature takes the request context and the limit detail so an implementation can vary
   * the response; this one ignores both by design — see the note above on not naming the limiter.
   */
  protected override throwThrottlingException(): Promise<void> {
    throw tooManyRequests(ERROR.REQUEST_TOO_MANY);
  }

  /**
   * Unchanged in what it RETURNS. It records the key on the way past, and that is all.
   *
   * ## Why here
   *
   * `handleRequest` calls this immediately before `storage.increment`, and only for a throttler
   * that is actually going to count the request — a skipped one (`skipUnlessAccountNamed`) never
   * reaches it. So "was `generateKey` called" and "was a hit recorded" are the same question, which
   * is exactly the fact the refund in `O-sec-3` needs.
   *
   * The alternative was to recompute the key downstream, which means copying
   * `ThrottlerGuard.generateKey` — a `sha256` over the class name, the handler name, the throttler
   * name and the tracker — and keeping the copy in step with the dependency for ever. A key that
   * drifts by one character refunds nothing and reports success, which is the failure mode worth
   * designing out rather than testing for.
   */
  protected override generateKey(
    context: ExecutionContext,
    suffix: string,
    name: string,
  ): string {
    const key = super.generateKey(context, suffix, name);

    recordThrottleKey(context.switchToHttp().getRequest<object>(), name, key);

    return key;
  }
}
