import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';

import { DATABASE } from '../database/database.module.js';
import { JobRunService } from '../common/jobs/job-run.service.js';
import { describeError } from '../common/errors/safe-error.js';

/** Its own advisory-lock key — see `SlaService` for what sharing one costs. */
const COMPLETION_LOCK_KEY = 8_421_007;

/**
 * Ends stays whose departure date has passed (§6.3, last step).
 *
 * ## Nothing did this, and it was not a small gap
 *
 * `checked_in → completed` names `system` and `staff` in the transition table and **neither had a
 * writer**: no route, no scheduled job, nothing. Found 2026-08-25 while completing the booking
 * screen. Every `completed` booking in the dev database is a seed row written directly, which is
 * the only reason the consequences were invisible:
 *
 * - `PayoutService` accrues over `b.status = 'completed'` — so on a real deployment **no partner
 *   would ever have been paid**, and the accrual would have run hourly finding nothing, for ever,
 *   without erroring.
 * - `ReviewService` refuses a review on anything else — so **no customer could ever have reviewed
 *   a stay**, and `properties.rating` would have stayed null across the platform.
 *
 * Both would have looked like a quiet product, not like a bug. That is the class this codebase
 * keeps meeting: built, green, and connected to nothing.
 *
 * ## Why a sweep and not a delayed job per booking
 *
 * Same reasoning `SlaService` gives: a sweep is self-healing. A per-booking job lost to a Redis
 * restart never fires; the next sweep still finds every departed stay. Hourly rather than
 * per-minute because a stay ending is not urgent to the hour — the accrual it feeds runs hourly
 * too.
 *
 * ## What it deliberately does NOT complete
 *
 * Only `checked_in`. A `confirmed` booking whose dates have passed is a stay **nobody recorded an
 * arrival for**, and that is ambiguous in a way this job must not resolve on its own: the guest
 * may never have turned up. `confirmed → completed` is not in the transition table, and widening
 * it would start paying partners for stays with no evidence anyone arrived. It is a real
 * operational gap — see `O-book-2` — and it needs a decision, not a default.
 */
@Injectable()
export class StayCompletionService {
  private readonly logger = new Logger(StayCompletionService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly runs: JobRunService,
  ) {}

  async sweep(): Promise<void> {
    await this.runs
      .runExclusively('stay-completion', COMPLETION_LOCK_KEY, async () => ({
        completed: await this.completeDepartedStays(),
      }))
      .catch((error: unknown) => {
        /*
          Swallowed after the row is written, as `SlaService` does: `runExclusively` records the
          failure and re-throws so the queue retries, and an unhandled rejection on the fallback
          path would take the API down for something the next hour would have retried.
        */
        this.logger.error(`Stay completion failed: ${describeError(error)}`);
      });
  }

  /**
   * Every checked-in stay whose check-out has passed, in one statement.
   *
   * ## The date comparison is in the PROPERTY's timezone
   *
   * `check_out` is a calendar date, and "has it passed" is a question about where the property is,
   * not where the server is. Comparing against `current_date` in UTC completes a Damascus stay
   * up to three hours early — while the guest may still be in the room — and the booking is what
   * a partner is paid for. `cities.timezone` is already how `ArrivalsService` decides what
   * «today» means for an arrival, so the two agree about the same day.
   *
   * ## Bounded, and the bound is not arbitrary
   *
   * `LIMIT` keeps one sweep's work bounded however long the job has been down — a backlog of
   * 50,000 stays after an outage must not become one statement holding row locks across the
   * busiest table in the schema (rule 2). The next hour takes the next batch, and the sweep is
   * self-healing precisely because it can be run again.
   */
  private async completeDepartedStays(): Promise<number> {
    const result = await this.db.execute<{ reference: string }>(sql`
      WITH departed AS (
        SELECT b.id
        FROM bookings b
        JOIN cities c ON c.id = b.city_id
        WHERE b.status = 'checked_in'
          AND b.deleted_at IS NULL
          AND b.check_out <= (now() AT TIME ZONE c.timezone)::date
        ORDER BY b.check_out
        LIMIT ${BATCH}
      ), done AS (
        UPDATE bookings b
        SET status = 'completed', completed_at = now(), updated_at = now()
        FROM departed
        WHERE b.id = departed.id AND b.status = 'checked_in'
        RETURNING b.id, b.reference
      ), recorded AS (
        INSERT INTO timeline_events (subject_type, subject_id, event_type, actor_type)
        SELECT 'booking', done.id, 'booking.completed', 'system' FROM done
      )
      SELECT reference FROM done
    `);

    if (result.rows.length > 0) {
      /*
        References, never guest names — a log line is the one place PII leaks without anybody
        deciding to publish it. The count is what alerting reads; the references are what a
        support agent greps for when somebody asks why a payout appeared.
      */
      this.logger.log(
        `Completed ${result.rows.length} stay(s): ${result.rows
          .map((row) => row.reference)
          .join(', ')}`,
      );
    }

    return result.rows.length;
  }
}

/**
 * How many stays one sweep will end.
 *
 * Hourly, and a platform at the SRS's 1M users does not end 500 stays in an hour under any
 * ordinary load — so this is a backstop against a backlog, not a throttle on normal operation. If
 * it is ever the binding constraint the sweep simply catches up over the following hours, which is
 * the behaviour a self-healing sweep is chosen for.
 */
const BATCH = 500;
