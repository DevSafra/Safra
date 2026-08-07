import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { jobRunStatus } from './enums.js';
import { primaryId } from './_shared.js';

/**
 * What the scheduled jobs did, and when they last did it.
 *
 * ## Why this exists
 *
 * A cron job that logs and nothing else is invisible: the failure mode nobody notices is not "it
 * threw" — that lands in the log — it is "it stopped firing". Six weeks later somebody asks why no
 * partner has been paid since March, and the answer is in a log rotation that expired in April.
 *
 * A row per run makes the ABSENCE of runs queryable, which is the thing worth alerting on. It is
 * also what lets an operator answer "has accrual run since that booking completed?" without shell
 * access to a container.
 *
 * ## Not the audit log
 *
 * `audit_log` records decisions PEOPLE made and is append-only evidence (§15). A job run is a
 * machine event with no actor; putting it there would bury the decisions the audit log exists to
 * surface, which is the same reasoning that keeps `notifications` separate from `messages`.
 *
 * ## Retention
 *
 * Nothing prunes this yet. At one accrual an hour it is ~8,760 rows a year, which is small enough
 * that a policy can wait for the general retention work (S-4) rather than being invented here.
 */
export const scheduledJobRuns = pgTable(
  'scheduled_job_runs',
  {
    id: primaryId(),
    /** The job's stable name, e.g. `payout-accrual`. Matches the `@Cron` name. */
    job: text('job').notNull(),
    status: jobRunStatus('status').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    /** Milliseconds, so a job that is getting slower is visible before it times out. */
    durationMs: text('duration_ms'),
    /** Whatever the job wants to report — counts, mostly. Never anything sensitive. */
    detail: jsonb('detail'),
    /**
     * The failure, as a MESSAGE rather than a stack.
     *
     * A stack in a table an operator reads is noise, and it is also the most likely place for a
     * connection string or a token to end up. The stack goes to the log, which is where it is
     * useful and where the redaction rules already apply.
     */
    error: text('error'),
  },
  (t) => [
    /* "When did this job last run, and did it work" — the only question asked of this table. */
    index('scheduled_job_runs_job_idx').on(t.job, t.startedAt),
  ],
);
