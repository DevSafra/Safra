import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { resolveLocale } from '@safra/i18n';

import { DATABASE } from '../database/database.module.js';
import { retryWindowMs } from '../queue/queue.definitions.js';
import { assertCanWrite, scopeFilter } from '../rbac/scope.sql.js';
import { NOTIFICATION_CITY, NOTIFICATION_SUBJECT_JOINS } from './notification-scope.js';
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
  dispute_id: string | null;
  customer_profile_id: string | null;
  partner_id: string | null;
};

/** The two notices whose content is a booking still waiting on its partner. */
const BOOKING_NOTICES = new Set(['booking.needs_action', 'partner.deadline_reminder']);

/** What a rebuilt «something is waiting» link may be built from — references, never row text. */
type LinkParts = {
  readonly partnerUrl: string;
  readonly appUrl: string;
  readonly locale: string;
  readonly booking: string | null;
  readonly dispute: string | null;
};

type Route = {
  readonly audience: 'partner' | 'customer' | 'either';
  readonly partner?: (parts: LinkParts) => string;
  readonly customer?: (parts: LinkParts) => string;
};

const toPartner = (path: (parts: LinkParts) => string): Route => ({
  audience: 'partner',
  partner: path,
});

const toCustomer = (path: (parts: LinkParts) => string): Route => ({
  audience: 'customer',
  customer: path,
});

const partnerDispute = toPartner(({ partnerUrl, dispute }) =>
  dispute
    ? `${partnerUrl}/disputes/${encodeURIComponent(dispute)}`
    : `${partnerUrl}/disputes`,
);

const customerBooking = toCustomer(({ appUrl, locale, booking }) =>
  booking
    ? `${appUrl}/${locale}/account/bookings/${encodeURIComponent(booking)}`
    : `${appUrl}/${locale}/account/bookings`,
);

/**
 * Where each template's notice sends its reader, when only the row survives.
 *
 * ## Why every key is written out
 *
 * This was a three-way conditional whose last branch was the customer's reviews page — so every
 * template it did not name went there. A partner whose dispute closed, a customer whose refund was
 * on its way, a partner who had been fined: each was told «something is waiting» and handed a link
 * to a customer screen about reviews, the partner on a site they cannot even sign in to. Twelve of
 * the sixteen templates that write rows took that branch.
 *
 * A template missing from this table is NOT re-sent with a guess. It is reported unreconstructable,
 * which a person can see on سجل المراسلات and act on; a wrong link in somebody's inbox is the
 * one outcome that cannot be taken back. `notification-redrive-coverage.test.ts` fails if a
 * template anything sends is neither here nor in `BOOKING_NOTICES`.
 *
 * Each destination is the screen the ORIGINAL notice pointed at, or its list where the original
 * named a record the row cannot (a support ticket: the row carries the person, not the thread).
 * Literal paths and references read from the database by id, never text taken from a row: this
 * URL goes into an email, which is the one place a crafted value would be followed by somebody who
 * trusts us.
 */
export const WAITING_ROUTES: Readonly<Record<string, Route>> = {
  'review.received': toPartner(({ partnerUrl }) => `${partnerUrl}/reviews`),
  'partner.dispute_opened': partnerDispute,
  'partner.dispute_under_review': partnerDispute,
  'dispute.payout_released': partnerDispute,
  'partner.warned': toPartner(({ partnerUrl }) => `${partnerUrl}/violations`),
  'partner.fined': toPartner(({ partnerUrl }) => `${partnerUrl}/violations`),
  'partner.fine_waived': toPartner(({ partnerUrl }) => `${partnerUrl}/violations`),
  'partner.suspended': toPartner(({ partnerUrl }) => `${partnerUrl}/`),
  'partner.unsuspended': toPartner(({ partnerUrl }) => `${partnerUrl}/`),
  'review.replied': toCustomer(
    ({ appUrl, locale }) => `${appUrl}/${locale}/account/reviews`,
  ),
  'booking.confirmed': customerBooking,
  'booking.refunded': customerBooking,
  'booking.cancelled_refund': customerBooking,
  'booking.invoice': toCustomer(({ appUrl, locale, booking }) =>
    booking
      ? `${appUrl}/${locale}/account/invoices/${encodeURIComponent(booking)}`
      : `${appUrl}/${locale}/account/invoices`,
  ),
  'dispute.resolved': toCustomer(
    ({ appUrl, locale }) => `${appUrl}/${locale}/account/disputes`,
  ),
  'dispute.rejected': toCustomer(
    ({ appUrl, locale }) => `${appUrl}/${locale}/account/disputes`,
  ),
  'support.replied': {
    audience: 'either',
    partner: ({ partnerUrl }) => `${partnerUrl}/support`,
    customer: ({ appUrl, locale }) => `${appUrl}/${locale}/account/support`,
  },
  'support.closed': {
    audience: 'either',
    partner: ({ partnerUrl }) => `${partnerUrl}/support`,
    customer: ({ appUrl, locale }) => `${appUrl}/${locale}/account/support`,
  },
};

