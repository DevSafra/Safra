import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';

import { DATABASE } from '../database/database.module.js';
import { ENV, type Env } from '../config/env.js';
import { NotificationService } from './notification.service.js';
import {
  bookingNeedsActionMail,
  notificationWaitingMail,
} from '../mail/mail.templates.js';
import type { OutgoingMail } from '../mail/mail.service.js';

/**
 * How long a row must sit at `queued` before it counts as lost.
 *
 * Fifteen minutes. A row stays `queued` only while no worker has taken it — a job that runs and
 * exhausts its five attempts marks the row `failed`, not `queued` — so this is not racing the
 * retry schedule. It is long enough that a worker restarting during a deploy is not treated as a
 * catastrophe, and short enough that a partner learns about a booking inside the §6.4 window.
 */
const STALE_AFTER_MINUTES = 15;

/** Bounded per run, so a re-drive after a long outage does not become its own incident. */
const BATCH = 200;

type QueuedRow = {
  id: string;
  template_key: string;
  locale: string;
  booking_id: string | null;
  customer_profile_id: string | null;
  partner_id: string | null;
};

/**
 * Re-sending notices whose jobs were lost, from the database rows alone.
 *
 * ## The gap this closes, and what it honestly cannot
 *
 * `docs/background-jobs-design.md` says a total loss of Redis is survivable because the work can be
 * re-driven from `notifications`. Half of that was true from the start: a `queued` row identifies
 * exactly what was lost, and `safra_notifications_1h{status="queued"}` already alerted on it.
 * Reconstruction did not exist and **could not be written as the document describes**, which the
 * register recorded as an open gap against launch blocker 2 — a restore drill that cannot re-drive
 * has been performed rather than passed.
 *
 * The obstacle is a deliberate choice elsewhere: a `notifications` row carries no recipient, no
 * subject and no body, because every support agent can read that table. The row says a partner was
 * to be told about a review; it cannot say which review.
 *
 * So this does what the row supports and no more:
 *
 * | Template               | Rebuilt from      | Result                                       |
 * | ---------------------- | ----------------- | -------------------------------------------- |
 * | `booking.needs_action` | `booking_id`      | The original notice, in full                 |
 * | `review.received`      | `partner_id`      | "Something is waiting", linking to التقييمات |
 * | `review.replied`       | `customer_profile_id` | ditto, linking to the customer's reviews |
 * | `support.replied`      | either            | ditto, linking to الدعم                      |
 *
 * The third option the register offered — downgrading the claim to "identifiable and unsendable" —
 * is what this replaces. A summary that lands somebody on the right screen is not the original
 * message, and it is not nothing, which is what they got before.
 *
 * ## Why a scheduled job rather than a button
 *
 * A re-drive that needs a human to notice is a re-drive that happens after somebody complains. It
 * runs every five minutes on the `scheduled` queue, costs one indexed query when there is nothing
 * to do, and records what it did in `scheduled_job_runs` like every other recurring job.
 *
 * ## Enqueueing twice is safe
 *
 * `mailJobId` is derived from the notification id, so BullMQ refuses a duplicate while the job
 * exists. A row is only re-driven when its job is genuinely gone — which is the case this is for.
 */
@Injectable()
export class NotificationRedriveService {
  private readonly logger = new Logger(NotificationRedriveService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly notifications: NotificationService,
  ) {}

  /** Finds lost notices, rebuilds what it can, and re-enqueues them. */
  async run(): Promise<Record<string, number>> {
    const stale = await this.db.execute<QueuedRow>(sql`
      SELECT id, template_key, locale, booking_id, customer_profile_id, partner_id
      FROM notifications
      WHERE status = 'queued'
        AND queued_at < now() - (${STALE_AFTER_MINUTES}::int * INTERVAL '1 minute')
      ORDER BY queued_at
      LIMIT ${BATCH}
    `);

    let redriven = 0;
    let unreconstructable = 0;

    for (const row of stale.rows) {
      const mail = await this.rebuild(row);

      if (!mail) {
        /*
          Counted rather than logged per row. The interesting number is how many notices could not
          be rebuilt at all — a recipient who has since been archived, a booking soft-deleted — and
          a log line each would bury it during exactly the incident this runs in.
        */
        unreconstructable += 1;
        continue;
      }

      const sent = await this.notifications.reenqueue(row.id, row.template_key, mail);

      if (sent) redriven += 1;
    }

    if (redriven > 0 || unreconstructable > 0) {
      this.logger.warn(
        `Re-drove ${redriven} lost notification(s); ${unreconstructable} could not be rebuilt.`,
      );
    }

    return { found: stale.rows.length, redriven, unreconstructable };
  }

