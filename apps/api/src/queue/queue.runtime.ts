import { Logger } from '@nestjs/common';
import type { INestApplicationContext } from '@nestjs/common';
import { Worker } from 'bullmq';
import type { Job } from 'bullmq';
import type { Redis } from 'ioredis';

import {
  CONCURRENCY,
  JOB_OPTIONS,
  jitteredBackoff,
  type QueueName,
} from './queue.definitions.js';
import { describeError } from '../common/errors/safe-error.js';

/**
 * A processor, in the only two shapes the worker entrypoint needs to know about.
 *
 * Structural rather than an interface a class implements, so a processor stays an ordinary
 * `@Injectable()` that other code can call directly — `MailProcessor.process` is also what an
 * inline test harness invokes, and a marker interface would have made that a lie about where the
 * behaviour lives.
 */
export interface QueueProcessor<T> {
  process(job: Job<T>): Promise<void>;
  onFailed(job: Job<T> | undefined, error: Error): Promise<void>;
}

/**
 * Starts one BullMQ worker, with the settings every queue must share.
 *
 * ## Why this exists rather than a second copy of the mail worker
 *
 * `worker.ts` began as one queue written out longhand: connection, prefix, concurrency, the jitter
 * strategy, four event handlers, and the shutdown. Phase 3 adds `media`, phase 4 `scheduled`,
 * phase 5 `webhooks` and `exports` — and the failure mode of copying that block five times is not
 * verbosity, it is a queue that quietly lacks the jitter strategy, or the prefix, or the
 * dead-letter hookup, and behaves differently from its siblings for a reason nobody can see by
 * reading either one.
 *
 * So adding a queue is one entry in `worker.ts`, and everything below is decided once.
 *
 * ## The backoff strategy is registered per worker, deliberately
 *
 * BullMQ has no jittered exponential of its own, and the strategy is resolved by the WORKER, not by
 * the job — so a queue whose jobs ask for `safraExponential` and whose worker does not register it
 * silently falls back to no delay at all. Registering it here means the two cannot be separated.
 */
export function startWorker<T>(
  queue: QueueName,
  connection: Redis,
  processor: QueueProcessor<T>,
): Worker<T> {
  const log = new Logger(`Worker:${queue}`);
  /*
    The queue's declared base delay, used when a JOB carries none of its own — an older job
    enqueued before the options changed, or one added by hand. Thirty seconds is the last resort
    and is never reached while `queue.definitions.ts` declares a backoff for every queue.
  */
  const fallbackDelay = readDelay(JOB_OPTIONS[queue]) ?? 30_000;

  const worker = new Worker<T>(queue, (job) => processor.process(job), {
    connection,
    prefix: 'safra',
    concurrency: CONCURRENCY[queue],
    settings: {
      backoffStrategy: (attemptsMade: number, _type, _error, job) =>
        jitteredBackoff(attemptsMade, readDelay(job?.opts) ?? fallbackDelay, queue),
    },
  });

  worker.on('completed', (job) => {
    log.log(`${job.name} ${job.id} completed.`);
  });

  worker.on('failed', (job, error) => {
    /*
      Not awaited — an event handler cannot be — so the dead-letter write must catch its own errors,
      and every processor's `onFailed` does. An unhandled rejection here would take the process down
      and with it every OTHER queue on this worker, which is a new consequence of running more than
      one: before phase 3 the blast radius of that mistake was the queue it happened on.
    */
    void processor.onFailed(job, error).catch((failure: unknown) => {
      log.error(
        `${queue}: recording the failure itself failed: ` + `${describeError(failure)}`,
      );
    });

    log.warn(`job ${job?.id ?? 'unknown'} failed: ${describeError(error)}`);
  });

  /* A worker with no error listener crashes the process when Redis blips. */
  worker.on('error', (error) => log.error(`Worker error: ${describeError(error)}`));

  log.log(`Ready at concurrency ${CONCURRENCY[queue]}.`);

  return worker;
}

/**
 * Stops every worker, then the container, within one deadline.
 *
 * `close()` without `force` waits for the ACTIVE job, which is what a rolling deploy needs: a
 * worker killed mid-job leaves that job locked until BullMQ's stall detection reclaims it, which
 * looks like a job that took minutes for no reason. The deadline is enforced here rather than left
 * to whatever the orchestrator's kill timeout happens to be, because a single job that hangs would
 * otherwise hold the whole deployment open.
 *
 * The workers are closed CONCURRENTLY and the app last. Sequentially, five queues each waiting on
 * an in-flight job could take five times the grace period between them.
 */
export async function stopWorkers(
  workers: readonly Worker<never>[],
  app: INestApplicationContext,
  graceMs: number,
  log: Logger,
): Promise<void> {
  const deadline = setTimeout(() => {
    log.error(`Still busy after ${graceMs}ms. Exiting anyway.`);
    process.exit(1);
  }, graceMs);

  deadline.unref();

  await Promise.all(workers.map((worker) => worker.close()));
  await app.close();
}

/** The base delay a job's own options declare, or nothing if it declares none. */
function readDelay(options: { backoff?: unknown } | undefined): number | undefined {
  const backoff = options?.backoff;

  if (!backoff || typeof backoff !== 'object' || !('delay' in backoff)) return undefined;

  const delay = Number(backoff.delay);

  return Number.isFinite(delay) && delay > 0 ? delay : undefined;
}
