/**
 * The recurring jobs, and the cron expressions they run on.
 *
 * ## Why the schedule lives here and not on a decorator
 *
 * `@Cron` fires on EVERY replica, which is why each of these bodies is wrapped in an advisory lock
 * — four nodes would otherwise accrue four times. A BullMQ repeatable job is scheduled ONCE in
 * Redis regardless of how many API processes declare it, and `scheduled` runs at concurrency 1, so
 * the queue answers what the lock was answering.
 *
 * The names are the ones already written to `scheduled_job_runs` and queried by the runbook and by
 * `safra_job_last_success_age_seconds`. **They must not change.** A renamed job looks to alerting
 * exactly like a job that stopped running.
 *
 * ## The expressions are the ones the decorators used
 *
 * Copied deliberately rather than improved: phase 4 is a migration, and a schedule that changed in
 * the same commit as the mechanism would make any difference in behaviour impossible to attribute.
 * `EVERY_MINUTE`, `EVERY_HOUR`, `EVERY_DAY_AT_3AM` and `EVERY_DAY_AT_4AM` in `@nestjs/schedule` are
 * these five strings.
 */
export const SCHEDULED_JOBS = {
  'booking-sla-sweep': '* * * * *',
  'payout-accrual': '0 * * * *',
  /**
   * Ending stays whose departure has passed — the gap found on 2026-08-25.
   *
   * Ten past the hour, so it runs BEFORE the accrual it feeds rather than fifty minutes after it:
   * a stay that ended overnight is then payable on the next accrual rather than the one after.
   * Both are hourly, and the ten minutes is the ordering, not a race — `payout-accrual` reads
   * whatever is `completed` when it runs and is correct either way.
   */
  'stay-completion': '10 * * * *',
  /**
   * Returning the money on a booking SAFRA itself cancelled — §6.4, and `O-book-5`'s High.
   *
   * Five minutes rather than hourly: this is a customer's money, and the wait between «your
   * booking is cancelled» and «the refund is on its way» is the whole experience of the failure.
   * It costs one partial-index probe when there is nothing owed, which is the ordinary case.
   */
  'system-refunds': '*/5 * * * *',
  'ranking-recompute': '0 3 * * *',
  'webhook-retention': '0 3 * * *',
  /**
   * Removing credentials that have stopped being credentials — `O-sec-6` and `O-sec-11`.
   *
   * 03:30 rather than 03:00, so it does not start while `ranking-recompute` and
   * `webhook-retention` are both already running: all three are batch deletes or large reads
   * against the primary, and stacking them puts the heaviest half-hour of the night on one minute.
   */
  'credential-retention': '30 3 * * *',
  'sanctions-refresh': '0 4 * * *',
  /**
   * Re-driving notifications whose jobs were lost — the recovery half of `O-notify-2`.
   *
   * Five minutes, which is the only cadence here that was chosen rather than inherited. A notice
   * that is lost is a partner who has not been told a booking is waiting, and §6.4 gives them a
   * bounded window to answer it — so the interval has to be short relative to that window and long
   * enough that a rolling deploy does not look like an outage. It costs one indexed query when
   * there is nothing to do.
   */
  'notification-redrive': '*/5 * * * *',
} as const;

export type ScheduledJobName = keyof typeof SCHEDULED_JOBS;

/** Every job's payload: which one to run. The body takes no arguments — none of them ever did. */
export interface ScheduledJobData {
  readonly job: ScheduledJobName;
}

/**
 * The repeatable job's key, which BullMQ uses to recognise a schedule it already holds.
 *
 * Stable per job, so redeploying does not accumulate a second schedule for the same work — the
 * failure mode being an SLA sweep that runs twice a minute, then three times, one per deploy, and
 * the only symptom being a `scheduled_job_runs` table with more `skipped` rows than anybody
 * expected.
 *
 * A dash, never a colon: BullMQ rejects `:` in an id outright.
 */
export function scheduledJobId(job: ScheduledJobName): string {
  return `scheduled-${job}`;
}
