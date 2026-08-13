import { Injectable } from '@nestjs/common';

import { JobRunService } from '../common/jobs/job-run.service.js';
import { PayoutService } from './payout.service.js';

/**
 * Arbitrary but fixed. Any 64-bit int works; it only has to be unique among this app's locks —
 * `RankingScheduler` holds 8_421_001.
 */
const PAYOUT_ACCRUAL_LOCK = 8_421_002;

/**
 * Sweeping newly-payable bookings into their partners' open periods, on a schedule.
 *
 * ## Why hourly rather than nightly
 *
 * Accrual is the step between "the stay finished" and "the partner can see what they are owed",
 * and a partner whose guest checked out this morning asking why their dashboard shows nothing is a
 * support ticket. Hourly keeps that gap under an hour; the work is a single INSERT … SELECT over
 * an indexed predicate, so the cost of running it twenty-four times a day rather than once is not
 * measurable.
 *
 * ## Safe to run at any time, and to run twice
 *
 * `PayoutService.accrue` is idempotent by CONSTRUCTION rather than by convention: a unique index on
 * `partner_payout_items.booking_id` means a booking already attached cannot be attached again,
 * whatever the query returns. Two overlapping runs produce one attachment, and a manual run
 * alongside the cron is harmless — which is what makes the recovery procedure in
 * `docs/runbook-payouts.md` as simple as "run it again".
 *
 * ## What it deliberately does NOT do
 *
 * It accrues. It does not close a period, release a transfer or pay anybody: those move money and
 * §4.1 requires a person holding `PAYOUT_EXECUTE` to decide each one. A scheduler that released
 * payouts would be a scheduler that sent money without anybody deciding to.
 */
@Injectable()
export class PayoutScheduler {
  constructor(
    private readonly payouts: PayoutService,
    private readonly runs: JobRunService,
  ) {}

  /**
   * One accrual, locked and recorded — the cron's body, and what the manual endpoint calls.
   *
   * Shared deliberately. A hand-run that bypassed the recorder would be invisible in
   * `scheduled_job_runs`, so the console's "last accrual" footnote and the runbook's "run it
   * again" step would disagree about whether anything had happened. Sharing the lock also means a
   * manual run during a scheduled one skips rather than racing it.
   */
  async run(): Promise<void> {
    await this.runs.runExclusively('payout-accrual', PAYOUT_ACCRUAL_LOCK, async () => {
      const result = await this.payouts.accrue();

      return { attached: result.attached, payouts: result.payouts };
    });
  }
}
