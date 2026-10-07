import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';

import { createRollbackDatabase, type Database } from '@safra/db';

import { NotificationService } from '../notifications/notification.service.js';
import { NotificationRedriveService } from '../notifications/notification-redrive.service.js';
import type { Env } from '../config/env.js';
import type { MailService } from '../mail/mail.service.js';
import { DeadLetterService } from './dead-letter.service.js';
import { MailProcessor } from './mail.processor.js';
import { MAIL_JOB, mailJobId } from './mail.job.js';
import { JOB_OPTIONS, jitteredBackoff } from './queue.definitions.js';

/**
 * The `mail` queue, against a real Redis and a real BullMQ worker.
 *
 * ## Why this is not tested with a double
 *
 * `queue.testing.ts` has a double, and it is the right tool for the suites that assert a DECISION to
 * notify. It cannot answer the question this file exists for: does the job actually cross the
 * process boundary, and does the `notifications` row end up in a terminal state on the other side.
 * That involves BullMQ's serialisation, its job-id semantics, its retry accounting and its `failed`
 * event, none of which a double reproduces and all of which phase 2 depends on.
 *
 * ## Its own queue prefix, obliterated afterwards
 *
 * `safra-test-<random>` rather than `safra`, so a test run cannot consume a job the development API
 * enqueued, and a worker left running by `pnpm worker` cannot consume a test's. The queue is
 * obliterated in `afterEach` — a leaked BullMQ key set outlives the process and would make the next
 * run's assertions depend on the previous one's.
 *
 * ## The database rolls back, the Redis does not
 *
 * Which is why the worker is given the SAME harness connection as the producer: the notification row
 * lives inside the test's open transaction, so a worker on a separate pool could not see it and every
 * assertion would fail for a reason that has nothing to do with the queue.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const REDIS_URL = process.env['REDIS_URL'];
const describeIfReady = DATABASE_URL && REDIS_URL ? describe : describe.skip;

/** Long enough for a local round trip, short enough that a hang fails rather than hangs. */
const SETTLE_MS = 8_000;