/** The templates a lost job can be re-sent for, in full or as a «something is waiting» notice. */
export function isRedrivable(templateKey: string): boolean {
  return BOOKING_NOTICES.has(templateKey) || templateKey in WAITING_ROUTES;
}

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
      SELECT id, template_key, locale, booking_id, dispute_id, customer_profile_id, partner_id
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
      const outcome = await this.resend(row);

      if (outcome === 'queued') redriven += 1;

      if (outcome === 'unreconstructable') {
        /*
          Counted rather than logged per row. The interesting number is how many notices could not
          be rebuilt at all — a recipient who has since been archived, a booking already answered —
          and a log line each would bury it during exactly the incident this runs in.

          And moved to `abandoned`, which the sweep does not read. Left where it was, the row came
          back on every tick, oldest first, and two hundred of them filled the batch for good: the
          sweep then reported «found 200, re-drove 0» while the notices behind them waited. A person
          can still press re-drive on an abandoned row, which is where a decision about it belongs.
        */
        unreconstructable += 1;

        await this.db.execute(sql`
          UPDATE notifications SET status = 'abandoned'
          WHERE id = ${row.id}::uuid AND status IN ('queued', 'failed')
        `);
      }
    }

    if (redriven > 0 || unreconstructable > 0) {
      this.logger.warn(
        `Re-drove ${redriven} lost notification(s); ${unreconstructable} could not be rebuilt.`,
      );
    }

    return { found: stale.rows.length, redriven, unreconstructable };
  }

  /**
   * One row back on the queue, if it is still owed and can still be sent.
   *
   * «Still owed» is asked BEFORE the queue is, because the original job — which is what gets re-sent
   * when Redis still has it — is a description of a moment. A partner told today that a booking
   * needs their answer, when they answered it yesterday or it expired at noon, is being told
   * something false with our name on it.
   */
  private async resend(
    row: QueuedRow,
  ): Promise<'queued' | 'in_flight' | 'delivered' | 'unreconstructable' | 'error'> {
    if (!isRedrivable(row.template_key)) return 'unreconstructable';

    if (
      BOOKING_NOTICES.has(row.template_key) &&
      !(await this.stillAwaitingPartner(row))
    ) {
      return 'unreconstructable';
    }

    return this.notifications.reenqueue(row.id, row.template_key, () =>
      this.rebuild(row),
    );
  }

  /** The mail for one lost row, or nothing if the row no longer points at anybody reachable. */
  private async rebuild(row: QueuedRow): Promise<OutgoingMail | null> {
    if (BOOKING_NOTICES.has(row.template_key)) return this.rebuildBooking(row);

    const route = WAITING_ROUTES[row.template_key];

    if (!route) return null;

    const recipient =
      route.audience === 'partner' || (route.audience === 'either' && row.partner_id)
        ? await this.partnerOf(row)
        : await this.customerOf(row);

    if (!recipient) return null;

    const path = recipient.isPartner ? route.partner : route.customer;

    if (!path) return null;

    const references = await this.referencesOf(row);

    return notificationWaitingMail({
      to: recipient.email,
      locale: recipient.locale,
      url: path({
        partnerUrl: this.env.PARTNER_URL,
        appUrl: this.env.APP_URL,
        /* Resolved, because it becomes a path segment and the customer site serves three. */
        locale: resolveLocale(recipient.locale),
        booking: references.booking,
        dispute: references.dispute,
      }),
    });
  }

  /** The booking's and the dispute's REFERENCES, for links that name a record. */
  private async referencesOf(
    row: QueuedRow,
  ): Promise<{ booking: string | null; dispute: string | null }> {
    if (!row.booking_id && !row.dispute_id) return { booking: null, dispute: null };

    const found = await this.db.execute<{
      booking: string | null;
      dispute: string | null;
    }>(sql`
      SELECT
        (SELECT reference FROM bookings WHERE id = ${row.booking_id}::uuid) AS booking,
        (SELECT reference FROM disputes WHERE id = ${row.dispute_id}::uuid) AS dispute
    `);

    return {
      booking: found.rows[0]?.booking ?? null,
      dispute: found.rows[0]?.dispute ?? null,
    };
  }

  /** Whether the booking a partner notice is about is still waiting on that partner. */
  private async stillAwaitingPartner(row: QueuedRow): Promise<boolean> {
    if (!row.booking_id) return false;

    const found = await this.db.execute<{ id: string }>(sql`
      SELECT id FROM bookings
      WHERE id = ${row.booking_id}::uuid
        AND deleted_at IS NULL
        AND status = 'pending_confirmation'
      LIMIT 1
    `);

    return found.rows.length > 0;
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

      MessagingService.notifications filters on NOTIFICATION_CITY, so a support agent
      scoped to Damascus sees Damascus rows. Without the identical filter here that agent could
      re-send a notice about an Aleppo booking they cannot see — acting on a row outside their
      scope by knowing its id, which is the gap this codebase closes by writing the scope into the
      WHERE clause rather than checking after the read.

      Caught by scope-coverage.test.ts rather than by review: the route reached business data,
      declared no scope, and was not on the exemption list, so the sweep named it.
    */
    const found = await this.db.execute<QueuedRow & { city_id: string | null }>(sql`
      SELECT n.id, n.template_key, n.locale, n.booking_id, n.dispute_id,
             n.customer_profile_id, n.partner_id,
             ${sql.raw(NOTIFICATION_CITY)} AS city_id
      FROM notifications n
      ${NOTIFICATION_SUBJECT_JOINS}
      WHERE n.id = ${notificationId}::uuid
        AND n.deleted_at IS NULL
        AND n.status IN ('queued', 'failed', 'abandoned')
        AND ${scopeFilter(claims, NOTIFICATION_CITY)}
      LIMIT 1
    `);

    const row = found.rows[0];

    if (!row) return null;

    /*
      The read above lets a member whose scope is read-only outside their cities SEE every notice;
      a re-drive sends mail, so it is a write and is held to the write rule (security pass,
      2026-10-06). `NOTIFICATION_CITY` is a constant expression, not input.
    */
    assertCanWrite(claims, row.city_id);

    const outcome = await this.resend(row);

    /*
      A job that COMPLETED was accepted by the provider: the notice went out, whatever the row
      says. Answered exactly like a delivered row — the guard above, reached from the other side.
    */
    if (outcome === 'delivered') return null;

    if (outcome === 'unreconstructable' || outcome === 'error')
      return 'unreconstructable';

    /* Already waiting on a worker: nothing to add, and «queued» is where it is. */
    if (outcome === 'in_flight') return 'queued';

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
        /* Only while it is still waiting, as resend asks first. Checked again here, at the read. */
        AND b.status = 'pending_confirmation'
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
   * The partner a row was for — its own `partner_id`, or the partner of the booking it is about.
   *
   * Only when the row is FOR a partner: the route decides that, from the template, so a customer
   * notice that happens to carry a booking is never redirected to that booking's host.
   */
  private async partnerOf(
    row: QueuedRow,
  ): Promise<{ email: string; locale: string; isPartner: boolean } | null> {
    const found = await this.db.execute<{ email: string; locale: string | null }>(sql`
      SELECT u.email, u.preferred_locale AS locale
      FROM partners pa JOIN users u ON u.id = pa.user_id
      WHERE pa.id = coalesce(
              ${row.partner_id}::uuid,
              (SELECT partner_id FROM bookings WHERE id = ${row.booking_id}::uuid)
            )
        AND u.status = 'active'
      LIMIT 1
    `);

    const partner = found.rows[0];

    if (!partner) return null;

    return {
      email: partner.email,
      locale: partner.locale ?? row.locale,
      isPartner: true,
    };
  }

  /** The customer a row was for — its own profile, or the booking's guest. */
  private async customerOf(
    row: QueuedRow,
  ): Promise<{ email: string; locale: string; isPartner: boolean } | null> {
    const found = await this.db.execute<{
      email: string | null;
      locale: string | null;
    }>(sql`
      SELECT coalesce(cp.email, u.email) AS email, u.preferred_locale AS locale
      FROM customer_profiles cp
      LEFT JOIN users u ON u.id = cp.user_id
      WHERE cp.id = coalesce(
              ${row.customer_profile_id}::uuid,
              (SELECT customer_profile_id FROM bookings WHERE id = ${row.booking_id}::uuid)
            )
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
