import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { NotificationService } from '../notifications/notification.service.js';
import { QUEUE } from './queue.definitions.js';
import { DeadLetterService } from './dead-letter.service.js';
import { MAIL_JOB, type MailJobData } from './mail.job.js';
import { describeError } from '../common/errors/safe-error.js';
import type { OutgoingMail } from '../mail/mail.service.js';

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

    await this.notifications.deliver(notificationId, templateKey, withRevivedFiles(mail));
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
        `A ${QUEUE.mail} job failed before it could be read: ${describeError(error)}`,
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
      error,
      attempts: job.attemptsMade,
    });
  }
}

/**
 * Puts the attachment Buffers back after the round trip through Redis.
 *
 * ## What was broken
 *
 * A job's data is stored as JSON, and `JSON.stringify(Buffer)` produces
 * `{ "type": "Buffer", "data": [ … ] }` — an ordinary object. So the voucher PDF that
 * `BookingActionsService` attaches to «تأكيد حجزك» arrived here as that object, nodemailer was
 * handed it as a stream chunk, and every confirmation email on the platform failed with
 * `The "chunk" argument must be of type string or an instance of Buffer`.
 *
 * **No customer has ever received a booking confirmation.** It was invisible because
 * `MailService.send` swallowed the error and the row was written down as `sent` — both halves are
 * fixed, and this is the half that makes the mail actually go.
 *
 * ## Why here rather than at either end
 *
 * The queue is where the shape is lost, so the queue is where it is restored. Fixing it in the
 * template would mean every future attachment remembering to encode itself, and fixing it in
 * `MailService` would put queue serialisation knowledge inside something that knows about SMTP.
 *
 * Anything already a Buffer is passed through untouched, so a caller that never went through Redis
 * — a test, a direct call — behaves identically.
 */
function withRevivedFiles(mail: OutgoingMail): OutgoingMail {
  if (!mail.attachments?.length) return mail;

  return {
    ...mail,
    attachments: mail.attachments.map((file) => ({
      ...file,
      content: Buffer.isBuffer(file.content)
        ? file.content
        : Buffer.from((file.content as unknown as { data: number[] }).data ?? []),
    })),
  };
}
