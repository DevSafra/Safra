import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { schema } from '@safra/db';

import { DATABASE } from '../database/database.module.js';
import { MailService, type OutgoingMail } from '../mail/mail.service.js';
import { redactContactDetails } from '../messaging/redaction.js';

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
 * ## Not a queue, yet
 *
 * Sends happen in the request. That is honest for three low-volume notices and wrong for a
 * platform: a slow mail server becomes a slow API. `docs/FUTURE-WORK.md` carries the queue as
 * item 9 (BullMQ), deferred until the hosting decision is made. Until then this is the seam it
 * will move behind — every send already goes through one method with a recorded outcome.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly mail: MailService,
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
      await this.mail.send(mail);

      await this.db.execute(sql`
        UPDATE notifications
        SET status = 'sent', sent_at = now(), attempts = attempts + 1
        WHERE id = ${row.id}
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

      await this.db.execute(sql`
        UPDATE notifications
        SET status = 'failed', failure_reason = ${reason}, attempts = attempts + 1
        WHERE id = ${row.id}
      `);

      this.logger.warn(`Notification ${templateKey} failed to send: ${reason}`);
    }
  }
}
