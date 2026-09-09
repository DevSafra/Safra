import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';

import { DATABASE } from '../database/database.module.js';
import { retryWindowMs } from '../queue/queue.definitions.js';
import { scopeFilter } from '../rbac/scope.sql.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
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

/**
 * How long a `failed` row must sit before the retry schedule cannot still be running.
 *
 * Derived from the mail queue's own policy — attempts × the backoff cap — so this and BullMQ
 * cannot disagree about when a retry is still owed. Five attempts at an eight-minute ceiling is
 * thirty-two minutes; a minute is added so a row is never picked up in the same instant its last
 * retry is due.
 *
 * Re-driving earlier would not duplicate anything: `mailJobId` is deterministic, so BullMQ refuses
 * a second job while the first exists. The window is about honesty rather than safety — a row this
 * old is one whose job is GONE, which is the case worth acting on.
 */
const RETRYABLE_AFTER_MINUTES = Math.ceil(retryWindowMs('mail') / 60_000) + 1;

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

  /**
   * Finds lost notices, rebuilds what it can, and re-enqueues them.
   *
   * ## Two states, one recovery, and the second one is finding 235
   *
   * `queued` is a notice no worker ever took — the original case, a Redis loss. `failed` is one an
   * attempt tried and could not deliver, and until 2026-09-09 nothing looked at it: 1,041 rows sat
   * there, 1,036 of them `booking.needs_action`, all with `attempts = 1` and no job left in Redis.
   * They had been attempted once and their retry never fired, so they were neither queued (nothing
   * to take) nor exhausted (the dead-letter path never reached), and every safety net keyed on a
   * state they were not in.
   *
   * A `failed` row is only swept once the retry schedule provably cannot still be running, so this
   * never argues with BullMQ about a row it is still holding. `abandoned` is deliberately NOT swept:
   * its attempts are spent, and re-driving it on a timer would be an infinite loop dressed as a
   * recovery. That one waits for a person, which is what the console's control is for.
   */
  async run(): Promise<Record<string, number>> {
    const stale = await this.db.execute<QueuedRow>(sql`
      SELECT id, template_key, locale, booking_id, customer_profile_id, partner_id
      FROM notifications
      WHERE (
              status = 'queued'
              AND queued_at < now() - (${STALE_AFTER_MINUTES}::int * INTERVAL '1 minute')
            )
         OR (
              status = 'failed'
              /*
                failed_at was not written before 2026-09-09, so the rows this finding is about
                carry NULL there. updated_at is when the failure was recorded for those, and
                queued_at is the floor: a row can never be older than its own acceptance.

                (No backticks in here. They terminate the sql template literal, which is how this
                comment first broke the parse.)
              */
              AND coalesce(failed_at, updated_at, queued_at)
                  < now() - (${RETRYABLE_AFTER_MINUTES}::int * INTERVAL '1 minute')
            )
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

  /**
   * One notice, put back on the queue because a PERSON decided it should be.
   *
   * ## Why this exists beside the scheduled sweep
   *
   * The sweep deliberately refuses `abandoned` rows: their attempts are spent, and re-driving them
   * on a timer would be a loop rather than a recovery. But «spent» is a statement about the mail
   * server, not about whether the notice is still owed — the address has been corrected, the
   * provider is back, the partner rang to say they never heard. Somebody has to be able to say
   * «send it again», and without this the only answer was a database update.
   *
   * ## What it will not do
   *
   * It will not touch a notice that was DELIVERED. `sent` and `delivered` are excluded in the
   * query rather than checked afterwards, so «already went out» answers exactly like «no such
   * row» — a person cannot use this to send a partner a second copy of something they received,
   * which is the one way a manual re-drive could do harm.
   *
   * Beyond that the same guarantees hold as for the sweep: `mailJobId` is derived from the row id,
   * so pressing twice enqueues once, and `attempts` is never reset, so a notice cannot earn
   * unlimited tries by being re-driven repeatedly.
   */
  async redriveOne(
    notificationId: string,
    claims: AccessTokenClaims | undefined,
  ): Promise<'queued' | 'unreconstructable' | null> {
    /*
      The SAME city scope the delivery log is read through.

      MessagingService.notifications filters on coalesce(b.city_id, p.city_id), so a support agent
      scoped to Damascus sees Damascus rows. Without the identical filter here that agent could
      re-send a notice about an Aleppo booking they cannot see — acting on a row outside their
      scope by knowing its id, which is the gap this codebase closes by writing the scope into the
      WHERE clause rather than checking after the read.

      Caught by scope-coverage.test.ts rather than by review: the route reached business data,
      declared no scope, and was not on the exemption list, so the sweep named it.
    */
    const found = await this.db.execute<QueuedRow>(sql`
      SELECT n.id, n.template_key, n.locale, n.booking_id, n.customer_profile_id, n.partner_id
      FROM notifications n
      LEFT JOIN bookings b ON b.id = n.booking_id
      LEFT JOIN partners p ON p.id = n.partner_id
      WHERE n.id = ${notificationId}::uuid
        AND n.deleted_at IS NULL
        AND n.status IN ('queued', 'failed', 'abandoned')
        AND ${scopeFilter(claims, 'coalesce(b.city_id, p.city_id)')}
      LIMIT 1
    `);

    const row = found.rows[0];

    if (!row) return null;

    const mail = await this.rebuild(row);

    if (!mail) return 'unreconstructable';

    const sent = await this.notifications.reenqueue(row.id, row.template_key, mail);

    if (!sent) return 'unreconstructable';

    /*
      `abandoned` is moved back by hand, because `reenqueue` only rescues a `failed` row.

      That asymmetry is deliberate: the scheduled sweep must never resurrect an abandoned notice,
      so the shared path leaves it alone, and the decision to spend more attempts on one belongs
      here — where a person made it.
    */
    await this.db.execute(sql`
      UPDATE notifications
      SET status = 'queued', queued_at = now()
      WHERE id = ${row.id}::uuid AND status = 'abandoned'
    `);

    return 'queued';
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
