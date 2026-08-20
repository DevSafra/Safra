import { Redis } from 'ioredis';
import { of } from 'rxjs';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { RedisThrottlerStorage } from '../../redis/redis-throttler.storage.js';
import { CodedThrottlerGuard } from './coded-throttler.guard.js';
import { SignInRefundInterceptor } from './sign-in-refund.interceptor.js';
import { throttleKeyOf } from './throttle-keys.js';

/**
 * The one thing a unit test cannot prove: the key the GUARD incremented is the key the INTERCEPTOR
 * refunds.
 *
 * `ThrottlerGuard.generateKey` is a `sha256` over the controller name, the handler name, the
 * throttler name and the tracker, and the counter lives in Redis under a name derived from it. A
 * key that differs by one character refunds a counter nobody is reading and reports success — the
 * per-IP ceiling would go on starving the address it was changed to stop starving, and every test
 * built out of doubles would still be green. So this runs the real guard and the real storage
 * against a real Redis and asserts on the number in it.
 *
 * Skipped when REDIS_URL is unset; CI provisions Redis and runs it.
 */
const REDIS_URL = process.env['REDIS_URL'];
const describeIfRedis = REDIS_URL ? describe : describe.skip;

/** Two throttlers, named and shaped exactly as `app.module.ts` registers them. */
const THROTTLERS = [
  { name: 'default', ttl: 60_000, limit: 40 },
  { name: 'account', ttl: 60_000, limit: 10 },
];

describeIfRedis('a successful sign-in and the per-IP counter', () => {
  const client = new Redis(REDIS_URL as string, { maxRetriesPerRequest: 1 });
  const storage = new RedisThrottlerStorage(client);
  const interceptor = new SignInRefundInterceptor(storage);

  /** Unique per test so a repeated run cannot inherit the previous one's counters. */
  let ip = '';
  let counter = 0;

  /** Stands in for the request Express hands the guard, and for the handler Nest resolved. */
  function contextFor(request: Record<string, unknown>) {
    const response = { header: () => undefined };

    return {
      getHandler: () => function login() {},
      getClass: () => class AuthController {},
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
    } as never;
  }

  function guard(): CodedThrottlerGuard {
    return new CodedThrottlerGuard({ throttlers: THROTTLERS }, storage, {
      getAllAndOverride: () => undefined,
    } as never);
  }

  /** One `POST /auth/login` as far as the guard is concerned. */
  async function attempt(request: Record<string, unknown>) {
    const instance = guard();
    await instance.onModuleInit();
    await instance.canActivate(contextFor(request));
  }

  /**
   * The counter for THIS request, read through the key the guard recorded.
   *
   * Not a scan of `throttle:default:*`, which is what this did first and why it failed the moment
   * the suite ran with the API up: the counters are shared with every other test file and with any
   * running instance, so a sum over the namespace measures the machine rather than the test. Nor a
   * `del` of the namespace between tests — that wiped a sibling suite's keys, since vitest runs
   * files in parallel, and it would clear a live instance's rate limits too.
   *
   * Reading through `throttleKeyOf` is also the honest thing to assert: the recorded key IS what
   * the refund uses, so a counter that is absent under it means the guard incremented something
   * else, which is the failure this file exists to catch.
   */
  async function hits(request: object, throttler: string): Promise<number> {
    const key = throttleKeyOf(request, throttler);

    if (!key) return 0;

    return Number((await client.get(`throttle:${throttler}:${key}`)) ?? 0);
  }

  /** The addresses this run touched, so cleanup removes those and nothing else. */
  const touched = new Set<string>();

  beforeEach(() => {
    /* Unique per test AND per run: a repeated run inside the same minute must not inherit hits. */
    ip = `203.0.113.${Math.floor(Math.random() * 250) + 1}-${process.pid}-${counter++}`;
  });

  afterAll(async () => {
    if (touched.size > 0) await client.del(...touched);

    await client.quit();
  });

  /** Registers this request's keys so `afterAll` removes exactly what the run created. */
  function remember(request: object): void {
    for (const throttler of ['default', 'account']) {
      const key = throttleKeyOf(request, throttler);

      if (key) touched.add(`throttle:${throttler}:${key}`);
    }
  }

  /** Drives the interceptor over a successful sign-in and waits for the detached refund. */
  async function succeed(request: object): Promise<void> {
    await new Promise<void>((resolve) => {
      interceptor
        .intercept(contextFor(request as Record<string, unknown>), {
          handle: () => of({ ok: true }),
        } as never)
        .subscribe({ next: () => resolve() });
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  it('counts an attempt against the per-IP ceiling', async () => {
    const request = { ip, body: { email: 'someone@safra.test' } };

    await attempt(request);
    remember(request);

    expect(await hits(request, 'default')).toBe(1);
  });

  /**
   * The finding, expressed as the fix. Scenario 4 measured a legitimate customer signing in 0 times
   * out of 30 from an attacked address; a success that costs nothing is what stops their own
   * traffic adding to the problem.
   */
  it('gives the hit back when the sign-in succeeds', async () => {
    const request = { ip, body: { email: 'someone@safra.test' } };

    await attempt(request);
    remember(request);
    expect(await hits(request, 'default')).toBe(1);

    await succeed(request);

    expect(await hits(request, 'default')).toBe(0);
  });

  /**
   * THE bound that must survive. Ten a minute per (IP, account) is what keeps the Argon2id
   * verifications one address can force for one account finite; if a success refunded this too,
   * anybody holding a single valid credential could drive password checks without limit.
   */
  it('leaves the per-account counter alone', async () => {
    const request = { ip, body: { email: 'someone@safra.test' } };

    await attempt(request);
    remember(request);
    await succeed(request);

    expect(await hits(request, 'default')).toBe(0);
    expect(await hits(request, 'account')).toBe(1);
  });

  /**
   * The ceiling still exists. Ten failures in a row must leave ten on the counter — the refund is
   * not a way to make the limiter stop counting.
   */
  it('keeps counting failures', async () => {
    const request = { ip, body: { email: 'someone@safra.test' } };

    for (let i = 0; i < 10; i += 1) await attempt(request);
    remember(request);

    expect(await hits(request, 'default')).toBe(10);
  });

  /**
   * Two people behind one carrier-grade NAT address, which is the whole subject of `O-sec-3`. The
   * attacker's failures accumulate; the bystander's successes do not.
   */
  it('charges the address for failures and not for successes', async () => {
    const attacker = { ip, body: { email: 'victim@safra.test' } };
    const bystander = { ip, body: { email: 'bystander@safra.test' } };

    for (let i = 0; i < 5; i += 1) await attempt(attacker);

    for (let i = 0; i < 5; i += 1) {
      await attempt(bystander);
      await succeed(bystander);
    }

    remember(attacker);
    remember(bystander);

    /*
      Both requests carry the same `ip`, so both name the SAME per-IP counter — that is the shared
      budget the whole item is about. Five attacker failures are on it, and nothing at all from the
      bystander's five successful sign-ins.
    */
    expect(await hits(attacker, 'default')).toBe(5);
    expect(await hits(bystander, 'default')).toBe(5);
  });
});
