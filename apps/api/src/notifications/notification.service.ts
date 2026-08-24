import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { schema } from '@safra/db';

import { Queue } from 'bullmq';

import { DATABASE } from '../database/database.module.js';
import { MailService, type OutgoingMail } from '../mail/mail.service.js';
import { redactContactDetails } from '../messaging/redaction.js';
import { JOB_OPTIONS } from '../queue/queue.definitions.js';
import { MAIL_JOB, mailJobId, type MailJobData } from '../queue/mail.job.js';
import { MAIL_QUEUE } from '../queue/queue.tokens.js';

/**
 * Telling somebody that something happened, and RECORDING that we told them.
 *
 * ## Why a service rather than calling `MailService` directly
 *
 * `notifications` has existed since the first migration and nothing has ever written a row to it.
 * The console's «سجل المراسلات» therefore showed a catalogue of templates over an empty log: no
 * way to answer "was the partner actually told about this booking?", which is the first question
 * asked when a partner is fined for not responding to a request they say they never saw.
 *
 * That question is the reason this exists. Every send leaves a row naming the template, the
 * channel, the locale, the subject record and the outcome — queued, sent or failed, with the
 * provider's reason. The row is written EITHER WAY, because a failed send is precisely the case
 * somebody needs to see and the case a "log on success" design loses.
 *
 * ## What is deliberately NOT stored
 *
 * The recipient's address, and the message body. The subject FKs identify who was written to
 * without repeating their address in a second table — a log that is read by more people than the
 * database itself (§14, and rule 1's "never log full PII"). Reconstructing "who" means joining to
 * the partner or customer, which is an authorization boundary rather than a free read.
 *
 * ## Failure is contained
 *
 * A notification that cannot be sent must never fail the thing it is about. A guest's review is
 * saved whether or not the partner's mail server is reachable, and a booking is created whether or
 * not the notice went out. So `notify` swallows the send failure, records it, and returns — the
 * caller is told nothing, because there is nothing the caller should do differently.
 *
 * ## It is a queue now
 *
 * Sends used to happen in the request, which was honest for three low-volume notices and wrong for a
 * platform: an unreachable SMTP server added its timeout to a booking. Since 2026-08-13 (BullMQ
 * phase 2) `notify` writes the row and ENQUEUES; `MailProcessor` sends and marks the row terminal.
 *
 * **The row is written before the job exists, and that ordering is load-bearing.** It is what makes
 * a total Redis loss survivable: pending work is recoverable by scanning `notifications` for rows
 * still `queued`, so the queue is never the only record that something is owed. Any future job type
 * must follow the same pattern — `docs/background-jobs-design.md`, "Backup and restore
 * implications".
 *
 * ## What "queued" means in this table now
 *
 * It used to mean "about to be attempted, in this request". It now means "accepted, not yet
 * attempted", which is a state that can outlive the process. The gauge `safra_notifications_1h`
 * already treats `queued` as its own failure when it persists, and that reading is now the correct
 * one rather than a pessimistic one.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly mail: MailService,
    @Inject(MAIL_QUEUE) private readonly queue: Queue,
  ) {}

  /**
   * Sends one email and records the attempt.
   *
   * `subject` carries the FKs the console filters by. They are ids the CALLER already resolved
   * from the record it is acting on, never values from a request — which is what keeps the log
   * from becoming a place a caller can assert arbitrary relationships.
   */
  async notify(
    templateKey: string,
    mail: OutgoingMail,
    locale: string,
    subject: {
      bookingId?: string | undefined;
      disputeId?: string | undefined;
      customerProfileId?: string | undefined;
      partnerId?: string | undefined;
    } = {},
  ): Promise<void> {
    const [row] = await this.db
      .insert(schema.notifications)
      .values({
        channel: 'email',
        templateKey,
        locale,
        status: 'queued',
        ...(subject.bookingId ? { bookingId: subject.bookingId } : {}),
        ...(subject.disputeId ? { disputeId: subject.disputeId } : {}),
        ...(subject.customerProfileId
          ? { customerProfileId: subject.customerProfileId }
          : {}),
        ...(subject.partnerId ? { partnerId: subject.partnerId } : {}),
      })
      .returning({ id: schema.notifications.id });

    if (!row) return;

    try {
      await this.queue.add(
        MAIL_JOB,
        { notificationId: row.id, templateKey, mail } satisfies MailJobData,
        {
          ...JOB_OPTIONS.mail,
          /* Deterministic: re-enqueueing the same notification row is a no-op, not a second email. */
          jobId: mailJobId(row.id),
        },
      );
    } catch (error) {
      /*
        The ENQUEUE failed, which is a different failure from a send failing.

        The row stays `queued` rather than being marked `failed`, because that is the state the
        recovery procedure looks for: a re-drive scans for `queued` rows and enqueues them again.
        Marking it `failed` here would hide it from that scan and turn a recoverable Redis blip into
        a notice nobody is ever told about.
      */
      /*
        REDACTED, like the delivery failure below — and this line was not.

        It printed `error.message` verbatim, and on 2026-08-24 a test run logged
        «SMTP refused the message for host@example.test»: a recipient address in an error log, from
        the one class whose whole job is to keep them out of the record. `deliver()` had been
        redacting since it was written; this path was missed because an ENQUEUE failure is a Redis
        problem in the imagination and a mail-server problem in practice.
      */
      const reason = redactContactDetails(
        error instanceof Error ? error.message : String(error),
      ).body.slice(0, 300);

      this.logger.error(
        `Could not enqueue notification ${templateKey} (${row.id}): ${reason}. ` +
          'The row stays queued and is recoverable by re-drive.',
      );
    }
  }

  /**
   * Records an IN-APP notification — a row the partner's own portal reads.
   *
   * ## Why it is a row and not a message
   *
   * `notifications` has no body column, and deliberately not one. The detail a partner needs about
   * an enforcement action lives on the violation itself — its description, the warning note, the
   * fine and the waiver, all of which مخالفات renders — so a copy of that prose here would be a
   * second version of the same sentences, free to drift from the record an appeal turns on. The row
   * carries WHAT happened and WHEN; the screen it links to carries the detail. That is also the
   * standing requirement that a notification point at an authenticated page rather than restate
   * sensitive detail outside one.
   *
   * ## `sent` immediately, and that is honest
   *
   * There is no provider and no queue: the row IS the delivery. Leaving it `queued` would make the
   * `safra_notifications_1h` gauge read a successful in-app notice as a stuck one, and marking it
   * `delivered` would claim a confirmation nobody gave.
   */
  async recordInApp(
    templateKey: string,
    locale: string,
    subject: { partnerId?: string | undefined; bookingId?: string | undefined } = {},
  ): Promise<void> {
    await this.db.insert(schema.notifications).values({
      channel: 'in_app',
      templateKey,
      locale,
      status: 'sent',
      sentAt: new Date(),
      ...(subject.partnerId ? { partnerId: subject.partnerId } : {}),
      ...(subject.bookingId ? { bookingId: subject.bookingId } : {}),
    });
  }

  /**
   * Puts a lost notification back on the queue, from a mail somebody else rebuilt.
   *
   * ## Why this is separate from `notify`
   *
   * `notify` writes a row and enqueues. A re-drive already HAS the row — it is the thing that
   * identified the loss — so calling `notify` would write a second one, and the delivery log would
   * show two notices where one was owed. That log is the first thing read when somebody disputes a
   * §6.4 fine, so an extra row is not a cosmetic problem.
   *
   * ## The enqueue failure is swallowed, again
   *
   * Same reasoning as `notify`, and more so here: this runs inside a recurring job during whatever
   * incident lost the queue in the first place. A throw would fail the whole batch on the first
   * row, and that row would still be `queued` — so the next occurrence would try it first and fail
   * identically. Returning false lets the batch continue and the count be honest.
   *
   * `mailJobId` is deterministic, so a row whose job still exists is refused by BullMQ rather than
   * sent twice. That is the safety net that makes re-driving optimistically the right default.
   */
  async reenqueue(
    notificationId: string,
    templateKey: string,
    mail: OutgoingMail,
  ): Promise<boolean> {
    try {
      await this.queue.add(
        MAIL_JOB,
        { notificationId, templateKey, mail } satisfies MailJobData,
        { ...JOB_OPTIONS.mail, jobId: mailJobId(notificationId) },
      );

      return true;
    } catch (error) {
      this.logger.error(
        `Could not re-drive notification ${notificationId}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );

      return false;
    }
  }

  /**
   * Sends the mail and marks the row terminal. Called by the worker, never by a request.
   *
   * ## Why the worker calls back into this class
   *
   * The `notifications` row and the send are one unit of meaning, and the code that knows how to
   * record an outcome is here — including the redaction the failure reason needs. A processor that
   * wrote those updates itself would be a second place that knows the table's states, and the two
   * would drift the first time a status was added.
   *
   * ## It THROWS on failure, unlike `notify`
   *
   * `notify` swallows, because its caller is a booking or a review that must not be undone by a mail
   * server. This is the opposite: the worker's caller is BullMQ, and throwing is how a job asks to be
   * retried. Swallowing here would report every failed send as a success and retire the job.
   */
  async deliver(
    notificationId: string,
    templateKey: string,
    mail: OutgoingMail,
  ): Promise<void> {
    try {
      await this.mail.send(mail);

      await this.db.execute(sql`
        UPDATE notifications
        SET status = 'sent', sent_at = now(), attempts = attempts + 1
        WHERE id = ${notificationId}
      `);
    } catch (error) {
      /*
        The provider's words, REDACTED and truncated.

        Never stored verbatim: an SMTP rejection routinely quotes the address it refused —
        "550 5.1.1 <someone@example.com> recipient not found" — and writing that here would put an
        email address into the very table this class keeps free of them. Redaction is applied
        rather than assumed, because the string comes from somebody else's server and there is no
        format to rely on.
      */
      const reason = redactContactDetails(
        error instanceof Error ? error.message : 'unknown',
      ).body.slice(0, 300);

      /*
        `failed` is written on EVERY attempt, not only the last one, and `attempts` counts up. So a
        row that is retried reads as failed between attempts and becomes `sent` when one succeeds —
        which is the honest description of where it is, and what the delivery log is for.
      */
      await this.db.execute(sql`
        UPDATE notifications
        SET status = 'failed', failure_reason = ${reason}, attempts = attempts + 1
        WHERE id = ${notificationId}
      `);

      this.logger.warn(`Notification ${templateKey} failed to send: ${reason}`);

      /* Rethrown so BullMQ retries. See the method note. */
      throw error;
    }
  }
}
