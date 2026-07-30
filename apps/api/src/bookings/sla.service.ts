import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';

import { DATABASE } from '../database/database.module.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { SettingsService } from '../settings/settings.service.js';

/** Distinct advisory-lock key per job; see RankingScheduler for the rationale. */
const SLA_LOCK_KEY = 8_421_002;

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
    private readonly settings: SettingsService,
    private readonly ledger: LedgerService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'booking-sla-sweep' })
  async sweep(): Promise<void> {
    const acquired = await this.db.execute<{ locked: boolean }>(
      sql`SELECT pg_try_advisory_lock(${SLA_LOCK_KEY}) AS locked`,
    );

    if (acquired.rows[0]?.locked !== true) {
      // Another replica is sweeping. Skipping is correct — the work is not lost.
      return;
    }

    try {
      const expiredPayments = await this.expireUnpaidBookings();
      const expiredConfirmations = await this.expireUnconfirmedBookings();

      if (expiredPayments > 0 || expiredConfirmations > 0) {
        this.logger.log(
          `SLA sweep: ${expiredPayments} unpaid expired, ${expiredConfirmations} unconfirmed expired.`,
        );
      }
    } catch (error) {
      // Never throw from a scheduled job: an unhandled rejection kills the process,
      // and a failed sweep must not take the API down. The next minute retries.
      this.logger.error(
        `SLA sweep failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      await this.db.execute(sql`SELECT pg_advisory_unlock(${SLA_LOCK_KEY})`);
    }
  }

  /**
   * EC-001 — abandoned checkout.
   *
   * Cancelling frees the dates immediately, because `cancelled` is outside the
   * exclusion constraint's predicate. No compensation and no fine: nobody is at
   * fault when a customer simply closes the tab.
   */
  private async expireUnpaidBookings(): Promise<number> {
    const result = await this.db.execute<{ id: string; reference: string }>(sql`
      WITH expired AS (
        UPDATE bookings
        SET status = 'cancelled',
            cancelled_at = now(),
            cancellation_reason = 'Payment not completed within the allowed window (EC-001).'
        WHERE status = 'pending_payment'
          AND confirmation_deadline_at IS NOT NULL
          AND confirmation_deadline_at < now()
          AND deleted_at IS NULL
        RETURNING id, reference
      )
      SELECT id, reference FROM expired
    `);

    for (const booking of result.rows) {
      await this.db.execute(sql`
        INSERT INTO timeline_events (subject_type, subject_id, event_type, actor_type, payload)
        VALUES ('booking', ${booking.id}, 'booking.payment_expired', 'system',
                ${JSON.stringify({ reason: 'EC-001' })}::jsonb)
      `);
    }

    return result.rows.length;
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
      fx_rate_to_syp: string;
    }>(sql`
      SELECT id, reference, partner_id, customer_profile_id, currency_id,
             fx_rate_to_syp::text AS fx_rate_to_syp
      FROM bookings
      WHERE status = 'pending_confirmation'
        AND confirmation_deadline_at IS NOT NULL
        AND confirmation_deadline_at < now()
        AND deleted_at IS NULL
      LIMIT 100
    `);

    if (due.rows.length === 0) return 0;

    const fineAmount = await this.settings.getNumber('partner.first_violation_fine', 10);
    const compensation = await this.settings.getNumber('wallet.sla_compensation', 10);

    let handled = 0;

    for (const booking of due.rows) {
      try {
        await this.db.transaction(async (tx) => {
          await tx.execute(sql`
            UPDATE bookings
            SET status = 'cancelled',
                cancelled_at = now(),
                cancellation_reason = 'Partner did not respond within the confirmation window (§6.4).'
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
                    ${fineAmount.toFixed(2)}, ${booking.currency_id},
                    ${compensation.toFixed(2)}, 5)
          `);

          // P-007: the customer is compensated for the disappointment.
          const walletRows = await tx.execute<{ id: string; balance: string }>(sql`
            SELECT id, balance::text AS balance FROM wallets
            WHERE customer_profile_id = ${booking.customer_profile_id}
              AND deleted_at IS NULL
            LIMIT 1
          `);

          let walletId = walletRows.rows[0]?.id;
          let balance = walletRows.rows[0]?.balance ?? '0';

          if (!walletId) {
            // A guest booking has no wallet yet; compensation still has to land.
            const created = await tx.execute<{ id: string }>(sql`
              INSERT INTO wallets (customer_profile_id, balance, currency_id)
              VALUES (${booking.customer_profile_id}, 0, ${booking.currency_id})
              RETURNING id
            `);
            walletId = created.rows[0]?.id;
            balance = '0';
          }

          if (walletId) {
            const newBalance = (Number(balance) + compensation).toFixed(2);

            await tx.execute(sql`
              UPDATE wallets SET balance = ${newBalance} WHERE id = ${walletId}
            `);

            await tx.execute(sql`
              INSERT INTO wallet_transactions
                (wallet_id, direction, reason, amount, currency_id, balance_after, booking_id, note)
              VALUES (${walletId}, 'credit', 'sla_compensation', ${compensation.toFixed(2)},
                      ${booking.currency_id}, ${newBalance}, ${booking.id},
                      'Partner did not respond within the confirmation window.')
            `);
          }

          // §8.5: the internal score drives "SAFRA recommends", so a missed SLA
          // must actually cost the partner visibility.
          await tx.execute(sql`
            UPDATE partners
            SET score = GREATEST(0, score - 5),
                cancellation_count = cancellation_count + 1
            WHERE id = ${booking.partner_id}
          `);

          /**
           * The fine and the compensation are two legs of one movement (§13.3): the
           * partner owes it, the customer's wallet receives it. Posting it keeps the
           * books balanced — a wallet credit with no matching debit would mean money
           * appearing from nowhere.
           */
          await this.ledger.postPartnerFine(tx as unknown as Database, {
            bookingId: booking.id,
            partnerId: booking.partner_id,
            customerProfileId: booking.customer_profile_id,
            currencyId: booking.currency_id,
            fxRateToSyp: booking.fx_rate_to_syp,
            amount: compensation.toFixed(2),
            reference: booking.reference,
          });

          await tx.execute(sql`
            INSERT INTO timeline_events (subject_type, subject_id, event_type, actor_type, payload)
            VALUES ('booking', ${booking.id}, 'booking.sla_expired', 'system',
                    ${JSON.stringify({
                      occurrence,
                      fine: fineAmount,
                      compensation,
                    })}::jsonb)
          `);

          await tx.execute(sql`
            INSERT INTO audit_log (action, subject_type, subject_id, after)
            VALUES ('booking.sla_expired', 'booking', ${booking.id},
                    ${JSON.stringify({
                      reference: booking.reference,
                      occurrence,
                      fine: fineAmount,
                      compensation,
                    })}::jsonb)
          `);
        });

        handled += 1;
      } catch (error) {
        // One booking failing must not abandon the rest of the batch.
        this.logger.error(
          `Failed to expire booking ${booking.reference}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return handled;
  }
}
