import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Worker } from 'bullmq';
import type { Redis } from 'ioredis';

import { AppModule } from './app.module.js';
import { JsonLogger } from './common/logging/json.logger.js';
import { loadEnv } from './config/env.js';
import { MailProcessor } from './queue/mail.processor.js';
import { MediaProcessor } from './queue/media.processor.js';
import { ScheduledProcessor } from './queue/scheduled.processor.js';
import { ExportProcessor } from './queue/export.processor.js';
import { QUEUE } from './queue/queue.definitions.js';
import { startWorker, stopWorkers } from './queue/queue.runtime.js';
import { QUEUE_REDIS } from './queue/queue.tokens.js';

/**
 * The worker entrypoint. Same image as the API, different command.
 *
 * ## Why a second entrypoint rather than a worker inside the API
 *
 * `docs/background-jobs-design.md`, operational requirements: **worker processes are a separate
 * deployment, and worker scaling is independent of API replicas — that is the point.** A worker
 * embedded in the API would tie the amount of background capacity to the amount of request
 * capacity, and would put CPU-bound work on the same event loop as a checkout. That last one stopped
 * being hypothetical in phase 3: `media` runs six `sharp` encodes per job at concurrency 4, and
 * sharing an event loop with a payment would be visible in the p95.
 *
 * It also means a queue backlog can be drained by adding workers without adding web capacity, and a
 * traffic spike can be absorbed without adding workers.
 *
 * ## It boots the whole AppModule
 *
 * Which looks heavier than necessary and is the right trade: processors call the same services the
 * API does — `NotificationService`, `ImageService`, the database pool, the settings cache — and
 * assembling a reduced module for the worker would mean a second wiring of the same graph, to be
 * kept in step by hand. Nest's container is what resolves it correctly in both processes. No HTTP
 * listener is started, so nothing is exposed.
 *
 * ## Adding a queue is one entry in `WORKERS`
 *
 * Everything a worker must share — the key prefix, the jitter strategy, the dead-letter hookup, the
 * event handlers — lives in `queue.runtime.ts`. A queue added by copying a block instead would
 * eventually be missing one of them, and would behave differently from its siblings for a reason
 * invisible in either file.
 *
 * ## Shutdown is the part that matters
 *
 * `SIGTERM` → stop accepting new jobs, finish what is in flight, then exit, with a 30-second grace.
 * A worker killed mid-job leaves that job locked until BullMQ's stall detection reclaims it.
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
  const log = new Logger('Worker');

  /** Every live queue and the class that runs its jobs. Adding one is a row here. */
  const workers: Worker<never>[] = [
    startWorker(QUEUE.mail, connection, app.get(MailProcessor)),
    startWorker(QUEUE.media, connection, app.get(MediaProcessor)),
    startWorker(QUEUE.scheduled, connection, app.get(ScheduledProcessor)),
    startWorker(QUEUE.exports, connection, app.get(ExportProcessor)),
  ] as Worker<never>[];

  log.log(`Worker ready: ${workers.length} queues.`);

  let shuttingDown = false;

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      if (shuttingDown) return;

      shuttingDown = true;
      log.log(`${signal} received: finishing in-flight jobs, then exiting.`);

      void (async () => {
        try {
          await stopWorkers(workers, app, SHUTDOWN_GRACE_MS, log);
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
