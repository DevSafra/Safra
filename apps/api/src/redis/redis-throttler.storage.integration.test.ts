import { Redis } from 'ioredis';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { RedisThrottlerStorage } from './redis-throttler.storage.js';

/**
 * Rate-limit counters against a REAL Redis.
 *
 * The defect being pinned is a distributed one, so an in-memory fake would test
 * nothing: the whole claim is that two independent storage instances — standing in for
 * two replicas — share one counter. A mock would share it by construction and the test
 * would pass against the broken implementation.
 *
 * Skipped when REDIS_URL is unset; CI provisions Redis and runs it.
 */
const REDIS_URL = process.env['REDIS_URL'];
const describeIfRedis = REDIS_URL ? describe : describe.skip;

describeIfRedis('RedisThrottlerStorage', () => {
  const client = new Redis(REDIS_URL as string, { maxRetriesPerRequest: 1 });

  /** Two instances on one Redis: the two replicas the old implementation got wrong. */
  const replicaA = new RedisThrottlerStorage(client);
  const replicaB = new RedisThrottlerStorage(client);

  /** Unique per test run so repeated runs cannot inherit each other's counters. */
  let key: string;
  let counter = 0;

  beforeEach(() => {
    counter += 1;
    key = `test-${process.pid}-${counter}`;
  });

  afterAll(async () => {
    const keys = await client.keys(`throttle:*test-${process.pid}-*`);
    if (keys.length > 0) await client.del(...keys);

    await client.quit();
  });

  describe('counting', () => {
    it('increments across calls', async () => {
      const first = await replicaA.increment(key, 60_000, 5, 60_000, 'default');
      const second = await replicaA.increment(key, 60_000, 5, 60_000, 'default');

      expect(first.totalHits).toBe(1);
      expect(second.totalHits).toBe(2);
    });

    /**
     * THE regression guard. With the default in-memory store each replica kept its own
     * Map, so N replicas meant N × the configured limit — and an attacker spreading
     * login attempts across them got exactly that much more budget.
     */
    it('shares one counter across replicas', async () => {
      await replicaA.increment(key, 60_000, 5, 60_000, 'default');
      await replicaB.increment(key, 60_000, 5, 60_000, 'default');
      const third = await replicaA.increment(key, 60_000, 5, 60_000, 'default');

      expect(third.totalHits).toBe(3);
    });

    /**
     * A tight limit on password reset must not consume the general budget, and the
     * general budget must not exhaust the tight one.
     */
    it('keeps separate counters per throttler name', async () => {
      await replicaA.increment(key, 60_000, 5, 60_000, 'default');
      const other = await replicaA.increment(key, 60_000, 5, 60_000, 'strict');

      expect(other.totalHits).toBe(1);
    });

    it('reports a positive time to expire so the client can back off', async () => {
      const record = await replicaA.increment(key, 60_000, 5, 60_000, 'default');

      expect(record.timeToExpire).toBeGreaterThan(0);
      expect(record.timeToExpire).toBeLessThanOrEqual(60);
    });

    /**
     * Without PEXPIRE inside the same atomic script the key can outlive its window,
     * and the caller stays limited forever.
     */
    it('sets a TTL on the counter rather than leaving it forever', async () => {
      await replicaA.increment(key, 60_000, 5, 60_000, 'default');

      expect(await client.pttl(`throttle:default:${key}`)).toBeGreaterThan(0);
    });
  });

  describe('blocking', () => {
    it('does not block while at or under the limit', async () => {
      for (let i = 0; i < 3; i += 1) {
        const record = await replicaA.increment(key, 60_000, 3, 60_000, 'default');
        expect(record.isBlocked).toBe(false);
      }
    });

    it('blocks once the limit is exceeded', async () => {
      for (let i = 0; i < 3; i += 1) {
        await replicaA.increment(key, 60_000, 3, 60_000, 'default');
      }

      const exceeded = await replicaA.increment(key, 60_000, 3, 60_000, 'default');

      expect(exceeded.isBlocked).toBe(true);
      expect(exceeded.timeToBlockExpire).toBeGreaterThan(0);
    });

    /** A block set by one replica must be honoured by every other. */
    it('propagates a block to the other replica', async () => {
      for (let i = 0; i < 4; i += 1) {
        await replicaA.increment(key, 60_000, 3, 60_000, 'default');
      }

      const onB = await replicaB.increment(key, 60_000, 3, 60_000, 'default');

      expect(onB.isBlocked).toBe(true);
    });

    /**
     * Hammering a blocked endpoint must not extend the penalty. Otherwise a caller
     * retrying in a loop locks themselves out indefinitely, and a legitimate client
     * with an aggressive retry becomes indistinguishable from an attacker.
     */
    it('does not advance the hit count while blocked', async () => {
      for (let i = 0; i < 4; i += 1) {
        await replicaA.increment(key, 60_000, 3, 60_000, 'default');
      }

      const first = await replicaA.increment(key, 60_000, 3, 60_000, 'default');
      const second = await replicaA.increment(key, 60_000, 3, 60_000, 'default');

      expect(second.totalHits).toBe(first.totalHits);
    });

    it('lifts the block once it expires', async () => {
      for (let i = 0; i < 4; i += 1) {
        await replicaA.increment(key, 60_000, 3, 150, 'default');
      }

      await new Promise((resolve) => setTimeout(resolve, 250));

      expect((await replicaA.increment(key, 60_000, 3, 150, 'default')).isBlocked).toBe(
        false,
      );
    });
  });

  /**
   * The half of `O-sec-3` that lives in storage: a successful sign-in gives its per-IP hit back.
   *
   * Every property here is a security property rather than a nicety — a refund that creates a key,
   * goes negative, or resets a TTL is a way to mint rate-limit budget.
   */
  describe('refunding', () => {
    it('gives one hit back', async () => {
      await replicaA.increment(key, 60_000, 5, 60_000, 'default');
      await replicaA.increment(key, 60_000, 5, 60_000, 'default');

      await replicaA.refund(key, 'default');

      expect(await client.get(`throttle:default:${key}`)).toBe('1');
    });

    /** One replica must be able to refund a hit another one took. */
    it('refunds across replicas', async () => {
      await replicaA.increment(key, 60_000, 5, 60_000, 'default');
      await replicaB.refund(key, 'default');

      expect(await client.get(`throttle:default:${key}`)).toBe('0');
    });

    /**
     * A refund arriving after the window rolled over must not start a fresh counter at -1 — that
     * is budget nobody paid for, handed to whoever holds the address next.
     */
    it('does not create a counter that had already expired', async () => {
      await replicaA.refund(key, 'default');

      expect(await client.exists(`throttle:default:${key}`)).toBe(0);
    });

    /** Two refunds for one hit must not go below zero, for the same reason. */
    it('never goes negative', async () => {
      await replicaA.increment(key, 60_000, 5, 60_000, 'default');

      await replicaA.refund(key, 'default');
      await replicaA.refund(key, 'default');
      await replicaA.refund(key, 'default');

      expect(await client.get(`throttle:default:${key}`)).toBe('0');
    });

    /**
     * The window must keep expiring when it was always going to. Resetting the TTL here would let
     * a caller alternating success and failure hold one window open indefinitely.
     */
    it('leaves the TTL alone', async () => {
      await replicaA.increment(key, 60_000, 5, 60_000, 'default');
      const before = await client.pttl(`throttle:default:${key}`);

      await replicaA.refund(key, 'default');
      const after = await client.pttl(`throttle:default:${key}`);

      expect(after).toBeGreaterThan(0);
      expect(after).toBeLessThanOrEqual(before);
    });

    /** Refunding one throttler must never touch another's counter. */
    it('refunds only the named throttler', async () => {
      await replicaA.increment(key, 60_000, 5, 60_000, 'default');
      await replicaA.increment(key, 60_000, 5, 60_000, 'account');

      await replicaA.refund(key, 'default');

      expect(await client.get(`throttle:account:${key}`)).toBe('1');
    });

    /**
     * A caller who was BLOCKED never reached the handler, so there is nothing to refund — and a
     * refund must not be a way to lift a block early.
     */
    it('does not lift a block', async () => {
      for (let i = 0; i < 4; i += 1) {
        await replicaA.increment(key, 60_000, 3, 60_000, 'default');
      }

      await replicaA.refund(key, 'default');

      expect(
        (await replicaA.increment(key, 60_000, 3, 60_000, 'default')).isBlocked,
      ).toBe(true);
    });

    /**
     * Fails CLOSED, which is the opposite of `increment` and deliberate: failing open here would
     * hand back budget that was never spent. The cost of the closed failure is one wasted slot.
     */
    it('leaves the hit counted when Redis is unreachable', async () => {
      const dead = new Redis('redis://127.0.0.1:1', {
        maxRetriesPerRequest: 0,
        retryStrategy: () => null,
        lazyConnect: true,
        enableOfflineQueue: false,
      });
      dead.on('error', () => undefined);

      await expect(
        new RedisThrottlerStorage(dead).refund(key, 'default'),
      ).resolves.toBeUndefined();

      dead.disconnect();
    });
  });

  describe('when Redis is unreachable', () => {
    /**
     * Fails OPEN, deliberately. Failing closed would turn a cache outage into a total
     * outage — nobody could log in, search, or book. The trade is stated in the class
     * note and this pins it, because the opposite behaviour is equally defensible and
     * must not be introduced by accident.
     */
    it('allows the request rather than taking the API down', async () => {
      const dead = new Redis('redis://127.0.0.1:1', {
        maxRetriesPerRequest: 0,
        retryStrategy: () => null,
        lazyConnect: true,
        enableOfflineQueue: false,
      });
      dead.on('error', () => undefined);

      const record = await new RedisThrottlerStorage(dead).increment(
        key,
        60_000,
        5,
        60_000,
        'default',
      );

      expect(record.isBlocked).toBe(false);
      expect(record.totalHits).toBe(0);

      dead.disconnect();
    });
  });
});
