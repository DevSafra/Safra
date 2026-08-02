import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { Redis } from 'ioredis';

import { REDIS } from './redis.tokens.js';

/**
 * The record `ThrottlerStorage.increment` must return.
 *
 * Declared here rather than imported: `@nestjs/throttler` does not export
 * `ThrottlerStorageRecord` from its package root, and reaching into `dist/` for it
 * would break on a patch release that reorganises the build output.
 */
interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/**
 * Rate-limit counters in Redis, shared across every replica.
 *
 * ## The defect this fixes
 *
 * `ThrottlerModule` defaults to an in-process Map. With N replicas behind a load
 * balancer the effective limit becomes N × the configured one, and every counter
 * resets on deploy. It weakens exactly the limits that matter — login, password reset,
 * OTP — because an attacker spreading attempts across replicas gets N times the
 * budget, and a deploy hands them a fresh one. It also contradicts the rule that
 * application servers are stateless and shared state lives in Redis.
 *
 * ## Why the counting is done in a Lua script
 *
 * INCR then EXPIRE as two round trips is a race: two replicas can both INCR a missing
 * key, and whichever sets the TTL second wins — or, if a process dies between the two,
 * the key never expires and that caller is limited forever. A Lua script executes
 * atomically inside Redis, so the increment and its expiry cannot be separated, and
 * blocking is decided from the same consistent view.
 *
 * ## Behaviour is matched to the in-memory implementation
 *
 * Deliberately, so swapping storage cannot silently change enforcement: hits are
 * counted per throttler name, exceeding the limit sets a block for `blockDuration`,
 * and while blocked the hit counter is not advanced.
 *
 * ## Failure mode: fail OPEN, loudly
 *
 * If Redis is unreachable this allows the request and logs an error. Failing closed
 * would turn a cache outage into a total outage — nobody could log in, search, or
 * book. The exposure is bounded: an attacker would have to take Redis down first, and
 * the error log is what makes that visible rather than silent. This is a deliberate
 * availability-over-enforcement trade, and it is the reason S-1 lists alerting on
 * Redis errors as required before production.
 */
const INCREMENT_SCRIPT = `
local hitsKey  = KEYS[1]
local blockKey = KEYS[2]
local ttlMs    = tonumber(ARGV[1])
local limit    = tonumber(ARGV[2])
local blockMs  = tonumber(ARGV[3])

-- Already blocked: report the remaining block without advancing the counter, so a
-- caller hammering a blocked endpoint cannot extend their own penalty indefinitely.
local blockTtl = redis.call('PTTL', blockKey)
if blockTtl > 0 then
  local current = tonumber(redis.call('GET', hitsKey)) or limit + 1
  return { current, redis.call('PTTL', hitsKey), 1, blockTtl }
end

-- Not blocked. A hit count still above the limit therefore means the block just
-- expired: the counter outlives the block whenever ttl > blockDuration. Without this
-- reset the next request re-crosses the limit immediately and re-blocks, so the caller
-- is locked out permanently and the block duration means nothing. The in-memory
-- implementation resets on block expiry for the same reason; this matches it.
local previous = tonumber(redis.call('GET', hitsKey))
if previous ~= nil and previous > limit then
  redis.call('SET', hitsKey, 1, 'PX', ttlMs)
  return { 1, ttlMs, 0, 0 }
end

local hits = redis.call('INCR', hitsKey)
if hits == 1 then
  redis.call('PEXPIRE', hitsKey, ttlMs)
end

local isBlocked = 0
if hits > limit then
  redis.call('SET', blockKey, 1, 'PX', blockMs)
  blockTtl = blockMs
  isBlocked = 1
else
  blockTtl = 0
end

return { hits, redis.call('PTTL', hitsKey), isBlocked, blockTtl }
`;

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    /**
     * Namespaced per throttler. A route with its own `@Throttle({ default: ... })`
     * shares the caller's key otherwise, so a tight limit on password reset would
     * consume the general budget and vice versa.
     */
    const hitsKey = `throttle:${throttlerName}:${key}`;
    const blockKey = `throttle:${throttlerName}:${key}:blocked`;

    try {
      const result = (await this.redis.eval(
        INCREMENT_SCRIPT,
        2,
        hitsKey,
        blockKey,
        String(ttl),
        String(limit),
        String(blockDuration),
      )) as [number, number, number, number];

      const [totalHits, hitsTtlMs, isBlocked, blockTtlMs] = result;

      return {
        totalHits,
        // The interface is in seconds; Redis reports milliseconds.
        timeToExpire: Math.ceil(Math.max(hitsTtlMs, 0) / 1000),
        isBlocked: isBlocked === 1,
        timeToBlockExpire: Math.ceil(Math.max(blockTtlMs, 0) / 1000),
      };
    } catch (error) {
      this.logger.error(
        `Rate limiting is DEGRADED — Redis unreachable, allowing the request: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );

      // Fail open. See the class note: a cache outage must not become an outage.
      return {
        totalHits: 0,
        timeToExpire: Math.ceil(ttl / 1000),
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }
  }
}
