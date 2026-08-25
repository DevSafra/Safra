import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { schema } from '@safra/db';

import { DATABASE } from '../../database/database.module.js';
import { describeError, framesOnly } from '../errors/safe-error.js';

/**
 * Runs a scheduled job exactly once across the fleet, and records what happened.
 *
 * ## Two problems, one place
 *
 * **Only one replica should run it.** The API is deliberately stateless and horizontally scaled
 * (rule 2), and a `@Cron` decorator fires on EVERY replica — four nodes would run the same accrual
 * four times concurrently. A PostgreSQL advisory lock makes that one node. `pg_try_advisory_lock`
 * returns immediately rather than queueing, so a replica that does not win simply skips the tick,
 * which is correct for an idempotent job.
 *
 * **Somebody has to be able to tell it is still running.** A job that logs and nothing else is
 * invisible in the way that matters: the failure nobody notices is not "it threw" — that lands in
 * the log — it is "it stopped firing". A row per run makes the ABSENCE of runs queryable, which is
 * the thing worth alerting on.
 *
 * ## Failure is recorded and then re-thrown
 *
 * The row is written before the error propagates, so a job that fails on every tick leaves a trail
 * rather than a silence. Re-throwing keeps whatever process-level handling exists — today the
 * logger, tomorrow Sentry (S-1) — from being bypassed by this class.
 *
 * ## The lock is released in `finally`
 *
 * Session-scoped, so it would also be released if the connection died. The `finally` is for the
 * ordinary case: a job that throws must not hold the lock until the pod restarts, or the fleet
 * stops accruing entirely and the only symptom is silence.
 */
@Injectable()
export class JobRunService {
  private readonly logger = new Logger(JobRunService.name);

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * @param job   Stable name, matching the `@Cron` name — this is what the table is queried by.
   * @param key   The advisory lock key. Any 64-bit int, unique among this app's locks.
   * @param work  Returns whatever should be recorded as `detail` — counts, usually.
   */
  async runExclusively(
    job: string,
    key: number,
    work: () => Promise<Record<string, unknown>>,
  ): Promise<void> {
    const acquired = await this.db.execute<{ locked: boolean }>(
      sql`SELECT pg_try_advisory_lock(${key}) AS locked`,
    );

    if (acquired.rows[0]?.locked !== true) {
      /*
        Recorded, not silent. On a four-replica deployment three of every four ticks skip, and a
        table showing only completions would make an operator think the job runs a quarter as
        often as it does.
      */
      await this.record(job, 'skipped', null, null, 0);
      this.logger.debug(`${job}: skipped, another instance holds the lock.`);
      return;
    }

    const startedAt = Date.now();

    try {
      const detail = await work();
      const durationMs = Date.now() - startedAt;

      await this.record(job, 'completed', detail, null, durationMs);
      this.logger.log(`${job}: completed in ${durationMs}ms — ${JSON.stringify(detail)}`);
    } catch (error) {
      const durationMs = Date.now() - startedAt;

      /*
        `describeError`, not `error.message` (`O-sec-7`, fixed 2026-08-25).

        This was the worst instance of that finding, and the reason is the line below it: the message
        is written into `scheduled_job_runs.error`, a COLUMN — read by `GET /admin/jobs`, shown in the
        console, and queried by the runbook. So a failing scheduled query put its BOUND PARAMETERS at
        rest and on somebody's screen, not merely into a log stream that rotates.

        `drizzle-orm` builds `DrizzleQueryError`'s message as `Failed query: <sql>\nparams: <values>`
        — the values. On the accrual and the SLA sweep those values are booking references and money;
        on any path that touches `users` they would be an Argon2id hash and an encrypted TOTP secret.
        `JsonLogger`'s redaction cannot see it, because that works on object KEYS and this is one flat
        string.

        `describeError` is the same shape `AppExceptionFilter` has answered with since 2026-08-20 and
        is now shared — name, SQLSTATE, the SQL, and a COUNT of the parameters withheld. Bashar chose
        that over inventing a structured column (2026-08-25): the operator reading this row and the
        one reading the log should not have to learn two formats.
      */
      const described = describeError(error);

      await this.record(job, 'failed', null, described, durationMs).catch(
        () => undefined,
      );

      /*
        FRAMES only. A stack begins with `name: message`, so logging it whole would put back exactly
        the parameters `describeError` just took out — and the second argument to `logger.error` IS
        the stack.
      */
      this.logger.error(
        `${job}: FAILED after ${durationMs}ms — ${described}`,
        error instanceof Error ? framesOnly(error) : undefined,
      );

      throw error;
    } finally {
      await this.db
        .execute(sql`SELECT pg_advisory_unlock(${key})`)
        .catch(() => undefined);
    }
  }

  /** The most recent run of each job — what a health check and the console read. */
  async latest(): Promise<
    {
      job: string;
      status: string;
      startedAt: string;
      finishedAt: string | null;
      durationMs: string | null;
      detail: unknown;
      error: string | null;
    }[]
  > {
    /*
      `DISTINCT ON` over (job, started_at DESC) — one row per job, its newest. A GROUP BY with a
      max would give the timestamp and then need a second query to get the row it belongs to.

      Skipped runs are EXCLUDED from "latest": on a scaled fleet they are the majority, and a
      health check reading "last run: skipped" would be reading the replicas that did nothing
      rather than the one that did the work.
    */
    const rows = await this.db.execute<{
      job: string;
      status: string;
      started_at: string;
      finished_at: string | null;
      duration_ms: string | null;
      detail: unknown;
      error: string | null;
    }>(sql`
      SELECT DISTINCT ON (job)
             job, status::text AS status, started_at::text, finished_at::text,
             duration_ms, detail, error
      FROM scheduled_job_runs
      WHERE status <> 'skipped'
      ORDER BY job, started_at DESC
    `);

    return rows.rows.map((row) => ({
      job: row.job,
      status: row.status,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      durationMs: row.duration_ms,
      detail: row.detail,
      error: row.error,
    }));
  }

  private async record(
    job: string,
    status: 'completed' | 'skipped' | 'failed',
    detail: Record<string, unknown> | null,
    error: string | null,
    durationMs: number,
  ): Promise<void> {
    await this.db.insert(schema.scheduledJobRuns).values({
      job,
      status,
      finishedAt: new Date(),
      durationMs: String(durationMs),
      detail,
      error,
    });
  }
}
