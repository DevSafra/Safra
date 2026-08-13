import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { exportStatus, jobRunStatus } from './enums.js';
import { createdAt, foreignId, primaryId, timestamps } from './_shared.js';
import { users } from './identity.js';

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

/**
 * Jobs that exhausted every retry, kept somewhere that survives Redis.
 *
 * ## Why a table, when BullMQ already has a `failed` set
 *
 * `docs/background-jobs-design.md` is blunt about it: BullMQ has no dead-letter queue, a job that
 * runs out of attempts simply stays in `failed`, **and nothing reads `failed`**. Two consequences.
 * It is invisible — no screen, no alert, no query anybody runs. And it is in Redis, so a flush, a
 * failover or an eviction takes the only record that the work was ever attempted.
 *
 * A row here is durable, queryable, alertable, and outlives the instance. That is the whole point.
 *
 * ## The payload is REDACTED before it is stored
 *
 * Job payloads carry email addresses and booking references, and this table is read by support
 * staff from a console screen — the same population, and the same argument, as `notifications` not
 * storing a recipient. `redactContactDetails` already exists for exactly this and is applied on the
 * way in, so the mask is in the row rather than in the renderer.
 *
 * ## Never re-driven automatically
 *
 * There is no cron that replays these. A job that failed eight times over four hours has a reason,
 * and replaying it on a schedule is how one malformed payload becomes an infinite loop that also
 * fills this table. Retrying is a decision a person makes on the `/jobs` screen, audited, behind
 * `JOB_MANAGE` — and it enqueues with a FRESH id, so the retry is its own job rather than a
 * resurrection of one BullMQ still considers finished.
 */
export const deadLetterJobs = pgTable(
  'dead_letter_jobs',
  {
    id: primaryId(),
    /** Which queue. Not an enum: a queue added in a later phase must not need a migration here. */
    queue: text('queue').notNull(),
    /** The job's name within the queue, e.g. `notification.send`. */
    name: text('name').notNull(),
    /**
     * BullMQ's own job id, kept for correlation with whatever is still in Redis.
     *
     * Deliberately NOT unique. The same logical job can dead-letter twice — once, then again after
     * a staff retry that also failed — and each attempt is its own evidence. A unique constraint
     * here would silently discard the second.
     */
    jobId: text('job_id').notNull(),
    /** Redacted. See the table note. */
    payload: jsonb('payload'),
    /** The last error's message, never its stack — same reasoning as `scheduledJobRuns.error`. */
    error: text('error'),
    attempts: text('attempts').notNull(),
    failedAt: timestamp('failed_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set when a person retries or discards it, so the screen can show only what is outstanding. */
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: text('resolved_by'),
    /** `retried` | `discarded`. Text rather than an enum for the same reason as `queue`. */
    resolution: text('resolution'),
    ...createdAt,
  },
  (t) => [
    /*
      The screen's only question: what is outstanding, newest first. Partial, because a resolved row
      is history and the alert and the queue both care exclusively about unresolved ones.
    */
    index('dead_letter_jobs_outstanding_idx')
      .on(t.failedAt)
      .where(sql`resolved_at IS NULL`),
    index('dead_letter_jobs_queue_idx').on(t.queue, t.failedAt),
  ],
);

/**
 * A CSV somebody asked for, and where it got to.
 *
 * ## Why an export is a ROW and not a response
 *
 * It used to be neither: `GET /admin/bookings/export` built the file inside the request and streamed
 * it back, capped at 20,000 rows *because* it was synchronous. Rule 2 names exports among the work
 * that must not block a request, and the cap was that rule being paid for in missing data — an
 * operator exporting a busy quarter got a truncated file with a comment at the bottom.
 *
 * Making it a row is what removes the cap. It also makes the export a THING: it has a reference the
 * operator can quote, a status they can watch, a size they can see before downloading, and an
 * expiry after which it stops existing.
 *
 * ## The file is private and expires
 *
 * A booking export is the cheapest way to pull a large slice of customer data out of the platform,
 * so the object lives under a prefix the bucket policy does not grant anonymous read to, and it is
 * fetched through the API by an authorised caller whose download writes an audit row. `expires_at`
 * exists because a CSV of every booking sitting in a bucket forever is a breach waiting for a
 * misconfiguration.
 */
export const exportJobs = pgTable(
  'export_jobs',
  {
    id: primaryId(),
    reference: text('reference')
      .notNull()
      .unique()
      .default(sql`'EXP-' || reference_number(nextval('export_reference_seq'))`),
    /**
     * Who asked. Not nullable: an export with no requester is one nobody can be asked
     * about, and this table exists partly to answer that question.
     */
    requestedByUserId: foreignId('requested_by_user_id')
      .notNull()
      .references(() => users.id),
    /** `bookings` today. Text rather than an enum so a second report needs no migration. */
    kind: text('kind').notNull(),
    /**
     * The filters the export was run with, as an ALLOW-LISTED object.
     *
     * Stored so the file can be explained later — "2,531 rows" means nothing without
     * knowing which slice — and re-validated on the way out, because a `jsonb` column is
     * not a promise about its own shape.
     */
    filters: jsonb('filters')
      .$type<Record<string, string | null>>()
      .notNull()
      .default({}),
    status: exportStatus('status').notNull().default('queued'),
    /** Rows written. Null until it is `ready`; shown so a suspiciously small file is visible. */
    rowCount: integer('row_count'),
    /** Where the CSV is. Private prefix; null until ready, and null again once pruned. */
    fileKey: text('file_key'),
    /** An ERROR code, never a sentence — the operator reads it in their own language. */
    failureCode: text('failure_code'),
    /** After this the object is deleted and the row becomes a record that it existed. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    /* The screen: this operator's exports, newest first. */
    index('export_jobs_requester_idx').on(t.requestedByUserId, t.createdAt),
    /*
      The unfinished ones — small by construction, and what the stuck-export gauge reads on every
      metrics scrape. Partial for the same reason as `property_images_processing_idx`.
    */
    index('export_jobs_pending_idx')
      .on(t.createdAt)
      .where(sql`status IN ('queued', 'running')`),
  ],
);
