import {
  Global,
  Inject,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Redis } from 'ioredis';

import { ENV, type Env } from '../config/env.js';
import { RedisThrottlerStorage } from './redis-throttler.storage.js';
import { REDIS } from './redis.tokens.js';

/**
 * The shared Redis connection.
 *
 * `REDIS_URL` has been a required environment variable since the first commit and
 * nothing connected to it — the config demanded a URL that no code used. This is the
 * client that makes it real, and the reason it now matters is horizontal scaling:
 * anything counting across requests (rate limits today, sessions and caches later)
 * has to live outside the process or it is wrong the moment there is a second replica.
 *
 * ## Connection behaviour
 *
 * `maxRetriesPerRequest: 1` and a short connect timeout, because every caller here is
 * on a request path. A Redis outage must surface in milliseconds as a decision the
 * caller makes deliberately — not as requests piling up behind a client retrying for
 * thirty seconds, which converts a degraded dependency into an outage.
 *
 * `lazyConnect` is deliberately NOT set: connecting at construction means a bad
 * `REDIS_URL` shows up at boot rather than on the first rate-limited request.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ENV],
      useFactory: (env: Env): Redis => {
        const logger = new Logger('Redis');

        const client = new Redis(env.REDIS_URL, {
          maxRetriesPerRequest: 1,
          connectTimeout: 2_000,
          /**
           * Without a bounded backoff a flapping Redis produces a reconnect storm.
           * Capped at 2s: long enough not to hammer a recovering server, short
           * enough that a replica rejoins quickly once it is back.
           */
          retryStrategy: (times: number) => Math.min(times * 200, 2_000),
        });

        /**
         * An 'error' listener is mandatory, not optional hygiene: an ioredis client
         * with no error handler emits an unhandled 'error' event, which crashes the
         * process. A Redis blip must never take the API down.
         */
        client.on('error', (error: Error) => {
          logger.error(`Redis connection error: ${error.message}`);
        });

        client.on('ready', () => logger.log('Redis connected.'));

        return client;
      },
    },
    RedisThrottlerStorage,
  ],
  exports: [REDIS, RedisThrottlerStorage],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /**
   * Closes the connection on SIGTERM so a rolling deploy does not leave sockets open
   * on the server. `quit()` drains in-flight commands; `disconnect()` would drop them.
   */
  async onApplicationShutdown(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      // Already closed, or the server went away first. Shutdown must not fail.
    }
  }
}
