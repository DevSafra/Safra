import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';

import { DATABASE } from '../database/database.module.js';
import { JobRunService } from '../common/jobs/job-run.service.js';
import { RefundService } from './refund.service.js';
import { describeError } from '../common/errors/safe-error.js';

/** Its own advisory-lock key — see `SlaService` for what sharing one costs. */
const SYSTEM_REFUND_LOCK_KEY = 8_421_008;

/**
 * How many bookings one pass will refund. See the note on the bound below.
 */
const BATCH = 200;

/**
 * Returns the money when SAFRA cancelled a paid booking (§6.4).
 *
 * ## The gap this closes
 *
 * §6.4 prescribes «إلغاء الحجز، استرداد كامل» when the partner misses the two-hour window, and
 * «تلغي سفرة الحجز وتعيد المبلغ» when they refuse. Both cancellations happened; **the refund did
 * not**. `BookingActionsService.cancel` returned `refundPending: true` and nothing in the platform
 * read that field. `RefundService.execute` had exactly one caller — a button on the console — so
 * the customer's money came back only if a member of staff noticed. Found by the SRS audit on
 * 2026-08-25; 5,245 paid-and-cancelled bookings in the load database had no refund row, 5,226 of
 * them `system.partner_no_response`.
 *
 * ## A sweep, keyed on the REASON PREFIX rather than on call sites
 *
 * Bashar's instruction (2026-08-25) was «SLA expiry, partner non-response, **or any other
 * system-driven path**». Wiring a refund into each of today's two call sites would satisfy the
 * first two and silently miss the third the day somebody adds it. Keying on `system.%` means a
 * future system cancellation is covered by construction — it has to opt OUT by not using the
 * prefix, rather than opt in by remembering this file.
 *
 * It is also why this is not an inline call. `PaymentsModule` already imports `BookingsModule`, so
 * `SlaService` cannot reach `RefundService` without a cycle; and a sweep is self-healing where an
 * inline call is not. One that failed inside the cancelling transaction would either roll the
 * cancellation back or be lost — the next pass simply finds the booking still owed.
 *
 * ## What it deliberately does not touch
 *
 * **A customer's own cancellation.** Those are `cancellation_reason` values a person wrote, they go
 * through §7.4's tiers, and refunding them in full here would hand back money the policy says the
 * partner keeps. **A staff cancellation**, for the same reason — it is a judgement, and the console
 * has the tiered button for it. **`system.payment_expired`**, which is excluded without naming it:
 * no payment was ever captured, so there is nothing to return, and the wallet hold is released by
 * `SlaService` on that path already.
 */
@Injectable()
export class SystemRefundService {
  private readonly logger = new Logger(SystemRefundService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly refunds: RefundService,
    private readonly runs: JobRunService,
  ) {}

  /**
   * @param limit how many bookings this pass may refund. Defaults to `BATCH`.
   *
   * The parameter exists for TESTS, and the reason is worth stating: a pass over a shared database
   * takes row locks on `bookings`, `payments`, `refunds`, `ledger_entries` and a wallet per booking
   * it refunds, for as long as the pass runs. Left unbounded in the suite it locked several
   * thousand rows and timed out `payments.integration.test.ts`, which commits for real — a failure
   * in a file that had nothing to do with the change. A test bounds itself to its own fixtures
   * instead; production never passes an argument.
   */
  async sweep(limit = BATCH): Promise<void> {
    await this.runs
      .runExclusively('system-refunds', SYSTEM_REFUND_LOCK_KEY, async () =>
        this.run(limit),
      )
      .catch((error: unknown) => {
        /*
          Swallowed after the row is written, as the other sweeps do: `runExclusively` records the
          failure and re-throws so the queue retries, and an unhandled rejection on the fallback
          path would take the API down for something the next pass would have retried.
        */
        this.logger.error(`System refund sweep failed: ${describeError(error)}`);
      });
  }

