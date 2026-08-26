import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { SLA_EXPIRY_WARNING_MINUTES, WALLET_NOTE } from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { MONEY_SCALE, toMinor } from '../common/money.js';
import { MoneySettingsService } from '../settings/money-settings.service.js';
import { WalletService } from '../wallet/wallet.service.js';
import { NotificationService } from '../notifications/notification.service.js';
import {
  bookingCancelledBySafraMail,
  bookingDeadlineReminderMail,
} from '../mail/mail.templates.js';
import { ENV, type Env } from '../config/env.js';
import { JobRunService } from '../common/jobs/job-run.service.js';
import { describeError } from '../common/errors/safe-error.js';

/** Distinct advisory-lock key per job; see RankingScheduler for the rationale. */
/**
 * Its OWN advisory-lock key — it shared `payout-accrual`'s until 2026-08-20.
 *
 * Every service here carries a comment saying "distinct advisory-lock key per job", and two of
 * them said `8_421_002`. `pg_try_advisory_lock` returns immediately rather than queueing, so the
 * consequence was not a stall: whichever job asked second SIMPLY SKIPPED, recorded as `skipped`,
 * which is the value alerting is told to ignore because it means "another replica did it".
 *
 * That made the failure invisible by construction. This sweep runs every MINUTE and the accrual
 * hourly, so across replicas the accrual could be skipped at the top of an hour and nothing would
 * say so until signal 1 fired two hours later — if the next hour's attempt did not simply succeed
 * and reset the clock.
 *
 * One process could never show it: the `scheduled` queue runs at concurrency 1, so the two never
 * overlap in a single worker. It needs the production topology, which is exactly where nobody is
 * watching a debug log.
 */
const SLA_LOCK_KEY = 8_421_006;

/**
 * The two deadlines that expire bookings, swept once a minute.
 *
 *  1. **EC-001** — payment never completed, so `pending_payment` expires and the
 *     dates are released.
 *  2. **§6.4** — the partner did not answer within the confirmation window, so the
 *     booking is cancelled, the customer is refunded and compensated, and the
 *     partner is fined.
 *
 * A periodic sweep rather than a delayed job per booking. §14 wants a background
 * queue and BullMQ arrives in Phase 5, but a sweep has a property a delayed job
 * lacks: it is **self-healing**. A job lost to a Redis restart never fires, whereas
 * the next sweep still finds every expired row. When this moves to BullMQ the sweep
 * should stay as the reconciling backstop.
 */
