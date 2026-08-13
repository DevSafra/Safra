import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Worker } from 'bullmq';
import type { Redis } from 'ioredis';

import { AppModule } from './app.module.js';
import { JsonLogger } from './common/logging/json.logger.js';
import { loadEnv } from './config/env.js';
import { MailProcessor } from './queue/mail.processor.js';
import { CONCURRENCY, QUEUE, jitteredBackoff } from './queue/queue.definitions.js';
import { QUEUE_REDIS } from './queue/queue.tokens.js';
import type { MailJobData } from './queue/mail.job.js';

/**
 * The worker entrypoint. Same image as the API, different command.
 *
 * ## Why a second entrypoint rather than a worker inside the API
 *
 * `docs/background-jobs-design.md`, operational requirements: **worker processes are a separate
 * deployment, and worker scaling is independent of API replicas — that is the point.** A worker
 * embedded in the API would tie the amount of background capacity to the amount of request capacity,
 * and would put CPU-bound work (image variants, in a later phase) on the same event loop as a
 * checkout. It also means a queue backlog can be drained by adding workers without adding web
 * capacity, and a traffic spike can be absorbed without adding workers.
 *
 * ## It boots the whole AppModule
 *
 * Which looks heavier than necessary and is the right trade: processors call the same services the
 * API does — `NotificationService`, `MailService`, the database pool, the settings cache — and
 * assembling a reduced module for the worker would mean a second wiring of the same graph, to be kept
 * in step by hand. Nest's container is what resolves it correctly in both processes. No HTTP listener
 * is started, so nothing is exposed.
 *
 * ## Shutdown is the part that matters
 *
 * `SIGTERM` → stop accepting new jobs, finish what is in flight, then exit, with a 30-second grace.
 * A worker killed mid-job leaves that job locked until BullMQ's stall detection reclaims it, which
 * looks like a job that took minutes for no reason. `worker.close()` without `force` waits for the
 * active job, which is exactly the behaviour a rolling deploy needs.
 */
const SHUTDOWN_GRACE_MS = 30_000;

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const logger = new JsonLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');

  /*
    `createApplicationContext`, not `create`: this builds the DI container and the lifecycle hooks
    without an HTTP server. A worker that listened on a port would be a second copy of the API's
    surface with none of its middleware — no helmet, no CORS, no request logging.
  */
  const app = await NestFactory.createApplicationContext(AppModule, { logger });

  app.enableShutdownHooks();

  const connection = app.get<Redis>(QUEUE_REDIS);
  const mailProcessor = app.get(MailProcessor);

  const worker = new Worker<MailJobData>(
    QUEUE.mail,
    (job) => mailProcessor.process(job),
    {
      connection,
      prefix: 'safra',
      concurrency: CONCURRENCY.mail,
      /*
        Exponential backoff WITH JITTER, which BullMQ has no built-in for. Registered by the name the
        job options reference, so the policy lives in one place and a queue cannot accidentally use
        the unjittered default: without jitter, every retry in the estate lands on a recovering mail
        server simultaneously and puts it back down.
      */
      settings: {
        backoffStrategy: (attemptsMade: number, _type, _err, job) =>
          jitteredBackoff(
            attemptsMade,
            Number(
              job?.opts.backoff && typeof job.opts.backoff === 'object'
                ? job.opts.backoff.delay
                : 30_000,
            ) || 30_000,
            QUEUE.mail,
          ),
      },
    },
  );

  const log = new Logger('Worker');

  worker.on('completed', (job) => {
    log.log(`${QUEUE.mail}/${job.name} ${job.id} completed.`);
  });

  worker.on('failed', (job, error) => {
    /*
      Awaiting is not possible in an event handler, and an unhandled rejection here would take the
      worker down — so the dead-letter write catches its own errors (it does) and this only reports.
    */
    void mailProcessor.onFailed(job, error);
    log.warn(`${QUEUE.mail} job ${job?.id ?? 'unknown'} failed: ${error.message}`);
  });

  /* A worker with no error listener crashes the process when Redis blips. */
  worker.on('error', (error) => log.error(`Worker error: ${error.message}`));

  log.log(`Worker ready: ${QUEUE.mail} at concurrency ${CONCURRENCY.mail}.`);

  let shuttingDown = false;

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      if (shuttingDown) return;

      shuttingDown = true;
      log.log(`${signal} received: finishing in-flight jobs, then exiting.`);

      /*
        A hard deadline. `close()` waits for the active job, which is right, and a job that hangs
        would otherwise hold the deployment open indefinitely — so the grace period is enforced here
        rather than left to whatever the orchestrator's kill timeout happens to be.
      */
      const deadline = setTimeout(() => {
        log.error(`Still busy after ${SHUTDOWN_GRACE_MS}ms. Exiting anyway.`);
        process.exit(1);
      }, SHUTDOWN_GRACE_MS);

      deadline.unref();

      void (async () => {
        try {
          await worker.close();
          await app.close();
          log.log('Worker stopped cleanly.');
          process.exit(0);
        } catch (error) {
          log.error(
            `Shutdown failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          process.exit(1);
        }
      })();
    });
  }
}

bootstrap().catch((error: unknown) => {
  /* The Nest logger may be the thing that failed to construct, so this is deliberate. */
  process.stderr.write(
    `Worker failed to start: ${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exit(1);
});
