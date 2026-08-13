import type { JobsOptions } from 'bullmq';

/**
 * The queues, and what should happen when each one's jobs fail.
 *
 * ## Split by failure semantics, not by subject
 *
 * `docs/background-jobs-design.md`: the useful question is what should happen when a job fails, and
 * jobs that answer it differently do not belong together. A notification that fails should be
 * retried patiently because a duplicate email is survivable; an image variant should be retried a
 * few times because it is CPU-bound and a queue of them starves everything else; an outbound
 * webhook should be retried for hours because receivers go down for hours.
 *
 * Only `mail` is live. The other four are declared here rather than in the phase that builds them,
 * because the retry policy is a decision the design already made and re-deciding it per phase is how
 * five queues end up with five accidental policies.
 */
export const QUEUE = {
  mail: 'mail',
  media: 'media',
  scheduled: 'scheduled',
  webhooks: 'webhooks',
  exports: 'exports',
} as const;

export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

/**
 * Retention, applied to every queue.
 *
 * `removeOnComplete` bounded both ways: a day answers "did it run", and unbounded completed jobs are
 * a memory leak with a retention question attached — on an instance whose eviction policy is
 * deliberately `noeviction`, an unbounded key set is not a slow leak but an outage.
 *
 * `removeOnFail: false` on purpose. **A failed job is evidence.** It stays until somebody moves it,
 * and `DeadLetterService` copies it somewhere durable before BullMQ's own retention could matter.
 */
const RETENTION = {
  removeOnComplete: { age: 86_400, count: 10_000 },
  removeOnFail: false,
} as const;

/** Per-queue worker concurrency. `media` is a CPU budget; the others are IO budgets. */
export const CONCURRENCY: Record<QueueName, number> = {
  mail: 10,
  media: 4,
  /*
    One, and this is what replaces the advisory lock the cron jobs take today. A queue that cannot
    run two of the same job is a stronger guarantee across a cluster than a lock every caller has to
    remember to acquire.
  */
  scheduled: 1,
  webhooks: 5,
  exports: 2,
};

/**
 * Retry policy per queue, from the design's table.
 *
 * Exponential **with jitter** everywhere except `scheduled`: without jitter, a provider recovering
 * from an outage receives every retry in the estate simultaneously and goes back down. BullMQ's
 * `backoff.type: 'exponential'` has no jitter of its own, so the delay is computed in
 * `jitteredBackoff` and applied through a custom strategy registered on the worker.
 *
 * **Retries do not replace idempotency, they require it.** Every job here must be safe to run twice:
 * `notifications` rows are keyed, payout items are unique per booking, image processing is
 * content-addressed.
 */
export const JOB_OPTIONS: Record<QueueName, JobsOptions> = {
  mail: {
    ...RETENTION,
    attempts: 5,
    backoff: { type: 'safraExponential', delay: 30_000 },
  },
  media: {
    ...RETENTION,
    attempts: 3,
    backoff: { type: 'safraExponential', delay: 10_000 },
  },
  /* Fixed, not exponential: a repeatable job has a next occurrence, so a long backoff just skips it. */
  scheduled: { ...RETENTION, attempts: 2, backoff: { type: 'fixed', delay: 300_000 } },
  webhooks: {
    ...RETENTION,
    attempts: 8,
    backoff: { type: 'safraExponential', delay: 60_000 },
  },
  exports: { ...RETENTION, attempts: 2, backoff: { type: 'fixed', delay: 60_000 } },
};

/** The ceiling on an exponential delay: 8 minutes for mail, 4 hours for webhooks. */
const MAX_BACKOFF_MS: Record<string, number> = {
  [QUEUE.mail]: 8 * 60_000,
  [QUEUE.webhooks]: 4 * 60 * 60_000,
};

/**
 * Exponential backoff with full jitter, capped per queue.
 *
 * Full jitter — a uniform draw from `[0, delay]` rather than `delay ± a bit` — because the property
 * that matters is that two jobs failing at the same instant do not retry at the same instant. Half
 * the average delay is a fair price for that, and the alternative is a thundering herd aimed at a
 * dependency that has just proved it is fragile.
 *
 * Exported so the tests can assert the shape rather than the draw: bounds, growth, and the cap.
 */
export function jitteredBackoff(
  attemptsMade: number,
  baseDelayMs: number,
  queue: string,
  random: () => number = Math.random,
): number {
  const cap = MAX_BACKOFF_MS[queue] ?? 60 * 60_000;
  const exponential = Math.min(baseDelayMs * 2 ** Math.max(0, attemptsMade - 1), cap);

  /* At least a second, so a jitter draw near zero does not become an immediate retry. */
  return Math.max(1_000, Math.round(random() * exponential));
}
