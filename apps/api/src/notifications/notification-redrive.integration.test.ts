import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { createRollbackDatabase, type Database } from '@safra/db';

import { NotificationService } from './notification.service.js';
import { NotificationRedriveService } from './notification-redrive.service.js';
import { createInlineMailQueue } from '../queue/queue.testing.js';
import type { MailService } from '../mail/mail.service.js';
import type { Env } from '../config/env.js';

/**
 * Re-driving notices whose jobs were lost — the recovery half of `O-notify-2`.
 *
 * ## What this proves, and why it needed proving
 *
 * `docs/background-jobs-design.md` claimed a total loss of Redis was survivable because the work
 * could be re-driven from `notifications`. Detection worked. Reconstruction did not exist, and the
 * register recorded it as an open gap against launch blocker 2 — because a restore drill that
 * cannot re-drive has been performed rather than passed.
 *
 * So the assertions here are exactly the drill: rows that were queued and never sent, a Redis that
 * knows nothing about them, and afterwards an email for each one that could be rebuilt.
 *
 * ## And what it proves it does NOT do
 *
 * Three of the four templates cannot be rebuilt faithfully, because a `notifications` row carries
 * no recipient, subject or body by design — every support agent reads that table. Those are
 * re-driven as "something is waiting, here is where". The test asserts that the summary goes to the
 * right person at the right address rather than pretending the original was recovered.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('re-driving lost notifications', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  const sent: { to: string; subject: string; text: string }[] = [];
  const mail = {
    send: (message: { to: string; subject: string; text: string }) => {
      sent.push(message);

      return Promise.resolve();
    },
  } as unknown as MailService;

  const env = {
    APP_URL: 'https://safra.test',
    PARTNER_URL: 'https://partner.safra.test',
  } as Env;

  let queue = createInlineMailQueue();
  let notifications: NotificationService;
  let redrive: NotificationRedriveService;

  let partnerId = '';
  let partnerEmail = '';
  let bookingId = '';

  beforeEach(async () => {
    await harness.begin();
    sent.length = 0;

    /*
      A clean slate, INSIDE the transaction this test rolls back.

      The development database holds 34 genuinely `queued` notifications — the ones stranded by the
      job-id defect this whole area exists to recover from — and this service is deliberately
      global: it re-drives every lost notice it finds, which is the point of it. So an assertion
      like "one was re-driven" counts those too, and reads as a bug in the code under test rather
      than as the test measuring the wrong set.

      Marking them terminal here scopes every count below to the rows this test writes. Nothing
      escapes the rollback, and the real rows are untouched — the first version of this test
      reported 35 where it expected 1, which is exactly how that mistake announces itself.
    */
    await db.execute(
      sql`UPDATE notifications SET status = 'sent' WHERE status = 'queued'`,
    );

    queue = createInlineMailQueue();
    notifications = new NotificationService(db, mail, queue.queue);
    redrive = new NotificationRedriveService(db, env, notifications);

    const seeded = await seed();

    partnerId = seeded.partnerId;
    partnerEmail = seeded.partnerEmail;
    bookingId = seeded.bookingId;
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  /** A row that was queued and whose job is gone — the state a lost Redis leaves behind. */
  const lose = async (
    templateKey: string,
    subject: { bookingId?: string; partnerId?: string; customerProfileId?: string },
    ageMinutes = 60,
  ): Promise<string> => {
    const inserted = await db.execute<{ id: string }>(sql`
      INSERT INTO notifications (channel, template_key, locale, status, queued_at,
                                 booking_id, partner_id, customer_profile_id)
      VALUES ('email', ${templateKey}, 'ar', 'queued',
              now() - (${ageMinutes}::int * INTERVAL '1 minute'),
              ${subject.bookingId ?? null}::uuid,
              ${subject.partnerId ?? null}::uuid,
              ${subject.customerProfileId ?? null}::uuid)
      RETURNING id
    `);

    const id = inserted.rows[0]?.id;

    if (!id) throw new Error('Notification fixture produced no row.');

    return id;
  };

  // ─── The drill ─────────────────────────────────────────────────────────────

  /**
   * The one notice the row carries enough to rebuild in full.
   *
   * `booking_id` is a complete instruction: the partner, their address, the reference, the dates
   * and the deadline all follow from it. This is the notice where a summary would be a real loss,
   * because §6.4 gives the partner a bounded window and the original says when it closes.
   */
  it('rebuilds booking.needs_action in full, from the booking id', async () => {
    await lose('booking.needs_action', { bookingId, partnerId });

    const result = await redrive.run();

    expect(result['redriven']).toBe(1);
    expect(queue.jobs).toHaveLength(1);

    const mailSent = queue.jobs[0]?.mail;

    expect(mailSent?.to).toBe(partnerEmail);
    /* The reference is IN it — that is what makes this a rebuild rather than a summary. */
    expect(mailSent?.text).toContain('BKG-');
  });

  /** The three that cannot be rebuilt are re-driven as a summary, to the right screen. */
  it('re-drives review.received as a notice pointing at the partner´s reviews', async () => {
    await lose('review.received', { partnerId });

    const result = await redrive.run();

    expect(result['redriven']).toBe(1);
    expect(queue.jobs[0]?.mail.to).toBe(partnerEmail);
    expect(queue.jobs[0]?.mail.text).toContain('https://partner.safra.test/reviews');
  });

  // ─── What it must not do ───────────────────────────────────────────────────

  /**
   * A notice queued a moment ago is IN FLIGHT, not lost.
   *
   * Without the age window this would re-drive every notification the instant it was written,
   * which is a second email for every notice the platform sends — the opposite of the problem it
   * exists to solve.
   */
  it('leaves a recently queued notice alone', async () => {
    await lose('review.received', { partnerId }, 1);

    const result = await redrive.run();

    expect(result['found']).toBe(0);
    expect(queue.jobs).toHaveLength(0);
  });

  /** A notice that was already sent is not sent again. */
  it('ignores anything that reached a terminal state', async () => {
    const id = await lose('review.received', { partnerId });

    await db.execute(
      sql`UPDATE notifications SET status = 'sent' WHERE id = ${id}::uuid`,
    );

    const result = await redrive.run();

    expect(result['found']).toBe(0);
  });

  /**
   * A row whose subject no longer resolves is COUNTED, not skipped silently.
   *
   * The number of notices that could not be rebuilt is the interesting figure during the incident
   * this runs in, and a re-drive that reported only its successes would describe a recovery that
   * was more complete than it was.
   */
  it('counts a notice it cannot rebuild rather than hiding it', async () => {
    await lose('review.received', {});

    const result = await redrive.run();

    expect(result['found']).toBe(1);
    expect(result['redriven']).toBe(0);
    expect(result['unreconstructable']).toBe(1);
  });

  /**
   * Re-driving the same row twice does not send two emails.
   *
   * `mailJobId` is derived from the notification id, so BullMQ refuses the duplicate. The row stays
   * `queued` until a worker sends it, so a second occurrence five minutes later WILL find it again
   * — which is correct, and must be harmless.
   */
  it('does not send twice when it runs again before the worker does', async () => {
    await lose('review.received', { partnerId });

    await redrive.run();
    await redrive.run();

    expect(queue.jobIds).toHaveLength(2);
    /* The same deterministic id both times — which is what BullMQ deduplicates on. */
    expect(new Set(queue.jobIds).size).toBe(1);
  });

  /** A partner with one paid booking, so a lost notice has something to point at. */
  async function seed(): Promise<{
    partnerId: string;
    partnerEmail: string;
    bookingId: string;
  }> {
    const made = await db.execute<{
      partner_id: string;
      partner_email: string;
      booking_id: string;
    }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1) AS city_id,
               (SELECT id FROM currencies WHERE code = 'USD')           AS currency_id,
               (SELECT id FROM property_types LIMIT 1)                  AS type_id,
               (SELECT id FROM partner_types LIMIT 1)                   AS partner_type_id,
               (SELECT id FROM cancellation_policies LIMIT 1)           AS policy_id
      ), cu AS (
        INSERT INTO users (email, phone, role, status, preferred_locale)
        VALUES ('rd-c-' || gen_random_uuid() || '@safra.test', '+963900000081', 'customer',
                'active', 'ar')
        RETURNING id
      ), pu AS (
        INSERT INTO users (email, phone, role, status, preferred_locale)
        VALUES ('rd-p-' || gen_random_uuid() || '@safra.test', '+963900000082', 'partner',
                'active', 'ar')
        RETURNING id, email
      ), cp AS (
        INSERT INTO customer_profiles (user_id, full_name, email, phone, is_guest)
        SELECT cu.id, 'إعادة', 'rd-c-' || gen_random_uuid() || '@safra.test',
               '+963900000081', false
        FROM cu RETURNING id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT pu.id, ref.partner_type_id, 'Redrive Test', 'إعادة', ref.city_id, 'x',
               '+963900000082', 'rd-p-' || gen_random_uuid() || '@safra.test', 'approved'
        FROM pu, ref RETURNING id
      ), pr AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, address, status)
        SELECT pa.id, ref.city_id, ref.type_id, ref.policy_id,
               'redrive-' || gen_random_uuid(), 'إعادة', 'Redrive', 'Redrive', 'x', 'published'
        FROM pa, ref RETURNING id, partner_id
      ), un AS (
        INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price,
                           currency_id)
        SELECT pr.id, 'وحدة', 'Unit', 'Einheit', 2, '100.00', ref.currency_id
        FROM pr, ref RETURNING id
      ), bk AS (
        INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                              check_in, check_out, guests_adults, status, paid_at,
                              confirmation_deadline_at,
                              base_amount, customer_fee_value, customer_fee_amount,
                              partner_commission_rate, partner_commission_amount,
                              total_amount, partner_payable_amount, currency_id,
                              fx_rate_to_syp, total_syp, cancellation_policy_snapshot)
        SELECT cp.id, un.id, pr.id, pr.partner_id, ref.city_id,
               current_date + 300, current_date + 302, 2,
               'pending_confirmation'::booking_status, now(), now() + INTERVAL '30 minutes',
               '200.00', '1.99', '1.99', '0.0700', '14.00', '201.99', '186.00',
               ref.currency_id, '13000.00000000', '2625870.00', '{"code":"flex"}'::jsonb
        FROM cp, un, pr, ref RETURNING id
      )
      SELECT pr.partner_id, pu.email AS partner_email, bk.id AS booking_id
      FROM pr, pu, bk
    `);

    const row = made.rows[0];

    if (!row) throw new Error('Seed produced no row.');

    return {
      partnerId: row.partner_id,
      partnerEmail: row.partner_email,
      bookingId: row.booking_id,
    };
  }
});
