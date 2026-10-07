import type { JobsOptions, Queue } from 'bullmq';

/** What happened to one re-drive. */
export type RequeueOutcome =
  /** The finished job under this id was moved back to waiting, with its original payload. */
  | 'retried'
  /** No job held the id, so a new one was added with the payload the caller built. */
  | 'added'
  /** A job under this id is waiting, delayed or running — or another re-drive just retried it. */
  | 'in_flight'
  /** A job under this id already COMPLETED and the caller asked not to repeat it. */
  | 'completed'
  /** No job held the id and the caller had nothing to build one from. */
  | 'unbuildable';

/**
 * Gets a job running again under its deterministic id, whatever state its last run left it in.
 *
 * ## The bug this exists for
 *
 * Every re-drive in this codebase leant on «the job id is deterministic, so BullMQ refuses a
 * duplicate». True, and only half the sentence: BullMQ refuses a duplicate while ANY job holds the
 * id, finished ones included. `removeOnFail: false` keeps a failed job in Redis for ever, on
 * purpose, and `removeOnComplete` keeps a completed one for a day. So the re-drive of a notice whose
 * job had exhausted its attempts, and of a render whose job had failed, called `add`, received the
 * OLD job back, reported success, and nothing ran. The console's re-drive answered «queued» over a
 * mail that never left, and the sweep found the same row and did the same nothing every five
 * minutes.
 *
 * ## So the id is asked about first
 *
 * - **Waiting, delayed, active** — a run is already owed. Left alone: two re-drives, or a re-drive
 *   racing a slow worker, still cost one run.
 * - **Failed** — RETRIED in place, which BullMQ does atomically and only from the state named: of
 *   two re-drives that both saw `failed`, one moves it and the other is refused, so a person pressing
 *   twice still sends once. Its attempt counter is reset, because the policy's retries are what make
 *   a run worth having; the `notifications.attempts` column is what bounds a notice for good.
 * - **Completed** — the caller decides. A render is claimed against its row, so running one twice is
 *   harmless; a mail that completed WAS SENT, and sending it again is the one thing a re-drive must
 *   never do.
 * - **Gone** — a new job, from the payload the caller builds.
 *
 * A retried job keeps its ORIGINAL payload. For a mail that is the message exactly as it was
 * composed — template, links, attachment — which is better than anything a re-drive can rebuild from
 * a row that deliberately stores no body. For a render it is the same keys the row holds, since both
 * ids are derived from them.
 */
export async function requeue<T>(
  queue: Queue,
  name: string,
  options: JobsOptions & { jobId: string },
  build: () => T | null | Promise<T | null>,
  { repeatCompleted }: { repeatCompleted: boolean },
): Promise<RequeueOutcome> {
  const existing = await queue.getJob(options.jobId);

  if (existing) {
    const state = await existing.getState();

    if (state === 'completed' && !repeatCompleted) return 'completed';

    if (state === 'failed' || state === 'completed') {
      try {
        await existing.retry(state, {
          resetAttemptsMade: true,
          resetAttemptsStarted: true,
        });

        return 'retried';
      } catch {
        /*
          Refused because it is no longer in that state: another re-drive, or a person in a
          dashboard, moved it first. Either way a run is owed and is not ours to add.
        */
        return 'in_flight';
      }
    }

    if (state !== 'unknown') return 'in_flight';
  }

  const payload = await build();

  if (payload === null) return 'unbuildable';

  await queue.add(name, payload, options);

  return 'added';
}