  private async run(limit: number): Promise<{ refunded: number; failed: number }> {
    const owed = await this.owed(limit);

    let refunded = 0;
    let failed = 0;

    for (const booking of owed) {
      try {
        /*
          One booking at a time, each in its own transaction inside `RefundService`.

          A single failure — a provider that will not answer, a currency with no rate — must not
          cost the other 199 their refunds. The count of failures is returned so the job run row
          says so rather than reporting a clean pass.
        */
        const result = await this.refunds.refundInFull(
          booking.reference,
          /*
            The REASON is the cancellation's own code, forwarded.

            `refunds.reason` is read on the console and in the audit trail, and «full refund» would
            say what happened without saying why. `system.partner_no_response` names the rule that
            produced it, and it is a code rather than a sentence for the reason every refusal in
            this codebase is.
          */
          booking.cancellation_reason,
        );

        refunded += 1;

        this.logger.log(
          `Refunded ${result.amount} on ${booking.reference} (${result.status}).`,
        );
      } catch (error: unknown) {
        failed += 1;

        this.logger.error(
          `Could not refund ${booking.reference}: ${describeError(error)}`,
        );
      }
    }

    return { refunded, failed };
  }

  /**
   * Paid, cancelled by the system, and nothing has gone back yet.
   *
   * ## `NOT EXISTS` over a refund in any live state
   *
   * `pending`, `processing` and `completed` all mean the money is on its way, so any of them makes
   * this booking not owed. A `failed` refund does NOT — that one is owed again, and this sweep
   * retrying it is the recovery path for a provider that was briefly unreachable.
   *
   * ## A failure BACKS OFF, or it starves the queue behind it
   *
   * Found while writing this file's test. A refund that can never succeed — a payment taken by a
   * provider no longer registered is the real case — fails on every pass, and because the batch is
   * ordered oldest-first it keeps its place at the HEAD. At five-minute passes a handful of those
   * would occupy the first slots for ever and every customer behind them would wait on a retry that
   * is never going to work.
   *
   * So a booking whose last attempt failed is left alone for an hour. A transient outage still
   * recovers within the hour; a permanent one costs one slot an hour instead of one every five
   * minutes, and the failure is in `scheduled_job_runs` either way.
   *
   * ## Bounded, and the bound is not arbitrary
   *
   * A backlog of five thousand — which is what the audit actually found — must not become one pass
   * holding row locks across `bookings`, `refunds` and `ledger_entries` at once (rule 2). At
   * `BATCH` a pass, five thousand clears in about two hours of five-minute passes, and every pass
   * is independently correct because the query re-reads what is still owed.
   *
   * Ordered oldest-cancelled first, so a backlog drains in the order the customers have been
   * waiting rather than in whatever order the planner returns.
   */
  private async owed(
    limit: number,
  ): Promise<{ reference: string; cancellation_reason: string }[]> {
    const rows = await this.db.execute<{
      reference: string;
      cancellation_reason: string;
    }>(sql`
      SELECT b.reference, b.cancellation_reason
      FROM bookings b
      WHERE b.status = 'cancelled'
        AND b.deleted_at IS NULL
        AND b.paid_at IS NOT NULL
        AND b.cancellation_reason LIKE 'system.%'
        AND EXISTS (
          SELECT 1 FROM payments p
          WHERE p.booking_id = b.id
            AND p.status IN ('captured', 'partially_refunded')
        )
        AND NOT EXISTS (
          SELECT 1 FROM refunds r
          WHERE r.booking_id = b.id
            AND r.status IN ('pending', 'processing', 'completed')
        )
        AND NOT EXISTS (
          SELECT 1 FROM refunds r
          WHERE r.booking_id = b.id
            AND r.status = 'failed'
            AND r.updated_at > now() - INTERVAL '1 hour'
        )
      ORDER BY b.cancelled_at
      LIMIT ${limit}
    `);

    return rows.rows;
  }
}
