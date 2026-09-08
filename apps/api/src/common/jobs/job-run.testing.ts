import type { Database } from '@safra/db';

import { describeError } from '../errors/safe-error.js';
import { JobRunService } from './job-run.service.js';

/**
 * A `JobRunService` that runs the work WITHOUT taking the advisory lock.
 *
 * ## Why this exists
 *
 * `runExclusively` takes a per-job PostgreSQL advisory lock so two replicas cannot process one
 * batch twice — correct in production, and a race between TEST FILES. Vitest runs files in
 * parallel, and three of them drive the SLA sweep: `sla-expiry.integration.test.ts`, which is
 * ABOUT the sweep, plus `payments` and `room-inventory`, which use it as a means to an end. They
 * share one key, so whichever asks second gets `false`, its sweep skips, and it reads «no reminder
 * was sent». The development WORKERS run the same jobs on a schedule against the same database,
 * which is a second instance of the same collision (finding 227).
 *
 * Measured on 2026-09-08: with the workers paused — so the contention was purely between test
 * files — `sla-expiry` still failed on two of five full runs, always on the two assertions that
 * count reminders. It had been mis-diagnosed as ambient data twice (findings 216 and 224). With
 * this in place, five consecutive full runs pass with the workers RUNNING.
 *
 * ## Nothing is lost
 *
 * The exclusivity has its own suite — `job-run.integration.test.ts`, nine assertions over a key
 * «outside the range any real job uses», including that a second connection is refused and that
 * the lock is released after a throw. So the guarantee stays covered, by the file that is about
 * it, and no sweep suite can fail for a reason it is not testing.
 *
 * Everything else is the real service: `record` still writes `scheduled_job_runs`, so a suite
 * reading that table sees the production row shape, and a throwing job still re-throws.
 */
class UnlockedJobRunService extends JobRunService {
  override async runExclusively(
    job: string,
    _key: number,
    work: () => Promise<Record<string, unknown>>,
  ): Promise<void> {
    const startedAt = Date.now();

    try {
      const detail = await work();

      await this.recordRun(job, 'completed', detail, null, Date.now() - startedAt);
    } catch (error) {
      /*
        `describeError`, not `error.message` — the same rule the real runner follows, and it
        applies here for exactly the same reason.

        This wrote `error.message` for about ten minutes and `no-raw-error-messages.test.ts` failed
        deterministically on all five runs. It was right to: this string goes into
        `scheduled_job_runs.error`, a COLUMN the console renders, and drizzle builds a query
        error's message as «Failed query: <sql>\nparams: <values>» — the bound values. On a sweep
        those are booking references and money; on anything touching `users` they would be an
        Argon2id hash and an encrypted TOTP secret. A test helper writing to the same column has
        the same duty as the code it stands in for.
      */
      await this.recordRun(
        job,
        'failed',
        null,
        describeError(error),
        Date.now() - startedAt,
      ).catch(() => undefined);

      throw error;
    }
  }

  /**
   * `record` is private on the parent, and reached here through ONE narrow cast rather than
   * duplicated.
   *
   * Duplicating the INSERT would be the worse choice: a suite asserting on `scheduled_job_runs`
   * would then be reading a shape this file invented, and the day the real column set changes the
   * assertions would keep passing against the old one.
   */
  private async recordRun(
    job: string,
    status: string,
    detail: Record<string, unknown> | null,
    error: string | null,
    durationMs: number,
  ): Promise<void> {
    const reach = this as unknown as {
      record: (
        job: string,
        status: string,
        detail: Record<string, unknown> | null,
        error: string | null,
        durationMs: number,
      ) => Promise<void>;
    };

    await reach.record(job, status, detail, error, durationMs);
  }
}

/** The runner a sweep suite should use unless the suite is about locking. */
export function unlockedJobRuns(db: Database): JobRunService {
  return new UnlockedJobRunService(db);
}