  /** The mail for one lost row, or nothing if the row no longer points at anybody reachable. */
  private async rebuild(row: QueuedRow): Promise<OutgoingMail | null> {
    if (row.template_key === 'booking.needs_action') return this.rebuildBooking(row);

    const recipient = await this.recipientOf(row);

    if (!recipient) return null;

    /*
      Where to send them, chosen from the TEMPLATE KEY rather than from anything in the row.

      A literal per branch, never a path assembled from data: this URL goes into an email, and an
      email is the one place a crafted value would be followed by somebody who trusts us.
    */
    const url =
      row.template_key === 'review.received'
        ? `${this.env.PARTNER_URL}/reviews`
        : row.template_key === 'support.replied'
          ? recipient.isPartner
            ? `${this.env.PARTNER_URL}/support`
            : `${this.env.APP_URL}/${recipient.locale}/account/support`
          : `${this.env.APP_URL}/${recipient.locale}/account/reviews`;

    return notificationWaitingMail({
      to: recipient.email,
      locale: recipient.locale,
      url,
    });
  }

  /** The one notice the row carries enough to rebuild exactly. */
  private async rebuildBooking(row: QueuedRow): Promise<OutgoingMail | null> {
    if (!row.booking_id) return null;

    const found = await this.db.execute<{
      email: string;
      locale: string | null;
      reference: string;
      property_name: string | null;
      check_in: string;
      check_out: string;
      deadline: string | null;
    }>(sql`
      SELECT u.email, u.preferred_locale AS locale, b.reference,
             coalesce(pr.name_ar, pr.name_en) AS property_name,
             b.check_in::text, b.check_out::text,
             b.confirmation_deadline_at::text AS deadline
      FROM bookings b
      JOIN partners pa  ON pa.id = b.partner_id
      JOIN users u      ON u.id = pa.user_id
      LEFT JOIN properties pr ON pr.id = b.property_id
      WHERE b.id = ${row.booking_id}::uuid
        AND b.deleted_at IS NULL
        /* An archived partner is not emailed, and is why this returns null rather than throwing. */
        AND u.status = 'active'
      LIMIT 1
    `);

    const booking = found.rows[0];

    if (!booking) return null;

    return bookingNeedsActionMail({
      to: booking.email,
      locale: booking.locale ?? row.locale,
      reference: booking.reference,
      property: booking.property_name ?? '',
      checkIn: booking.check_in,
      checkOut: booking.check_out,
      deadline: booking.deadline ?? '',
      url: `${this.env.PARTNER_URL}/`,
    });
  }

  /**
   * Who the row was for, from whichever subject FK it carries.
   *
   * Both are checked because `support.replied` sets one or the other depending on which side of a
   * ticket was answered, and `review.replied` sets both. The partner is preferred when both are
   * present only for the URL; either address is the right recipient for its own template.
   */
  private async recipientOf(
    row: QueuedRow,
  ): Promise<{ email: string; locale: string; isPartner: boolean } | null> {
    if (row.template_key === 'review.replied' && row.customer_profile_id) {
      return this.customer(row);
    }

    if (row.partner_id) {
      const found = await this.db.execute<{ email: string; locale: string | null }>(sql`
        SELECT u.email, u.preferred_locale AS locale
        FROM partners pa JOIN users u ON u.id = pa.user_id
        WHERE pa.id = ${row.partner_id}::uuid AND u.status = 'active'
        LIMIT 1
      `);

      const partner = found.rows[0];

      if (partner) {
        return {
          email: partner.email,
          locale: partner.locale ?? row.locale,
          isPartner: true,
        };
      }
    }

    return this.customer(row);
  }

  private async customer(
    row: QueuedRow,
  ): Promise<{ email: string; locale: string; isPartner: boolean } | null> {
    if (!row.customer_profile_id) return null;

    const found = await this.db.execute<{ email: string; locale: string | null }>(sql`
      SELECT coalesce(cp.email, u.email) AS email, u.preferred_locale AS locale
      FROM customer_profiles cp
      LEFT JOIN users u ON u.id = cp.user_id
      WHERE cp.id = ${row.customer_profile_id}::uuid
        AND (u.id IS NULL OR u.status = 'active')
      LIMIT 1
    `);

    const customer = found.rows[0];

    if (!customer?.email) return null;

    return {
      email: customer.email,
      locale: customer.locale ?? row.locale,
      isPartner: false,
    };
  }
}
