/**
 * Queue injection tokens, in their own file.
 *
 * The same cycle `redis.tokens.ts` exists to break: `QueueModule` provides the producers, and the
 * services that inject them are imported by the module. Under ESM the decorator metadata is
 * evaluated before the cycle resolves, and the process dies at boot with "Cannot access before
 * initialization" — a failure only reachable by STARTING the application, which is how it was
 * missed the first time.
 */

/** The ioredis connection BullMQ uses. Not the throttler's — see `queue.module.ts`. */
export const QUEUE_REDIS = Symbol('QUEUE_REDIS');

/** The `mail` queue's producer handle. */
export const MAIL_QUEUE = Symbol('MAIL_QUEUE');

/** The `media` queue's producer handle. */
export const MEDIA_QUEUE = Symbol('MEDIA_QUEUE');

/** The `scheduled` queue's producer handle — recurring jobs are declared through it. */
export const SCHEDULED_QUEUE = Symbol('SCHEDULED_QUEUE');

/** The `exports` queue's producer handle. */
export const EXPORTS_QUEUE = Symbol('EXPORTS_QUEUE');
