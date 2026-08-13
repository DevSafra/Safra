import {
  Global,
  Inject,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

import { ENV, type Env } from '../config/env.js';
import { QUEUE } from './queue.definitions.js';
import { assertQueueRedisIsDurable } from './queue.durability.js';
import { MAIL_QUEUE, QUEUE_REDIS } from './queue.tokens.js';

/**
 * The producer side of the queues: connections and `Queue` handles, no workers.
 *
 * ## Why the API holds producers and never a worker
 *
 * `docs/background-jobs-design.md`, operational requirements: **worker processes are a separate
 * deployment from the API — same image, different entrypoint** — so they scale independently, which
 * is most of the point. A worker inside the API would tie the number of things doing background work
 * to the number of things serving requests, and would put CPU-bound image processing in the same
 * event loop as a checkout. `worker.ts` is the other entrypoint.
 *
 * ## A separate Redis connection from the throttler's
 *
 * `maxRetriesPerRequest: null` is REQUIRED by BullMQ and is the opposite of what `RedisModule` sets.
 * That difference is not incidental: the throttler is on a request path and must fail in
 * milliseconds so the caller can decide what to do, while a queue command that fails has no caller
 * left to tell — the enqueue is part of a transaction that already committed. So one connection
 * cannot serve both, and sharing it would silently impose the wrong policy on whichever came second.
 *
 * `REDIS_QUEUE_URL` defaults to `REDIS_URL`, so development runs one instance and production can
 * separate them without a code change.
 */
@Global()
@Module({
  providers: [
    {
      provide: QUEUE_REDIS,
      inject: [ENV],
      useFactory: async (env: Env): Promise<Redis> => {
        const logger = new Logger('QueueRedis');

        const client = new Redis(env.REDIS_QUEUE_URL ?? env.REDIS_URL, {
          /*
            BullMQ requires this. Its blocking commands must not be given up on — a worker's BRPOPLPUSH
            is supposed to wait, and a client that abandons it after one retry turns a healthy idle
            queue into a reconnect loop.
          */
          maxRetriesPerRequest: null,
          connectTimeout: 5_000,
          retryStrategy: (times: number) => Math.min(times * 200, 2_000),
        });

        /* Mandatory: an ioredis client with no error listener crashes the process on a blip. */
        client.on('error', (error: Error) => {
          logger.error(`Queue Redis connection error: ${error.message}`);
        });

        /*
          Checked at boot, before anything is enqueued. A cache-configured instance accepts jobs and
          discards them under pressure, which is the one failure mode no amount of retrying detects.
        */
        await assertQueueRedisIsDurable(client, env.NODE_ENV === 'production');

        return client;
      },
    },
    {
      provide: MAIL_QUEUE,
      inject: [QUEUE_REDIS],
      useFactory: (connection: Redis): Queue =>
        new Queue(QUEUE.mail, {
          connection,
          /*
            Prefixed so two deployments can share one Redis without colliding — a staging worker
            picking up a production job is a data leak, not a mix-up.
          */
          prefix: 'safra',
        }),
    },
  ],
  exports: [QUEUE_REDIS, MAIL_QUEUE],
})
export class QueueModule implements OnApplicationShutdown {
  constructor(
    @Inject(QUEUE_REDIS) private readonly redis: Redis,
    @Inject(MAIL_QUEUE) private readonly mail: Queue,
  ) {}

  /**
   * Closes the queue before the connection.
   *
   * The other order works until it does not: `Queue.close()` issues commands, and a closed
   * connection turns a clean shutdown into a logged error on every deploy.
   */
  async onApplicationShutdown(): Promise<void> {
    try {
      await this.mail.close();
      await this.redis.quit();
    } catch {
      /* Already gone, or the server went first. Shutdown must not fail. */
    }
  }
}
