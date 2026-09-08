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
 * was sent».
 *
 * Measured on 2026-09-08: with the development workers paused — so the contention was purely
 * between test files — `sla-expiry` still failed on two of five full runs, always on the two
 * assertions that count reminders. It has been mis-diagnosed as ambient data twice (findings 216
 * and 224) and as worker contention once (227, which is a real and separate instance of the same
 * root cause).
 *
 * ## Why the suites that are not about locking use this
 *
 * Because a lock they did not ask for cannot fail them for a reason they are not testing. The
 * exclusivity itself stays covered where it belongs — `sla-expiry` keeps the REAL service, and it
 * is now the only file holding that key, so nothing contends with it.
 *
 * Everything else is the real thing: `record` still writes `scheduled_job_runs`, so a suite reading
 * that table sees what it would see in production, and a throwing job still re-throws.
 */
export function unlockedJobRuns(db: Database): JobRunService {
  const real = new JobRunService(db);

  return new Proxy(real, {
    get(target, property, receiver) {
      if (property !== 'runExclusively') {
        return Reflect.get(target, property, receiver);
      }

      /*
        The lock is skipped and NOTHING else is. `record` is called through the real instance, so
        the row shapes a suite asserts on are the production ones — a stub that recorded nothing
        would quietly break every «the job wrote a run row» assertion.
      */
      return async (
        job: string,
        _key: number,
        work: () => Promise<Record<string, unknown>>,
      ): Promise<void> => {
        const startedAt = Date.now();

        try {
          const detail = await work();

          await recordOn(target, job, 'completed', detail, null, Date.now() - startedAt);
        } catch (error) {
          /*
            `describeError`, not `error.message` — the same rule the real runner follows, and it
            applies here for exactly the same reason.

            This wrote `error.message` for about ten minutes, and `no-raw-error-messages.test.ts`
            failed deterministically on all five runs. It was right to: this string goes into
            `scheduled_job_runs.error`, a COLUMN the console renders, and drizzle builds a query
            error's message as «Failed query: <sql>\nparams: <values>» — the bound values. On a
            sweep those are booking references and money; on anything touching `users` they would
            be an Argon2id hash and an encrypted TOTP secret. A test helper writing to the same
            column has the same duty as the code it stands in for.
          */
          await recordOn(
            target,
            job,
            'failed',
            null,
            describeError(error),
            Date.now() - startedAt,
          ).catch(() => undefined);

          throw error;
        }
      };
    },
  });
}

/** `record` is private on the service; reached here rather than duplicated. */
async function recordOn(
  service: JobRunService,
  job: string,
  status: string,
  detail: Record<string, unknown> | null,
  error: string | null,
  durationMs: number,
): Promise<void> {
  await (
    service as unknown as {
      record: (
        job: string,
        status: string,
        detail: Record<string, unknown> | null,
        error: string | null,
        durationMs: number,
      ) => Promise<void>;
    }
  ).record(job, status, detail, error, durationMs);
}
