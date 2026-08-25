import {
  Injectable,
  Logger,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

import { ERROR } from '@safra/contracts';

import { codeOf } from '../errors/app-error.js';
import { RedisThrottlerStorage } from '../../redis/redis-throttler.storage.js';
import { throttleKeyOf } from './throttle-keys.js';
import { describeError } from '../errors/safe-error.js';

/**
 * The per-IP throttler this refunds against — the shared, address-wide one.
 *
 * `'default'` is `@nestjs/throttler`'s name for an unnamed throttler and is what
 * `@Throttle({ default: … })` on a route addresses. Named here so the one line that matters — that
 * the `account` throttler is NOT in this file — is a fact a reader can see rather than infer.
 */
const IP_THROTTLER = 'default';

/**
 * Keeps a SUCCESSFUL sign-in from spending the per-IP ceiling (`O-sec-3`, Bashar, 2026-08-20).
 *
 * ## What was measured
 *
 * Scenario 4 of the load test: a legitimate customer with correct credentials, on the same egress
 * address as a credential-stuffing run, pacing themselves well inside their own per-account
 * allowance, signed in **0 times out of 30**. The per-IP `@Throttle` on `/auth/login` is shared by
 * everybody behind one address, and in the Syrian market carrier-grade NAT puts thousands of
 * subscribers behind one. `O-sec-1`'s mitigation had closed the collateral damage in the `account`
 * throttler and left this one starving the address.
 *
 * ## What this changes
 *
 * The per-IP ceiling becomes a budget for FAILED sign-ins. A legitimate customer's traffic is
 * successes, and a success now costs nothing: the hit the guard took is given back. A NAT'd office
 * of partners signing in at the start of a shift can no longer exhaust the address's budget for
 * everybody else on that carrier, whatever the ceiling is set to.
 *
 * ## What it deliberately does NOT change
 *
 * - **The `account` throttler is never refunded.** Ten a minute per (IP, account) still counts
 *   every attempt, successes included, and it is what bounds the Argon2id verifications a single
 *   address can force for a single account. Refunding it too would let anybody holding one valid
 *   credential drive password checks at an unbounded rate.
 * - **The account lockout is untouched.** Five failed attempts still locks the account for fifteen
 *   minutes, enforced in `AuthService` against the user row, wherever the attempts came from. That
 *   is the defence against a DISTRIBUTED attack, and the load test measured it holding at 40 of 40.
 * - **The ceiling's number is unchanged here.** This changes what the ceiling counts, not how high
 *   it is.
 *
 * ## The residual, stated plainly
 *
 * This does not make the bystander unreachable. An attacker's traffic is failures, and failures
 * still count — so an attacker sustaining enough FAILED sign-ins per second from one address can
 * still exhaust it and starve everybody behind it. That is inherent to any limiter keyed on an
 * address shared by strangers; what remains adjustable is the ceiling, and beyond that the answer
 * is rate limiting at the edge rather than in the application. Recorded under `O-sec-3`.
 */
@Injectable()
export class SignInRefundInterceptor implements NestInterceptor {
  private readonly logger = new Logger(SignInRefundInterceptor.name);

  constructor(private readonly storage: RedisThrottlerStorage) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<object>();

    return next.handle().pipe(
      tap({
        next: () => this.refund(request),
        error: (error: unknown) => {
          /**
           * The password was ACCEPTED and only the second factor is outstanding, so this is not a
           * failed sign-in — it is half of one. A staff sign-in costs two requests to `/auth/login`
           * (credentials, then the code), and charging the first to the failure budget would make
           * every staff member twice as expensive as a customer to the address they share.
           *
           * The same reasoning the controller already applies to the audit log, where this outcome
           * must not be recorded as `auth.login_failed`.
           */
          if (codeOf(error) === ERROR.AUTH_CODE_REQUIRED) this.refund(request);
        },
      }),
    );
  }

  /**
   * Not awaited, by design — but caught, which is not the same thing.
   *
   * The sign-in has already succeeded. Making the customer wait on a Redis round trip to give back
   * a counter, or worse failing their sign-in because that round trip failed, would be a strictly
   * worse product than the throttling problem this exists to fix.
   *
   * The `catch` is load-bearing rather than defensive. `RedisThrottlerStorage.refund` handles its
   * own failures, but an unawaited promise that rejects for ANY other reason is an unhandled
   * rejection, and Node's default for those is to terminate the process. A detached best-effort
   * call on the sign-in path is exactly where that must not be left to the callee's good manners.
   */
  private refund(request: object): void {
    const key = throttleKeyOf(request, IP_THROTTLER);

    /*
      Absent when the throttler never counted this request. The realistic case is the guard failing
      open because Redis was unreachable, and "nothing was counted" is exactly when there is
      nothing to refund.
    */
    if (!key) return;

    this.storage.refund(key, IP_THROTTLER).catch((error: unknown) => {
      this.logger.warn(
        `Could not refund the per-IP sign-in hit; it stays counted. ` +
          `${describeError(error)}`,
      );
    });
  }
}
