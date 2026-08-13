import type { Queue } from 'bullmq';

import type { MailJobData } from './mail.job.js';
import type { MediaJobData } from './media.job.js';

/**
 * A `mail` queue that runs in the test process, with no Redis.
 *
 * ## Why a double rather than a real queue
 *
 * The integration suites that touch notifications are about the DECISION to send one — a guest wrote
 * a review, so the host is told; an internal note was posted, so nobody is. Standing a real BullMQ
 * worker up for each of those would make them depend on Redis, on a worker's polling interval, and
 * on timing, to assert something that has nothing to do with any of the three.
 *
 * ## `autoRun` preserves what those suites were already asserting
 *
 * Before the queue, `notify` sent the mail and marked the row terminal in one call, and the tests
 * assert exactly that: a `sent` row and one message in the transport. With `autoRun` set to the
 * processor's body, `notify` still does all of it synchronously — so those assertions keep their
 * original meaning and additionally prove the two halves compose.
 *
 * ## `jobs` and `drain` are for the tests that care about the SEAM
 *
 * Leaving `autoRun` unset makes this a buffer, which is what a test asserting "the row is queued and
 * nothing has been sent yet" needs. That state is the one the recovery story depends on, and it did
 * not exist before this phase.
 *
 * Built rather than excluded, like `@safra/db`'s `createRollbackDatabase` — test support that several
 * suites share has to live somewhere they can all import.
 */
export interface InlineQueue<T> {
  /** Pass this where a `Queue` is expected. */
  readonly queue: Queue;
  /** Everything enqueued, in order, whether or not it has been run. */
  readonly jobs: T[];
  /** Job ids seen, so a test can assert the deterministic-id contract. */
  readonly jobIds: string[];
  /** When set, `add` runs the job immediately instead of buffering it. */
  autoRun: ((data: T) => Promise<void>) | null;
  /** Runs and clears whatever is buffered. */
  drain(run: (data: T) => Promise<void>): Promise<void>;
}

/**
 * Generic over the job payload, because `media` needs exactly the same double.
 *
 * The two queues differ in what they carry and in nothing else that a test asserting the SEAM cares
 * about: something was enqueued, under a deterministic id, and the row it names is in the state the
 * recovery story depends on. A second copy of this file for `media` would have been forty lines of
 * the same reasoning, and would have drifted the first time one of them gained a behaviour.
 */
export function createInlineQueue<T>(): InlineQueue<T> {
  const jobs: T[] = [];
  const jobIds: string[] = [];

  const inline: InlineQueue<T> = {
    jobs,
    jobIds,
    autoRun: null,

    async drain(run) {
      /* Spliced first, so a job that enqueues another does not extend the loop it is inside. */
      const pending = jobs.splice(0, jobs.length);

      for (const data of pending) await run(data);
    },

    queue: {
      add: async (_name: string, data: T, options?: { jobId?: string }) => {
        jobIds.push(options?.jobId ?? '');

        if (inline.autoRun) {
          /*
            Awaited, so a send failure surfaces where the enqueue happened. `notify` swallows it
            exactly as it swallows an enqueue failure, which is what its callers rely on.
          */
          await inline.autoRun(data);

          return { id: options?.jobId };
        }

        jobs.push(data);

        return { id: options?.jobId };
      },
      /* eslint-disable-next-line @typescript-eslint/require-await -- ditto. */
      close: async () => undefined,
    } as unknown as Queue,
  };

  return inline;
}

/** The `mail` queue's double. Named so existing suites read the same as before. */
export function createInlineMailQueue(): InlineQueue<MailJobData> {
  return createInlineQueue<MailJobData>();
}

/** The `media` queue's double — see `createInlineQueue`. */
export function createInlineMediaQueue(): InlineQueue<MediaJobData> {
  return createInlineQueue<MediaJobData>();
}
