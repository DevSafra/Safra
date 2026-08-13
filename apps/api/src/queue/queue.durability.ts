import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

/**
 * Refuses to treat a cache as a queue.
 *
 * ## The setting this exists for
 *
 * `docs/background-jobs-design.md`, operational requirements: **`maxmemory-policy` must be
 * `noeviction`. Any `allkeys-*` policy will evict queued jobs under pressure — silently. This
 * single setting is the difference between a queue and a cache.**
 *
 * A managed Redis sold as a cache defaults to `allkeys-lru`, and under that policy the failure is
 * invisible in every way that matters: jobs are accepted, the API returns 200, the queue looks
 * healthy, and work quietly disappears when memory fills. Nothing logs it. Nothing retries it,
 * because from BullMQ's point of view the job was never there.
 *
 * ## And persistence
 *
 * AOF `everysec`, so a restart loses at most a second of enqueues. Without it a restart loses the
 * whole queue. The design accepts a one-second RPO on the explicit grounds that **every producer
 * writes its database row before enqueueing** — a `notifications` row exists as `queued` before the
 * job does — so a lost job is recoverable by scanning for rows in a non-terminal state. That
 * recoverability is a design requirement, not a happy accident, and it is why one second is
 * tolerable rather than merely unavoidable.
 *
 * ## Why a check in code rather than a line in a runbook
 *
 * Because the line in the runbook already exists and cannot verify itself. This is the difference
 * between a documented requirement and an enforced one: a misconfigured instance fails at BOOT,
 * where somebody is watching, instead of losing a booking notification three weeks later.
 *
 * ## Fatal in production, loud everywhere else
 *
 * A developer running `redis-server` with no arguments gets no AOF, and refusing to start would
 * make the queue undevelopable for a property of the deployment. So outside production this warns
 * and continues; in production it throws, because there the setting is the whole guarantee.
 */
export async function assertQueueRedisIsDurable(
  redis: Redis,
  isProduction: boolean,
): Promise<void> {
  const logger = new Logger('QueueDurability');
  const problems: string[] = [];

  const [policy, appendonly] = await Promise.all([
    read(redis, 'maxmemory-policy'),
    read(redis, 'appendonly'),
  ]);

  /*
    Anything but `noeviction` can drop a key that is a job. `volatile-*` policies only evict keys
    with a TTL and BullMQ sets none, so they would not evict work today — but they say the operator
    believes this instance may discard data, and that belief is one config change from being true.
  */
  if (policy !== null && policy !== 'noeviction') {
    problems.push(
      `maxmemory-policy is "${policy}", not "noeviction" — under memory pressure this instance ` +
        'will silently evict queued jobs',
    );
  }

  if (appendonly !== null && appendonly !== 'yes') {
    problems.push(
      'appendonly is off — a Redis restart loses every job still waiting. Enable AOF with ' +
        'appendfsync everysec',
    );
  }

  if (problems.length === 0) return;

  const message =
    `Queue Redis is configured as a CACHE, not as durable job infrastructure:\n` +
    problems.map((problem) => `  - ${problem}`).join('\n') +
    '\nSee docs/background-jobs-design.md, "Operational requirements".';

  if (isProduction) throw new Error(message);

  logger.warn(`${message}\nContinuing because this is not production.`);
}

/**
 * One `CONFIG GET`, or `null` when the answer cannot be had.
 *
 * A managed Redis often forbids `CONFIG GET` entirely. That is not a misconfiguration and must not
 * be reported as one — an unknown value is unknown, and blocking a deploy over a command the
 * provider disabled would teach everyone to remove this check.
 */
async function read(redis: Redis, parameter: string): Promise<string | null> {
  try {
    const result = await redis.config('GET', parameter);

    /* ioredis returns a flat [name, value] pair. */
    return Array.isArray(result) && result.length >= 2 ? String(result[1]) : null;
  } catch {
    return null;
  }
}
