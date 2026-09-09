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

  /*
    Unscoped, deliberately.

    `redriveOne` applies the city filter the delivery log is read through, and these tests are
    about the LIFECYCLE — failed, abandoned, delivered — not about geography. A scoped actor here
    would make every one of them depend on which city the fixture happened to land in, and a green
    result would mean «the scope let it through» rather than «the state machine works».
  */
  const anyCity = {
    sub: undefined,
    role: 'super_admin',
    permissions: [],
  } as unknown as Parameters<NotificationRedriveService['redriveOne']>[1];

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

      **`failed` joined the list on 2026-09-09.** The sweep used to look only at `queued`, which was
      the whole of finding 235: 1,055 rows sat in `failed` — 1,050 of them `booking.needs_action`,
      the oldest 32 days — and no recovery mechanism looked at that state at all. Now that it does,
      the same reasoning applies to those rows and the same neutralising has to cover them, or every
      count here measures the backlog instead of the fixture. It announced itself the same way:
      «expected 2, got 400».
    */
    await db.execute(
      sql`UPDATE notifications SET status = 'sent' WHERE status IN ('queued', 'failed')`,
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

  /**
   * A row that an attempt tried and could not deliver — the state finding 235 is about.
   *
   * `attempts` matters: a row below the ceiling is retryable and one at it is `abandoned`, and the
   * sweep must treat those oppositely. `failed_at` is set explicitly because the rows this finding
   * found predate the column being written at all, which is why the query coalesces three columns
   * to decide how old a failure is.
   */
  const failAt = async (
    templateKey: string,
    subject: { bookingId?: string; partnerId?: string },
    options: { ageMinutes: number; attempts: number; status?: 'failed' | 'abandoned' },
  ): Promise<string> => {
    const inserted = await db.execute<{ id: string }>(sql`
      INSERT INTO notifications (channel, template_key, locale, status, attempts,
                                 queued_at, failed_at, booking_id, partner_id)
      VALUES ('email', ${templateKey}, 'ar', ${options.status ?? 'failed'}::notification_status,
              ${options.attempts}::int,
              now() - (${options.ageMinutes}::int * INTERVAL '1 minute'),
              now() - (${options.ageMinutes}::int * INTERVAL '1 minute'),
              ${subject.bookingId ?? null}::uuid,
              ${subject.partnerId ?? null}::uuid)
      RETURNING id
    `);

    const id = inserted.rows[0]?.id;

    if (!id) throw new Error('Notification fixture produced no row.');

    return id;
  };

  const statusOf = async (id: string): Promise<string> => {
    const found = await db.execute<{ status: string }>(
      sql`SELECT status::text AS status FROM notifications WHERE id = ${id}::uuid`,
    );

    return found.rows[0]?.status ?? '(gone)';
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

  // ─── The lifecycle finding 235 asked for ───────────────────────────────────

  /**
   * The state nothing looked at: an attempt failed, the job vanished, and the retry never fired.
   *
   * This is the exact shape of the 1,055 rows found on 2026-09-09 — `attempts = 1`, nothing in
   * Redis, and older than any schedule could still be running. Before the split it was
   * indistinguishable from a row whose retry was in flight, so no mechanism could act on either.
   */
  it('re-drives a failed notice once its retry schedule cannot still be running', async () => {
    const id = await failAt(
      'booking.needs_action',
      { bookingId, partnerId },
      {
        ageMinutes: 120,
        attempts: 1,
      },
    );

    const result = await redrive.run();

    expect(result['redriven']).toBe(1);
    expect(queue.jobs).toHaveLength(1);
    expect(queue.jobs[0]?.mail.to).toBe(partnerEmail);

    /*
      Back to `queued`, or the next tick finds it again and every count the job reports stops
      describing anything. The state has to say where the notice IS.
    */
    expect(await statusOf(id)).toBe('queued');
  });

  /**
   * And NOT while BullMQ may still be holding it.
   *
   * A recovery that argues with the retry mechanism about the same row is not a recovery. The
   * window is derived from the queue's own policy — attempts × the backoff cap — so the two cannot
   * drift apart.
   */
  it('leaves a failed notice alone while its retries are still owed', async () => {
    const id = await failAt(
      'booking.needs_action',
      { bookingId, partnerId },
      {
        ageMinutes: 5,
        attempts: 1,
      },
    );

    const result = await redrive.run();

    expect(result['redriven']).toBe(0);
    expect(queue.jobs).toHaveLength(0);
    expect(await statusOf(id)).toBe('failed');
  });

  /**
   * `abandoned` is terminal, and the sweep must never resurrect it.
   *
   * Its attempts are spent. A timer that re-drove it anyway would be an infinite loop against a
   * mail server that has already refused five times — which is why the split exists at all rather
   * than simply widening the old query to «not sent».
   */
  it('never re-drives an abandoned notice on the timer, however old', async () => {
    const id = await failAt(
      'booking.needs_action',
      { bookingId, partnerId },
      {
        ageMinutes: 60 * 24 * 30,
        attempts: 5,
        status: 'abandoned',
      },
    );

    const result = await redrive.run();

    expect(result['redriven']).toBe(0);
    expect(queue.jobs).toHaveLength(0);
    expect(await statusOf(id)).toBe('abandoned');
  });

  /** But a PERSON can, which is the whole reason the terminal state is safe to have. */
  it('re-drives an abandoned notice when somebody asks for it by id', async () => {
    const id = await failAt(
      'booking.needs_action',
      { bookingId, partnerId },
      {
        ageMinutes: 60 * 24 * 30,
        attempts: 5,
        status: 'abandoned',
      },
    );

    const outcome = await redrive.redriveOne(id, anyCity);

    expect(outcome).toBe('queued');
    expect(queue.jobs).toHaveLength(1);
    expect(queue.jobs[0]?.mail.to).toBe(partnerEmail);
    expect(await statusOf(id)).toBe('queued');
  });

  /**
   * The one way a manual re-drive could do harm: a second copy of something already received.
   *
   * Excluded by a `WHERE` clause rather than checked afterwards, so «already delivered» answers
   * exactly like «no such row» — the same shape as every other authorization boundary here.
   */
  it('refuses to re-drive a notice that was already delivered', async () => {
    const id = await failAt(
      'booking.needs_action',
      { bookingId, partnerId },
      {
        ageMinutes: 120,
        attempts: 1,
      },
    );

    await db.execute(
      sql`UPDATE notifications SET status = 'delivered' WHERE id = ${id}::uuid`,
    );

    expect(await redrive.redriveOne(id, anyCity)).toBeNull();
    expect(queue.jobs).toHaveLength(0);
    expect(await statusOf(id)).toBe('delivered');
  });

  /**
   * Attempts are never reset by a re-drive, so a notice cannot earn unlimited tries.
   *
   * A row re-driven after four failures gets ONE more and then abandons. Without this a permanently
   * bad address would loop between `failed` and `queued` for ever, sending nothing and alerting
   * nobody — a recovery mechanism that never converges is its own outage.
   */
  it('does not reset the attempt count when it re-drives', async () => {
    const id = await failAt(
      'booking.needs_action',
      { bookingId, partnerId },
      {
        ageMinutes: 120,
        attempts: 4,
      },
    );

    await redrive.run();

    const after = await db.execute<{ attempts: number }>(
      sql`SELECT attempts FROM notifications WHERE id = ${id}::uuid`,
    );

    expect(after.rows[0]?.attempts).toBe(4);
  });

  /**
   * Where `failed` becomes `abandoned`, which is the boundary the whole state model rests on.
   *
   * Driven through `deliver()` against a mail service that always refuses, because the boundary is
   * a comparison against the QUEUE's declared attempt limit and a test that asserted the number
   * directly would pass while the two drifted apart. Five is `JOB_OPTIONS.mail.attempts`; the
   * fourth failure leaves a row retryable and the fifth retires it.
   */
  it('marks a notice failed while attempts remain and abandoned at the ceiling', async () => {
    const refusing = {
      send: () => Promise.reject(new Error('SMTP said no')),
    } as unknown as MailService;

    const service = new NotificationService(db, refusing, queue.queue);

    const id = await failAt(
      'booking.needs_action',
      { bookingId, partnerId },
      {
        ageMinutes: 1,
        attempts: 0,
      },
    );

    const attempt = async (): Promise<void> => {
      await service
        .deliver(id, 'booking.needs_action', {
          to: partnerEmail,
          subject: 's',
          text: 't',
          html: '<p>t</p>',
        })
        /* `deliver` rethrows so BullMQ retries; here the throw is the expected outcome. */
        .catch(() => undefined);
    };

    for (const expected of ['failed', 'failed', 'failed', 'failed']) {
      await attempt();
      expect(await statusOf(id)).toBe(expected);
    }

    await attempt();

    expect(await statusOf(id)).toBe('abandoned');
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
