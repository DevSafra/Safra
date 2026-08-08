import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, type Database } from '@safra/db';

import { JobRunService } from './job-run.service.js';

/**
 * The scheduled-job harness against a REAL PostgreSQL.
 *
 * ## Why a real database is the only way to test this
 *
 * The whole mechanism IS a PostgreSQL advisory lock. A mock would assert that
 * `pg_try_advisory_lock` was called, which is exactly the thing that stays true while the
 * single-instance guarantee stops holding — and that guarantee is what stops four replicas
 * accruing the same bookings four times.
 *
 * Two separate connections are used deliberately: advisory locks are SESSION-scoped, so a second
 * lock attempt on the same connection succeeds (it is re-entrant) and would prove nothing about
 * two replicas.
 *
 * Skipped when DATABASE_URL is unset; CI provisions a database and runs it.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** Outside the range any real job uses, so a stray lock cannot collide with production keys. */
const TEST_LOCK = 991_100_7;

describeIfDb('JobRunService', () => {
  /*
    TWO real connections, and the documented exception to the rollback harness.
    This suite is ABOUT two sessions contending for a PostgreSQL advisory lock — the second must be
    refused while the first holds it. A single pooled connection cannot express that, and a
    transaction cannot either: a session-scoped advisory lock is held by the SESSION. So these tests
    commit, and clean up after themselves by deleting their own `test-job-%` rows.
  */
  const one: Database = createDatabase(DATABASE_URL ?? '', 1);
  const two: Database = createDatabase(DATABASE_URL ?? '', 1);

  const runnerOne = new JobRunService(one);
  const runnerTwo = new JobRunService(two);

  const job = `test-job-${Math.floor(Date.now() / 1000)}`;

  beforeEach(async () => {
    await one.execute(sql`DELETE FROM scheduled_job_runs WHERE job LIKE 'test-job-%'`);
  });

  afterAll(async () => {
    /* These tests commit, so they remove their own rows — see the note on the two connections. */
    await one.execute(sql`DELETE FROM scheduled_job_runs WHERE job LIKE 'test-job-%'`);
    await one.$client.end();
    await two.$client.end();
  });

  async function rows() {
    const result = await one.execute<{
      status: string;
      detail: unknown;
      error: string | null;
    }>(sql`
      SELECT status::text, detail, error FROM scheduled_job_runs
      WHERE job = ${job} ORDER BY started_at
    `);

    return result.rows;
  }

  it('runs the work and records what it reported', async () => {
    await runnerOne.runExclusively(job, TEST_LOCK, () =>
      Promise.resolve({ attached: 7, payouts: 2 }),
    );

    const recorded = await rows();

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.status).toBe('completed');
    expect(recorded[0]?.detail).toMatchObject({ attached: 7, payouts: 2 });
  });

  /**
   * THE guarantee: one replica does the work, the others skip.
   *
   * Held open on connection one while connection two tries — which is what two replicas firing the
   * same cron within milliseconds of each other actually looks like.
   */
  it('lets exactly one connection in while another holds the lock', async () => {
    let secondRan = false;

    await runnerOne.runExclusively(job, TEST_LOCK, async () => {
      await runnerTwo.runExclusively(job, TEST_LOCK, () => {
        secondRan = true;
        return Promise.resolve({});
      });

      return { first: true };
    });

    expect(secondRan).toBe(false);
  });

  /*
    A skip is recorded rather than silent. On a four-replica deployment three of every four ticks
    skip, and a table showing only completions would make an operator believe the job runs a
    quarter as often as it does.
  */
  it('records a skip as its own outcome, not as a failure', async () => {
    await runnerOne.runExclusively(job, TEST_LOCK, async () => {
      await runnerTwo.runExclusively(job, TEST_LOCK, () => Promise.resolve({}));

      return {};
    });

    const statuses = (await rows()).map((row) => row.status);

    expect(statuses).toContain('skipped');
    expect(statuses).toContain('completed');
  });

  it('releases the lock afterwards, so the next tick is not starved', async () => {
    await runnerOne.runExclusively(job, TEST_LOCK, () => Promise.resolve({}));

    let secondRan = false;

    await runnerTwo.runExclusively(job, TEST_LOCK, () => {
      secondRan = true;
      return Promise.resolve({});
    });

    expect(secondRan).toBe(true);
  });

  describe('when the work throws', () => {
    const boom = () => Promise.reject(new Error('the database went away'));

    it('records the failure with its message', async () => {
      await expect(runnerOne.runExclusively(job, TEST_LOCK, boom)).rejects.toThrow(
        /went away/,
      );

      const recorded = await rows();

      expect(recorded[0]?.status).toBe('failed');
      expect(recorded[0]?.error).toContain('went away');
    });

    /*
      A job that throws must not hold the lock until the pod restarts — the whole fleet would stop
      accruing and the only symptom would be silence.
    */
    it('still releases the lock', async () => {
      await runnerOne.runExclusively(job, TEST_LOCK, boom).catch(() => undefined);

      let secondRan = false;

      await runnerTwo.runExclusively(job, TEST_LOCK, () => {
        secondRan = true;
        return Promise.resolve({});
      });

      expect(secondRan).toBe(true);
    });

    /* Re-thrown, so process-level handling — the logger today, Sentry later — is not bypassed. */
    it('re-throws rather than swallowing', async () => {
      await expect(runnerOne.runExclusively(job, TEST_LOCK, boom)).rejects.toThrow();
    });
  });

  describe('what an operator reads', () => {
    it('reports the newest non-skipped run per job', async () => {
      await runnerOne.runExclusively(job, TEST_LOCK, () => Promise.resolve({ pass: 1 }));
      await runnerOne.runExclusively(job, TEST_LOCK, () => Promise.resolve({ pass: 2 }));

      const latest = (await runnerOne.latest()).find((row) => row.job === job);

      expect(latest?.detail).toMatchObject({ pass: 2 });
    });

    /*
      Skips are excluded from "latest". On a scaled fleet they are the majority, and a health check
      reading "last run: skipped" would be reading the replicas that did nothing rather than the
      one that did the work.
    */
    it('does not report a skip as the latest run', async () => {
      await runnerOne.runExclusively(job, TEST_LOCK, () =>
        Promise.resolve({ real: true }),
      );

      await runnerOne.runExclusively(job, TEST_LOCK, async () => {
        await runnerTwo.runExclusively(job, TEST_LOCK, () => Promise.resolve({}));
        return { real: true, second: true };
      });

      const latest = (await runnerOne.latest()).find((row) => row.job === job);

      expect(latest?.status).toBe('completed');
    });
  });
});
