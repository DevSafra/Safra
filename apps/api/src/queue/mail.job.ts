import type { OutgoingMail } from '../mail/mail.service.js';

/** The one job the `mail` queue carries, so far. */
export const MAIL_JOB = 'notification.send' as const;

/**
 * What a worker needs to send one notification and record the outcome.
 *
 * ## Why the notification's row id travels with it
 *
 * The producer writes the `notifications` row as `queued` and then enqueues. The worker sends and
 * then marks that row `sent` or `failed`. So the id is the link between the two halves, and it is
 * what makes the design's recovery story true: **a lost job is recoverable by scanning for rows
 * without a terminal state.** Without the id the worker would have to guess which row it was
 * completing, and a job that lost its Redis entry would leave a row nobody could resolve.
 *
 * ## Why the rendered mail travels too, rather than a template key and parameters
 *
 * Re-rendering in the worker would put the recipient's locale, the catalogue and the interpolation
 * on the far side of the queue, where a template change between enqueue and run would silently alter
 * a message somebody has already been told was sent. Rendering once, at the moment the decision was
 * made, is what makes the job a description of a specific email rather than an instruction to
 * compose one.
 *
 * The cost is that the payload contains an address and a body, which is why `DeadLetterService`
 * redacts before storing and why nothing else is allowed to persist it.
 */
export interface MailJobData {
  /** The `notifications` row this job completes. */
  readonly notificationId: string;
  readonly templateKey: string;
  readonly mail: OutgoingMail;
}

/**
 * A deterministic job id, so the same notification cannot be enqueued twice.
 *
 * BullMQ refuses a duplicate id while the job exists, which makes at-least-once delivery safe **at
 * the queue level** as well as at the database level. A retried request that re-enqueues the same
 * notification row is a no-op rather than a second email.
 *
 * ## A dash, not a colon
 *
 * `docs/background-jobs-design.md` writes this convention as `notification:<id>`, and BullMQ will not
 * accept it: **`Custom Id cannot contain :`**, because the colon is its own key separator and an id
 * containing one could address another queue's keys. The design was written against the convention
 * rather than against the library. Found the first time a job was enqueued (2026-08-13); the doc is
 * corrected to match.
 *
 * The failure was quiet in exactly the way that matters: `notify` catches an enqueue error so a
 * booking is never undone by Redis, so every notification was logged as un-enqueued and nothing was
 * ever sent. The integration test that caught it asserts the row reaches `sent`, not that `add`
 * resolved.
 */
export function mailJobId(notificationId: string): string {
  return `notification-${notificationId}`;
}
