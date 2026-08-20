import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';

import { createRollbackDatabase, type Database } from '@safra/db';

import { DeadLetterService } from './dead-letter.service.js';
import { ScheduledProcessor } from './scheduled.processor.js';
import { JobRunService } from '../common/jobs/job-run.service.js';
import {
  SCHEDULED_JOBS,
  scheduledJobId,
  type ScheduledJobData,
  type ScheduledJobName,
} from './scheduled.job.js';

/**
 * The `scheduled` queue: five recurring jobs, against a real Redis and a real BullMQ worker.
 *
 * ## What this has to prove, and what it deliberately does not
 *
 * It does NOT re-test what the five jobs do. `sla.integration.test.ts`, the payout suites and the
 * rest already cover that, and re-asserting it here would mean the compensation rules had two
 * homes. What phase 4 changed is the MECHANISM, so that is what is under test:
 *
 *   - a job dispatched by name reaches the right service and writes its `scheduled_job_runs` row,
 *   - an unknown name fails loudly instead of being silently dropped,
 *   - the repeatable schedule is declared once however many times it is declared,
 *   - and the obsolete-schedule cleanup actually removes one.
 *
 * That last pair is the half most easily left out and the most expensive to have left out: a BullMQ
 * schedule lives in Redis, so one created by a version of the code that no longer exists keeps
 * firing forever, and no deploy can stop it.
 *
 * ## `scheduled_job_runs` is the assertion, not a log line
 *
 * The design is explicit: **the queue records attempts; that table records business outcome, and
 * they are not the same thing.** The runbook queries it and `safra_job_last_success_age_seconds`
 * alerts on it, so a migration that stopped writing it would be invisible until somebody needed it.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const REDIS_URL = process.env['REDIS_URL'];
const describeIfReady = DATABASE_URL && REDIS_URL ? describe : describe.skip;

const SETTLE_MS = 10_000;

describeIfReady('the scheduled queue', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  /**
   * A processor over doubles.
   *
   * The six services are stubbed to record that they were CALLED, because dispatch is what this
   * file tests. `webhook-retention` is the exception: it runs for real through `JobRunService`, so
   * one test proves end to end that a queued occurrence writes the row the runbook reads — with a
   * genuine service, a genuine advisory lock and a genuine insert.
   */
  const called: string[] = [];
  const stub = (name: string) => ({
    // eslint-disable-next-line @typescript-eslint/require-await -- a double, deliberately trivial.
    async run(): Promise<void> {
      called.push(name);
    },
  });

  let connection: Redis;
  let queue: Queue;
  let worker: Worker;
  let prefix = '';

  beforeEach(async () => {
    await harness.begin();
    called.length = 0;

    prefix = `safra-test-${Math.random().toString(36).slice(2, 10)}`;
    connection = new Redis(REDIS_URL ?? '', { maxRetriesPerRequest: null });
    queue = new Queue('scheduled', { connection, prefix });

    const runs = new JobRunService(db);

    const processor = new ScheduledProcessor(
      { sweep: () => stub('booking-sla-sweep').run() } as never,
      { run: () => stub('payout-accrual').run() } as never,
      { nightlyRecompute: () => stub('ranking-recompute').run() } as never,
      { refresh: () => stub('sanctions-refresh').run() } as never,
      /*
        The real shape: a body that records through `JobRunService`, exactly as all five do. The
        pruning itself is stubbed out — this suite is not about retention — but the row is real.
      */
      {
        prune: () =>
          runs.runExclusively('webhook-retention', 918_273_645, () => {
            called.push('webhook-retention');

            return Promise.resolve({ deleted: 0 });
          }),
      } as never,
      /* The seventh job, recorded for real like the retention pass above it. */
      {
        prune: () =>
          runs.runExclusively('credential-retention', 8_421_005, () => {
            called.push('credential-retention');

            return Promise.resolve({ codes: 0, tokens: 0 });
          }),
      } as never,
      /* The one whose recording lives at the call site rather than in its service. */
      { run: () => stub('notification-redrive').run() } as never,
      runs,
      new DeadLetterService(db),
    );

    worker = new Worker<ScheduledJobData>('scheduled', (job) => processor.process(job), {
      connection,
      prefix,
      concurrency: 1,
    });

    worker.on('failed', (job, error) => void processor.onFailed(job, error));
    worker.on('error', () => undefined);

    await worker.waitUntilReady();
  }, 30_000);

  afterEach(async () => {
    await worker.close();
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close();
    await connection.quit();
    await harness.rollback();
  }, 30_000);

  afterAll(async () => {
    await harness.close();
  });

  const until = async (predicate: () => boolean | Promise<boolean>): Promise<boolean> => {
    const deadline = Date.now() + SETTLE_MS;

    while (Date.now() < deadline) {
      if (await predicate()) return true;

      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return false;
  };

  // ─── Dispatch ──────────────────────────────────────────────────────────────

  /** Every name in the table reaches its own service, and no other. */
  it('dispatches each job to its own service', { timeout: 30_000 }, async () => {
    for (const job of Object.keys(SCHEDULED_JOBS) as ScheduledJobName[]) {
      await queue.add(job, { job });
    }

    expect(
      await until(() => called.length === Object.keys(SCHEDULED_JOBS).length),
      `all of them ran (saw ${called.join(', ')})`,
    ).toBe(true);

    expect([...called].sort()).toEqual(Object.keys(SCHEDULED_JOBS).sort());
  });

  /**
   * A name nothing recognises must fail, not be ignored.
   *
   * This is the deploy-skew case, and also the obsolete-schedule case: a repeatable job left in
   * Redis by an older version keeps producing occurrences. Silently dropping them would mean a
   * schedule nobody can see is firing into a void; failing puts it in the dead letters where
   * somebody is paged and can remove it.
   */
  it('dead-letters an unknown job name', { timeout: 30_000 }, async () => {
    await queue.add(
      'a-job-that-was-deleted',
      { job: 'a-job-that-was-deleted' },
      {
        attempts: 1,
      },
    );

    expect(
      await until(async () => (await deadLetters()) > 0),
      'the unknown job was recorded',
    ).toBe(true);

    expect(called, 'and nothing ran').toEqual([]);
  });

  // ─── The row the runbook reads ─────────────────────────────────────────────

  /**
   * A queued occurrence writes `scheduled_job_runs` exactly as the cron path did.
   *
   * The one non-negotiable of this migration. `safra_job_last_success_age_seconds` reads this
   * table, so if the queue ran the work and stopped writing the row, every recurring job would
   * appear to have stopped — an alert storm describing a system that was working.
   */
  it('records the run in scheduled_job_runs', { timeout: 30_000 }, async () => {
    await queue.add('webhook-retention', { job: 'webhook-retention' });

    expect(await until(async () => (await runsRecorded()) > 0), 'a row was written').toBe(
      true,
    );

    const row = (
      await db.execute<{ status: string; job: string }>(sql`
        SELECT status::text AS status, job FROM scheduled_job_runs
        WHERE job = 'webhook-retention' ORDER BY started_at DESC LIMIT 1
      `)
    ).rows[0];

    expect(row?.status).toBe('completed');
  });

  // ─── The schedule itself ───────────────────────────────────────────────────

  /**
   * Declaring twice leaves one schedule.
   *
   * Which is what makes every API replica declaring all five at boot correct rather than a way to
   * accumulate an SLA sweep per replica per deploy.
   */
  it('is idempotent about declaring a schedule', { timeout: 30_000 }, async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await queue.upsertJobScheduler(
        scheduledJobId('ranking-recompute'),
        { pattern: SCHEDULED_JOBS['ranking-recompute'] },
        { name: 'ranking-recompute', data: { job: 'ranking-recompute' } },
      );
    }

    const schedulers = await queue.getJobSchedulers();

    expect(schedulers).toHaveLength(1);
    expect(schedulers[0]?.key).toBe('scheduled-ranking-recompute');
  });

  /** And one that should no longer exist can actually be removed. */
  it('removes a schedule that no longer belongs', { timeout: 30_000 }, async () => {
    await queue.upsertJobScheduler(
      'scheduled-a-job-that-was-deleted',
      { pattern: '0 5 * * *' },
      { name: 'a-job-that-was-deleted', data: { job: 'a-job-that-was-deleted' } },
    );

    expect(await queue.getJobSchedulers()).toHaveLength(1);

    await queue.removeJobScheduler('scheduled-a-job-that-was-deleted');

    expect(await queue.getJobSchedulers()).toHaveLength(0);
  });

  // ─── Fixtures ──────────────────────────────────────────────────────────────

  const deadLetters = async (): Promise<number> =>
    Number(
      (
        await db.execute<{ count: string }>(sql`
          SELECT count(*)::text AS count FROM dead_letter_jobs WHERE queue = 'scheduled'
        `)
      ).rows[0]?.count ?? 0,
    );

  const runsRecorded = async (): Promise<number> =>
    Number(
      (
        await db.execute<{ count: string }>(sql`
          SELECT count(*)::text AS count FROM scheduled_job_runs
          WHERE job = 'webhook-retention' AND status = 'completed'
        `)
      ).rows[0]?.count ?? 0,
    );
});