describeIfReady('the mail queue', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  const sent: { to: string; subject: string }[] = [];
  let failEverySend = false;

  const mail = {
    send: (message: { to: string; subject: string }) => {
      if (failEverySend)
        return Promise.reject(new Error('SMTP is down for x@example.test'));

      sent.push(message);

      return Promise.resolve();
    },
  } as unknown as MailService;

  let connection: Redis;
  let queue: Queue;
  let worker: Worker;
  let prefix = '';
  let notifications: NotificationService;
  let redrive: NotificationRedriveService;

  /* Unscoped: these tests are about the queue, not about geography. */
  const anyCity = {
    role: 'super_admin',
    permissions: [],
  } as unknown as Parameters<NotificationRedriveService['redriveOne']>[1];

  beforeEach(async () => {
    await harness.begin();
    sent.length = 0;
    failEverySend = false;

    prefix = `safra-test-${Math.random().toString(36).slice(2, 10)}`;
    connection = new Redis(REDIS_URL ?? '', { maxRetriesPerRequest: null });
    queue = new Queue('mail', { connection, prefix });

    notifications = new NotificationService(db, mail, queue);
    redrive = new NotificationRedriveService(
      db,
      { APP_URL: 'https://safra.test', PARTNER_URL: 'https://partner.safra.test' } as Env,
      notifications,
    );

    const processor = new MailProcessor(notifications, new DeadLetterService(db));

    worker = new Worker('mail', (job) => processor.process(job), {
      connection,
      prefix,
      concurrency: 2,
    });

    worker.on('failed', (job, error) => void processor.onFailed(job, error));
    /* Without an error listener an ioredis blip inside BullMQ takes the test process down. */
    worker.on('error', () => undefined);

    await worker.waitUntilReady();
  }, 20_000);

  afterEach(async () => {
    await worker.close();
    /* Removes every key this test made, including the failed set that `removeOnFail: false` keeps. */
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close();
    await connection.quit();
    await harness.rollback();
  }, 20_000);

  afterAll(async () => {
    await harness.close();
  });

  /** Waits for a condition rather than for a duration, so a fast machine is not penalised. */
  const until = async (predicate: () => Promise<boolean>): Promise<boolean> => {
    const deadline = Date.now() + SETTLE_MS;

    while (Date.now() < deadline) {
      if (await predicate()) return true;

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return false;
  };

  const statusOf = async (templateKey: string): Promise<string | undefined> =>
    (
      await db.execute<{ status: string }>(sql`
        SELECT status::text AS status FROM notifications
        WHERE template_key = ${templateKey} ORDER BY queued_at DESC LIMIT 1
      `)
    ).rows[0]?.status;

  // ─── The seam ──────────────────────────────────────────────────────────────

  /**
   * The whole of phase 2, in one assertion.
   *
   * `notify` returns without sending anything — that is the point of the change, and it is what takes
   * an unreachable SMTP server off a booking's critical path. The row exists as `queued` in the
   * meantime, which is what makes a lost Redis recoverable.
   */
  it('returns from notify with the row queued and nothing sent', async () => {
    await notifications.notify('queue.test.pending', mailNamed('pending'), 'ar');

    expect(sent).toHaveLength(0);
    expect(await statusOf('queue.test.pending')).toBe('queued');
  });

  it(
    'sends it on the worker side and marks the row sent',
    { timeout: 20_000 },
    async () => {
      await notifications.notify('queue.test.delivered', mailNamed('delivered'), 'ar');

      const settled = await until(
        async () => (await statusOf('queue.test.delivered')) === 'sent',
      );

      expect(settled, 'the worker did not complete the job in time').toBe(true);
      expect(sent).toHaveLength(1);
      expect(sent[0]?.subject).toContain('delivered');
    },
  );

  /**
   * The deterministic job id, which is what makes at-least-once delivery safe at the QUEUE level.
   *
   * A retried request that re-enqueues the same notification row must not produce a second email.
   * BullMQ refuses a duplicate id while the job exists, so the second `add` is a no-op.
   */
  it(
    'refuses to enqueue the same notification row twice',
    { timeout: 20_000 },
    async () => {
      const row = await db.execute<{ id: string }>(sql`
      INSERT INTO notifications (channel, template_key, locale, status)
      VALUES ('email', 'queue.test.duplicate', 'ar', 'queued')
      RETURNING id
    `);

      const id = row.rows[0]?.id ?? '';
      const data = {
        notificationId: id,
        templateKey: 'queue.test.duplicate',
        mail: mailNamed('dup'),
      };

      const first = await queue.add(MAIL_JOB, data, {
        ...JOB_OPTIONS.mail,
        jobId: mailJobId(id),
      });
      const second = await queue.add(MAIL_JOB, data, {
        ...JOB_OPTIONS.mail,
        jobId: mailJobId(id),
      });

      expect(second.id).toBe(first.id);

      const settled = await until(() => Promise.resolve(sent.length > 0));

      expect(settled).toBe(true);
      /* One email, from two enqueues of the same row. */
      expect(sent).toHaveLength(1);
    },
  );

  // ─── When the send keeps failing ───────────────────────────────────────────

  /**
   * A job that exhausts its attempts must leave a row somewhere that survives Redis.
   *
   * One attempt rather than the configured five, because the point is the LAST-attempt path and five
   * jittered exponential backoffs take minutes. The retry accounting itself is asserted separately by
   * `jitteredBackoff`'s unit tests.
   */
  it('records a dead letter once the attempts run out', { timeout: 20_000 }, async () => {
    failEverySend = true;

    const row = await db.execute<{ id: string }>(sql`
      INSERT INTO notifications (channel, template_key, locale, status)
      VALUES ('email', 'queue.test.dead', 'ar', 'queued')
      RETURNING id
    `);

    const id = row.rows[0]?.id ?? '';

    await queue.add(
      MAIL_JOB,
      { notificationId: id, templateKey: 'queue.test.dead', mail: mailNamed('dead') },
      { attempts: 1, jobId: mailJobId(id) },
    );

    const recorded = await until(async () => (await deadLetters()) > 0);

    expect(recorded, 'no dead letter was recorded').toBe(true);

    const letter = await db.execute<{
      queue: string;
      name: string;
      error: string;
      payload: unknown;
    }>(sql`
      SELECT queue, name, error, payload FROM dead_letter_jobs
      ORDER BY failed_at DESC LIMIT 1
    `);

    expect(letter.rows[0]?.queue).toBe('mail');
    expect(letter.rows[0]?.name).toBe(MAIL_JOB);

    /* The provider quoted an address; neither the error nor the payload may carry one. */
    expect(letter.rows[0]?.error).not.toContain('@');
    expect(JSON.stringify(letter.rows[0]?.payload)).not.toContain('@');

    /* And the row itself is failed, so the delivery log agrees with the dead letter. */
    expect(await statusOf('queue.test.dead')).toBe('failed');
  });

  // ─── Re-driving a notice whose job is still in Redis ───────────────────────

  /**
   * A re-drive of an exhausted notice SENDS it — once, and as it was composed.
   *
   * The defect, which no double could show: `removeOnFail: false` keeps the failed job, so the
   * re-drive's `add` under the same id was silently ignored. `redriveOne` answered «queued», the row
   * went back to `queued`, and nothing was ever sent; the sweep then found that row every five
   * minutes and did the same nothing.
   *
   * Pressed twice at once, because «exactly once» is the claim: BullMQ's retry moves the job only
   * from the state named, so the second press finds it already waiting. And the mail that arrives is
   * the ORIGINAL — its own link — not a rebuilt summary.
   */
  it(
    're-sends an exhausted notice when re-driven, once, as it was composed',
    { timeout: 30_000 },
    async () => {
      const id = await exhausted('review.received', {
        to: 'host@safra.test',
        subject: 'Queue test original',
        text: 'Open https://partner.safra.test/reviews?from=original',
      });

      failEverySend = false;

      const outcomes = await Promise.all([
        redrive.redriveOne(id, anyCity),
        redrive.redriveOne(id, anyCity),
      ]);

      expect(outcomes).toEqual(['queued', 'queued']);

      expect(
        await until(async () => (await statusOfId(id)) === 'sent'),
        'the re-driven notice was delivered',
      ).toBe(true);

      /* Settled for longer than a second run would take, so a duplicate would have arrived. */
      await new Promise((resolve) => setTimeout(resolve, 750));

      expect(sent.map((message) => message.subject)).toEqual(['Queue test original']);
    },
  );

  /** The timer takes the same path as the button, for a `failed` row its retries gave up on. */
  it(
    'sends a failed notice the sweep re-drives, when its job is still in Redis',
    { timeout: 30_000 },
    async () => {
      /*
        The sweep is global, so the development database's own undelivered rows would be counted
        too. Settled inside this test's transaction, which rolls back.
      */
      await db.execute(
        sql`UPDATE notifications SET status = 'sent' WHERE status IN ('queued', 'failed')`,
      );

      const id = await exhausted('review.received', {
        to: 'host@safra.test',
        subject: 'Queue test swept',
        text: 'Open https://partner.safra.test/reviews',
      });

      failEverySend = false;

      /* Old enough that its retry schedule cannot still be running. */
      await db.execute(sql`
        UPDATE notifications
        SET status = 'failed', failed_at = now() - INTERVAL '2 hours'
        WHERE id = ${id}::uuid
      `);

      expect((await redrive.run())['redriven']).toBe(1);

      expect(
        await until(async () => (await statusOfId(id)) === 'sent'),
        'the swept notice was delivered',
      ).toBe(true);
      expect(sent.map((message) => message.subject)).toEqual(['Queue test swept']);
    },
  );

  /** A job that COMPLETED was accepted by the provider. A re-drive must not send it again. */
  it('does not re-send a notice whose job completed', { timeout: 30_000 }, async () => {
    const row = await db.execute<{ id: string }>(sql`
      INSERT INTO notifications (channel, template_key, locale, status)
      VALUES ('email', 'review.received', 'ar', 'queued')
      RETURNING id
    `);
    const id = row.rows[0]?.id ?? '';

    await queue.add(
      MAIL_JOB,
      { notificationId: id, templateKey: 'review.received', mail: mailNamed('once') },
      { jobId: mailJobId(id) },
    );

    expect(await until(async () => (await statusOfId(id)) === 'sent')).toBe(true);

    /* As if the row had been left behind by a crash between the send and its update. */
    await db.execute(
      sql`UPDATE notifications SET status = 'failed' WHERE id = ${id}::uuid`,
    );

    expect(await redrive.redriveOne(id, anyCity)).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(sent).toHaveLength(1);
  });

  /** A row and a job that ran out of attempts against a refusing provider: what a re-drive meets. */
  async function exhausted(
    templateKey: string,
    original: { to: string; subject: string; text: string },
  ): Promise<string> {
    failEverySend = true;

    /*
      A real partner behind the row, so a REBUILT notice would be sendable too. Without one the
      re-drive could only answer «unreconstructable», and a test that passed would not show which of
      the two messages went out — the original, or a summary composed over the top of it.
    */
    const row = await db.execute<{ id: string }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL ORDER BY id LIMIT 1) AS city_id,
               (SELECT id FROM partner_types ORDER BY id LIMIT 1)                AS type_id
      ), pu AS (
        INSERT INTO users (email, phone, role, status, preferred_locale)
        VALUES ('mq-p-' || gen_random_uuid() || '@safra.test', '+963900000083', 'partner',
                'active', 'ar')
        RETURNING id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT pu.id, ref.type_id, 'Queue Test', 'اختبار', ref.city_id, 'x',
               '+963900000083', 'mq-p-' || gen_random_uuid() || '@safra.test', 'approved'
        FROM pu, ref RETURNING id
      )
      INSERT INTO notifications (channel, template_key, locale, status, partner_id)
      SELECT 'email', ${templateKey}, 'ar', 'queued', pa.id FROM pa
      RETURNING id
    `);
    const id = row.rows[0]?.id ?? '';

    await queue.add(
      MAIL_JOB,
      { notificationId: id, templateKey, mail: original },
      { attempts: 1, jobId: mailJobId(id) },
    );

    expect(
      await until(
        async () => (await (await queue.getJob(mailJobId(id)))?.getState()) === 'failed',
      ),
      'the job ran out of attempts',
    ).toBe(true);

    /* The ceiling the console's re-drive exists for: attempts spent, nothing automatic left. */
    await db.execute(sql`
      UPDATE notifications SET status = 'abandoned', attempts = 5 WHERE id = ${id}::uuid
    `);

    return id;
  }

  const statusOfId = async (id: string): Promise<string | undefined> =>
    (
      await db.execute<{ status: string }>(sql`
        SELECT status::text AS status FROM notifications WHERE id = ${id}::uuid
      `)
    ).rows[0]?.status;

  const deadLetters = async (): Promise<number> =>
    Number(
      (
        await db.execute<{ n: string }>(sql`
          SELECT count(*)::text AS n FROM dead_letter_jobs WHERE queue = 'mail'
        `)
      ).rows[0]?.n ?? 0,
    );

  function mailNamed(name: string) {
    return { to: `${name}@safra.test`, subject: `Queue test ${name}`, text: 'Body.' };
  }
});

/**
 * The backoff, as arithmetic rather than as a round trip.
 *
 * Runs without Redis: it is a pure function, and the properties worth pinning are the ones a
 * thundering herd depends on. Injecting `random` makes the draw deterministic without weakening what
 * is asserted — the bound, the growth and the cap are the contract; the specific draw is not.
 */
describe('jitteredBackoff', () => {
  it('never returns less than a second, even on a zero draw', () => {
    expect(jitteredBackoff(1, 30_000, 'mail', () => 0)).toBe(1_000);
  });

  it('grows exponentially with the attempt', () => {
    const second = jitteredBackoff(2, 30_000, 'mail', () => 1);
    const third = jitteredBackoff(3, 30_000, 'mail', () => 1);

    expect(second).toBe(60_000);
    expect(third).toBe(120_000);
  });

  it('caps at the queue ceiling — eight minutes for mail', () => {
    expect(jitteredBackoff(20, 30_000, 'mail', () => 1)).toBe(8 * 60_000);
  });

  /** Webhooks retry for hours on purpose: receivers go down for hours. */
  it('lets webhooks back off for four hours', () => {
    expect(jitteredBackoff(20, 60_000, 'webhooks', () => 1)).toBe(4 * 60 * 60_000);
  });

  /**
   * The jitter is the point, so this asserts it is actually applied rather than assumed: a full-jitter
   * draw spreads over the whole window, which is what stops every retry in the estate landing at once.
   */
  it('spreads the delay across the window rather than returning a fixed value', () => {
    const low = jitteredBackoff(4, 30_000, 'mail', () => 0.01);
    const high = jitteredBackoff(4, 30_000, 'mail', () => 1);

    expect(low).toBeLessThan(high / 10);
  });
});