@Injectable()
export class SlaService {
  private readonly logger = new Logger(SlaService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly money: MoneySettingsService,
    private readonly ledger: LedgerService,
    private readonly wallet: WalletService,
    private readonly runs: JobRunService,
    private readonly notifications: NotificationService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async sweep(): Promise<void> {
    /*
      Through `JobRunService`, which is the lock AND the record — as of BullMQ phase 4.

      This method had its own hand-rolled copy of the advisory lock and wrote nothing to
      `scheduled_job_runs`. That table is what the runbook queries and what
      `safra_job_last_success_age_seconds` alerts on, so of the five recurring jobs only two were
      visible to it — and the SWEEP was one of the three that were not.

      That is the worst possible one to be missing. A sweep that stops firing does not throw and
      does not log: it produces silence, and the consequence of the silence is that customers owed
      §6.4 compensation do not get it. «الفشل الذي لا يلاحظه أحد» — the failure nobody notices — is
      exactly what a row per run makes queryable, because an ABSENCE cannot be logged.

      `runExclusively` also records a `skipped` row when another replica holds the lock, so a
      four-node fleet reads as four attempts and one run rather than as a job running a quarter as
      often as it does.
    */
    await this.runs
      .runExclusively('booking-sla-sweep', SLA_LOCK_KEY, async () => {
        const expiredPayments = await this.expireUnpaidBookings();
        const expiredConfirmations = await this.expireUnconfirmedBookings();
        /*
          AFTER the expiries, deliberately.

          A booking whose window has just closed is cancelled by the pass above, so it is no longer
          `pending_confirmation` and this one cannot send a partner a reminder about a deadline
          that has already passed — which would be the platform asking for a decision it had just
          taken away.
        */
        const reminded = await this.remindPartners();

        return { expiredPayments, expiredConfirmations, reminded };
      })
      .catch((error: unknown) => {
        /*
          Swallowed HERE rather than inside the job, which is a deliberate difference from the
          other four.

          `runExclusively` records the failure and then re-throws, which is right: on the queue a
          thrown job is retried. But this method is also called by the `@Cron` fallback path, where
          an unhandled rejection kills the process — and a failed sweep must never take the API
          down when the next minute would have retried anyway. Catching after the row is written
          keeps both properties.
        */
        this.logger.error(`SLA sweep failed: ${describeError(error)}`);
      });
  }

  /**
   * EC-001 — abandoned checkout.
   *
   * Cancelling frees the dates immediately, because `cancelled` is outside the
   * exclusion constraint's predicate. No compensation and no fine: nobody is at
   * fault when a customer simply closes the tab.
   */
  private async expireUnpaidBookings(): Promise<number> {
    const result = await this.db.execute<{
      id: string;
      reference: string;
      customer_profile_id: string;
      currency_id: string;
      wallet_amount: string;
    }>(sql`
      WITH expired AS (
        UPDATE bookings
        SET status = 'cancelled',
            cancelled_at = now(),
            -- A CODE, not a sentence. See the note on cancellation reasons below.
            cancellation_reason = 'system.payment_expired'
        WHERE status = 'pending_payment'
          AND confirmation_deadline_at IS NOT NULL
          AND confirmation_deadline_at < now()
          AND deleted_at IS NULL
        RETURNING id, reference, customer_profile_id, currency_id,
                  wallet_amount::text AS wallet_amount
      )
      SELECT id, reference, customer_profile_id, currency_id, wallet_amount FROM expired
    `);

    for (const booking of result.rows) {
      await this.db.execute(sql`
        INSERT INTO timeline_events (subject_type, subject_id, event_type, actor_type, payload)
        VALUES ('booking', ${booking.id}, 'booking.payment_expired', 'system',
                ${JSON.stringify({ reason: 'EC-001' })}::jsonb)
      `);

      await this.releaseWalletHold(booking);
    }

    return result.rows.length;
  }

  /**
   * Returns stored value held against a booking that expired unpaid (§7.3).
   *
   * Without this, abandoning checkout after applying a balance would destroy it:
   * the wallet was debited when the payment attempt reached the gateway, and the
   * booking is now cancelled with nothing captured. The customer would simply be
   * poorer, with a `booking_payment` debit and no booking to show for it.
   *
   * Its own transaction per booking, and failures are logged rather than thrown —
   * the cancellation has already committed, and one wallet that cannot be credited
   * must not stop the sweep from expiring the rest. A missed release shows up as a
   * booking with a non-zero `wallet_amount` in a terminal state, which is
   * queryable.
   */
  private async releaseWalletHold(booking: {
    id: string;
    reference: string;
    customer_profile_id: string;
    currency_id: string;
    wallet_amount: string;
  }): Promise<void> {
    if (toMinor(booking.wallet_amount, MONEY_SCALE) <= 0n) return;

    try {
      await this.db.transaction(async (tx) => {
        await this.wallet.credit(tx as unknown as Database, {
          customerProfileId: booking.customer_profile_id,
          amount: booking.wallet_amount,
          currencyId: booking.currency_id,
          reason: 'refund',
          bookingId: booking.id,
          note: WALLET_NOTE.RETURNED_EXPIRED,
        });

        await tx.execute(sql`
          UPDATE bookings SET wallet_amount = 0, updated_at = now()
          WHERE id = ${booking.id}
        `);
      });

      this.logger.log(
        `Returned ${booking.wallet_amount} to the wallet for expired ${booking.reference}.`,
      );
    } catch (error) {
      this.logger.error(
        `Could not return the wallet hold on ${booking.reference}: ` +
          `${describeError(error)}`,
      );
    }
  }

  /**
   * §6.3 step 5 — «تتواصل سفرة مع الشريك لتسريع التأكيد».
   *
   * ## What was missing
   *
   * The partner is told once, when the money lands (`booking.needs_action`). The SRS asks SAFRA to
   * CHASE that, and `partner.deadline_reminder` sat in the console's template catalogue with
   * nothing sending it — a template staff could see and no partner ever received.
   *
   * ## Thirty minutes, and not a new number
   *
   * `SLA_EXPIRY_WARNING_MINUTES` already decides when the console starts warning staff that a
   * window is closing. Reusing it means the partner is chased at the same moment an operator is
   * told to chase them, rather than two thresholds drifting apart — which is the whole reason that
   * constant was extracted from three copies.
   *
   * ## Sent once, decided from the delivery log
   *
   * There is no `reminded_at` column and this does not add one: `notifications` already records
   * every message with its template key and its booking, so "has this partner been reminded about
   * this booking" is a question the log can answer. A `failed` row still counts as sent — the
   * re-drive sweep owns retrying delivery, and reminding somebody twice because the first attempt
   * bounced is a worse outcome than the bounce.
   */
  private async remindPartners(): Promise<number> {
    const due = await this.db.execute<{
      id: string;
      reference: string;
      partner_id: string;
      email: string | null;
      locale: string | null;
      property: string | null;
      check_in: string;
      check_out: string;
      deadline: string;
    }>(sql`
      SELECT b.id, b.reference, b.partner_id, u.email, u.preferred_locale AS locale,
             coalesce(pr.name_ar, pr.name_en) AS property,
             b.check_in::text, b.check_out::text,
             to_char(b.confirmation_deadline_at, 'YYYY-MM-DD HH24:MI') AS deadline
      FROM bookings b
      JOIN partners pa   ON pa.id = b.partner_id
      JOIN users u       ON u.id = pa.user_id
      JOIN properties pr ON pr.id = b.property_id
      WHERE b.status = 'pending_confirmation'
        AND b.deleted_at IS NULL
        AND b.partner_responded_at IS NULL
        AND b.confirmation_deadline_at IS NOT NULL
        AND b.confirmation_deadline_at > now()
        AND b.confirmation_deadline_at
              <= now() + (${SLA_EXPIRY_WARNING_MINUTES}::int * INTERVAL '1 minute')
        AND NOT EXISTS (
          SELECT 1 FROM notifications n
          WHERE n.booking_id = b.id AND n.template_key = 'partner.deadline_reminder'
        )
      /*
        Most urgent first, and the ordering is not cosmetic.

        There are more bookings inside the warning window than one batch takes — 118 against a
        LIMIT of 100 on the development database alone — and with no ORDER BY, which 100 the
        planner returns is undefined. A booking could be passed over minute after minute while its
        own window ran out, which is the one failure a reminder exists to prevent. Ordering by the
        deadline means the closest to lapsing is always in the batch.
      */
      ORDER BY b.confirmation_deadline_at
      LIMIT 100
    `);

    let sent = 0;

    for (const booking of due.rows) {
      if (!booking.email) continue;

      const locale = booking.locale ?? 'ar';

      try {
        await this.notifications.notify(
          'partner.deadline_reminder',
          bookingDeadlineReminderMail({
            to: booking.email,
            locale,
            reference: booking.reference,
            property: booking.property ?? '',
            checkIn: booking.check_in,
            checkOut: booking.check_out,
            deadline: booking.deadline,
            url: `${this.env.PARTNER_URL}/`,
          }),
          locale,
          { bookingId: booking.id, partnerId: booking.partner_id },
        );

        sent += 1;
      } catch (error: unknown) {
        /* One partner unreachable must not cost the rest of the batch their reminder. */
        this.logger.error(
          `Could not remind the partner about ${booking.reference}: ${describeError(error)}`,
        );
      }
    }

    return sent;
  }

  /**
   * §6.4 — the partner missed the two-hour window.
   *
   * The consequences are prescribed by the spec and applied here as one transaction
   * per booking: cancel, credit the customer's wallet with compensation, record a
   * violation and fine against the partner, and dock their score.
   *
   * Deliberately NOT a single set-based UPDATE like the payment sweep: each booking
   * needs a wallet credit and a violation row, and doing that per booking in its own
   * transaction means one failure cannot roll back the others.
   */
  private async expireUnconfirmedBookings(): Promise<number> {
    const due = await this.db.execute<{
      id: string;
      reference: string;
      partner_id: string;
      customer_profile_id: string;
      currency_id: string;
      currency_code: string;
      fx_rate_to_syp: string;
    }>(sql`
      SELECT b.id, b.reference, b.partner_id, b.customer_profile_id, b.currency_id,
             cur.code AS currency_code,
             b.fx_rate_to_syp::text AS fx_rate_to_syp
      FROM bookings b
      JOIN currencies cur ON cur.id = b.currency_id
      WHERE b.status = 'pending_confirmation'
        AND b.confirmation_deadline_at IS NOT NULL
        AND b.confirmation_deadline_at < now()
        AND b.deleted_at IS NULL
      -- Most overdue first, for the reason the reminder sweep above states and this one did not.
      --
      -- With no ORDER BY, which 100 the planner returns is undefined, so past a backlog of 100 a
      -- booking can be passed over sweep after sweep while others are cancelled — indefinitely,
      -- and silently, because the job reports success every time. This is the more consequential
      -- of the two: a reminder that arrives late is a worse experience, but a cancellation that
      -- never happens holds the customer's money and the unit's nights for ever.
      ORDER BY b.confirmation_deadline_at
      LIMIT 100
    `);

    if (due.rows.length === 0) return 0;

    let handled = 0;

    for (const booking of due.rows) {
      /**
       * Resolved PER BOOKING, in the booking's own currency (§2.1).
       *
       * Not hoisted out of the loop, and that is the fix rather than an oversight:
       * the fine is a configured amount in a configured currency, so two bookings in
       * different currencies need two different converted figures. Hoisting a single
       * number was what made the same offence cost a partner $10 or $14 depending on
       * where the property happened to be.
       */
      const fineAmount = await this.money.resolveOrFallback(
        'partner.first_violation_fine',
        '10.00',
        booking.currency_code,
      );
      const compensation = await this.money.resolveOrFallback(
        'wallet.sla_compensation',
        '10.00',
        booking.currency_code,
      );

      try {
        await this.db.transaction(async (tx) => {
          await tx.execute(sql`
            UPDATE bookings
            SET status = 'cancelled',
                cancelled_at = now(),
                cancellation_reason = 'system.partner_no_response'
            WHERE id = ${booking.id} AND status = 'pending_confirmation'
          `);

          /**
           * How many times this partner has done this. §6.4 escalates on repeat
           * offences, so the count is recorded even though the ladder itself is
           * configurable and applied by staff.
           */
          const priorRows = await tx.execute<{ count: string }>(sql`
            SELECT COUNT(*)::text AS count FROM partner_violations
            WHERE partner_id = ${booking.partner_id} AND kind = 'no_response'
          `);
          const occurrence = Number(priorRows.rows[0]?.count ?? 0) + 1;

          await tx.execute(sql`
            INSERT INTO partner_violations
              (partner_id, booking_id, kind, occurrence_number, fine_amount,
               fine_currency_id, customer_compensation_amount, score_penalty)
            VALUES (${booking.partner_id}, ${booking.id}, 'no_response', ${occurrence},
                    ${fineAmount}, ${booking.currency_id},
                    ${compensation}, 5)
          `);

          /**
           * P-007: the customer is compensated for the disappointment.
           *
           * Delegated to WalletService rather than done inline, and that is a fix
           * rather than a tidy-up. This block used to advance the balance with
           * `Number(balance) + compensation` — float arithmetic on money, in the
           * one codebase that computes every booking total in integer minor units
           * precisely to avoid it. It also credited the BOOKING's currency into a
           * wallet that may be denominated in another, adding JOD to a USD balance
           * as though they were the same number. The service converts through SYP
           * and locks the row, so neither is possible from any caller.
           */
          const movement = await this.wallet.credit(tx as unknown as Database, {
            customerProfileId: booking.customer_profile_id,
            amount: compensation,
            currencyId: booking.currency_id,
            reason: 'sla_compensation',
            bookingId: booking.id,
            note: WALLET_NOTE.PARTNER_NO_RESPONSE,
          });

          /*
            The score deduction is gone; `cancellation_count` STAYS. That split is the decision
            (Bashar, 2026-08-24), and it is a finer line than "remove the ranking effect".

            > *"Ranking should continue to be driven by measurable quality signals such as reviews,
            > booking performance, CANCELLATION RATES, response times, content completeness… but
            > creating a violation must not automatically modify ranking."*

            So the two writes that used to sit here are different things wearing the same shape:

            - `score - 5` was an ADMINISTRATIVE deduction. A number a policy decided, applied
              because a record was filed. Removed.
            - `cancellation_count + 1` is a MEASUREMENT. The booking really was cancelled; counting
              it is counting a fact about the business, and Bashar names cancellation rates as a
              legitimate quality signal by hand. It stays, and it would stay even if violations did
              not exist — the count is of cancellations, not of violations.

            The old comment cited §8.5 to argue that a missed SLA "must actually cost the partner
            visibility". It still does, through the measured cancellation rate rather than through
            a punishment attached to the record.
          */
          await tx.execute(sql`
            UPDATE partners
            SET cancellation_count = cancellation_count + 1
            WHERE id = ${booking.partner_id}
          `);

          /**
           * The fine and the compensation are two legs of one movement (§13.3): the
           * partner owes it, the customer's wallet receives it. Posting it keeps the
           * books balanced — a wallet credit with no matching debit would mean money
           * appearing from nowhere.
           *
           * Denominated in the BOOKING's currency, which is what the partner is
           * fined in, even when the customer's wallet holds another. That is not a
           * mismatch: `ledger_entries` balances in SYP (see the constraint trigger),
           * so the pair reconciles in the accounting currency, which is the only one
           * both sides of a cross-currency movement share.
           */
          await this.ledger.postPartnerFine(tx as unknown as Database, {
            bookingId: booking.id,
            partnerId: booking.partner_id,
            customerProfileId: booking.customer_profile_id,
            currencyId: booking.currency_id,
            fxRateToSyp: booking.fx_rate_to_syp,
            amount: compensation,
            reference: booking.reference,
          });

          /**
           * What actually landed, not what was configured. When the wallet is
           * denominated differently from the booking these differ, and a customer
           * asking why they were credited $14.46 for a 10.000 JOD booking needs the
           * answer to be on the record rather than inferred from two FX rates.
           */
          const outcome = {
            occurrence,
            fine: fineAmount,
            compensation,
            /*
              The BOOKING's currency, for the two figures above it.

              Without this they rendered bare, or — before the payload renderer paired each amount
              with its own currency — wearing `creditedCurrency`, which is the WALLET's. «الغرامة
              10.000 USD» for a fine of 10.000 JOD is not a smaller version of the right answer.
            */
            currency: booking.currency_code,
            creditedAmount: movement.appliedAmount,
            creditedCurrency: movement.currencyCode,
            walletBalance: movement.balance,
            walletCurrency: movement.currencyCode,
          };

          await tx.execute(sql`
            INSERT INTO timeline_events (subject_type, subject_id, event_type, actor_type, payload)
            VALUES ('booking', ${booking.id}, 'booking.sla_expired', 'system',
                    ${JSON.stringify(outcome)}::jsonb)
          `);

          await tx.execute(sql`
            INSERT INTO audit_log (action, subject_type, subject_id, after)
            VALUES ('booking.sla_expired', 'booking', ${booking.id},
                    ${JSON.stringify({ reference: booking.reference, ...outcome })}::jsonb)
          `);
        });

        handled += 1;

        /*
          The customer is told, AFTER the transaction has committed.

          Outside it deliberately: the cancellation, the fine and the compensation are all recorded
          by now, and a mail server that hangs must not hold that transaction open or roll it back.
          The same ordering `notifyPartnerOfPendingBooking` uses, for the same reason.
        */
        await this.tellTheCustomer(booking, compensation);
      } catch (error) {
        // One booking failing must not abandon the rest of the batch.
        this.logger.error(
          `Failed to expire booking ${booking.reference}: ${describeError(error)}`,
        );
      }
    }

    return handled;
  }

  /**
   * «أُلغي حجزك» — §6.4 and §10.3, and until 2026-08-25 this did not happen at all.
   *
   * ## What the customer used to experience
   *
   * Their paid booking was cancelled, a fine was recorded against the partner, compensation landed
   * in their wallet and — since the refund sweep — their money started coming back. **They were
   * sent nothing.** The first they could learn of any of it was opening the app and finding the
   * stay gone. Found by the final booking SRS audit.
   *
   * ## Swallowed, and that is not the same as ignored
   *
   * The booking is already cancelled and the money has already moved. Throwing here would fail the
   * sweep for a booking whose work is done, and the next pass would find nothing to redo. A notice
   * that cannot be sent becomes a `notifications` row for the re-drive sweep, which is the recovery
   * path that exists for exactly this.
   */
  private async tellTheCustomer(
    booking: { id: string; reference: string; currency_code: string },
    compensation: string,
  ): Promise<void> {
    try {
      const rows = await this.db.execute<{
        email: string | null;
        locale: string | null;
        property: string | null;
        check_in: string;
        check_out: string;
        total_amount: string;
        customer_profile_id: string;
      }>(sql`
        SELECT cp.email, u.preferred_locale AS locale,
               coalesce(pr.name_ar, pr.name_en) AS property,
               b.check_in::text, b.check_out::text,
               b.total_amount::text AS total_amount,
               b.customer_profile_id
        FROM bookings b
        JOIN customer_profiles cp ON cp.id = b.customer_profile_id
        JOIN properties pr        ON pr.id = b.property_id
        LEFT JOIN users u         ON u.id = cp.user_id
        WHERE b.id = ${booking.id}
        LIMIT 1
      `);

      const row = rows.rows[0];

      if (!row?.email) return;

      const locale = row.locale ?? 'ar';

      await this.notifications.notify(
        /*
          The key design handoff §8 already planned — «الإلغاء والاسترداد» — and which the console
          catalogue has carried, unused, since before this mail existed. Inventing a new one would
          have left a planned entry describing nothing and a sent entry nobody had named.
        */
        'booking.cancelled_refund',
        bookingCancelledBySafraMail({
          to: row.email,
          locale,
          reference: booking.reference,
          property: row.property ?? '',
          checkIn: row.check_in,
          checkOut: row.check_out,
          amount: row.total_amount,
          compensation,
          currency: booking.currency_code,
          /*
            §6.4's «يعرض عقارات مشابهة», in the form the customer can act on immediately: a search
            already filled in with the dates they wanted. The alternative the SRS describes is a
            telephone call from a member of staff, which is a promise this link does not depend on.
          */
          url:
            `${this.env.APP_URL}/${locale}/search` +
            `?checkIn=${row.check_in}&checkOut=${row.check_out}`,
        }),
        locale,
        { bookingId: booking.id, customerProfileId: row.customer_profile_id },
      );
    } catch (error: unknown) {
      this.logger.error(
        `Booking ${booking.reference} was cancelled but the customer could not be told: ` +
          `${describeError(error)}`,
      );
    }
  }
}
