import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { NotificationService } from '../notifications/notification.service.js';
import { QUEUE } from './queue.definitions.js';
import { DeadLetterService } from './dead-letter.service.js';
import { MAIL_JOB, type MailJobData } from './mail.job.js';

/**
 * The `mail` queue's worker-side body.
 *
 * ## Thin on purpose
 *
 * It resolves the job to a call on `NotificationService.deliver`, and that is all. The knowledge of
 * how a notification is recorded — which states exist, what gets redacted — stays in the service that
 * owns the table. A processor that wrote those updates itself would be a second place that knows the
 * notification lifecycle, and the two would part company the first time a status was added.
 *
 * ## What it does with a failure
 *
 * Nothing. It lets `deliver` throw, because throwing is how a job asks BullMQ to retry it, and the
 * retry policy is declared once in `queue.definitions.ts` rather than re-decided here. The only thing
 * this class adds is the LAST-attempt case: when a job has no attempts left, `onFailed` copies it to
 * `dead_letter_jobs`, because BullMQ's own `failed` set is in Redis and nothing reads it.
 */
@Injectable()
export class MailProcessor {
  private readonly logger = new Logger(MailProcessor.name);

  constructor(
    private readonly notifications: NotificationService,
    private readonly deadLetters: DeadLetterService,
  ) {}

  /** Runs one job. Throws to request a retry. */
  async process(job: Job<MailJobData>): Promise<void> {
    if (job.name !== MAIL_JOB) {
      /*
        An unknown job name is a deploy skew, not a transient fault: an older worker meeting a job a
        newer API enqueued. Retrying cannot help — the code that understands it is not here — so it
        fails once and dead-letters, where somebody can retry it after the workers are updated.
      */
      throw new Error(`Unknown job name on the ${QUEUE.mail} queue: ${job.name}`);
    }

    const { notificationId, templateKey, mail } = job.data;

    await this.notifications.deliver(notificationId, templateKey, mail);
  }

  /**
   * Called on every failed attempt; records only the last one.
   *
   * `attemptsMade < attempts` means BullMQ will try again, and a dead letter per attempt would turn
   * one broken address into five rows and five pages.
   */
  async onFailed(job: Job<MailJobData> | undefined, error: Error): Promise<void> {
    if (!job) {
      /* A job that could not even be deserialised. There is nothing to record it against. */
      this.logger.error(
        `A ${QUEUE.mail} job failed before it could be read: ${error.message}`,
      );

      return;
    }

    const attempts = job.opts.attempts ?? 1;

    if (job.attemptsMade < attempts) return;

    await this.deadLetters.record({
      queue: QUEUE.mail,
      name: job.name,
      jobId: String(job.id ?? ''),
      payload: job.data,
      error: error.message,
      attempts: job.attemptsMade,
    });
  }
}
