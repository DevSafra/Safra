import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { MONEY_SCALE, toMinor } from '../common/money.js';
import { DATABASE } from '../database/database.module.js';
import { SettingsService } from '../settings/settings.service.js';
import { WalletService } from '../wallet/wallet.service.js';
import { canTransition, type Actor, type BookingStatus } from './booking-state.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { ERROR } from '@safra/contracts';
import { notFound } from '../common/errors/app-error.js';
import { conflict } from '../common/errors/app-error.js';

/**
 * State transitions on an existing booking (§6.3 steps 5–8, §6.4).
 *
 * Every change goes through `transition()`, which consults the state machine before
 * touching a row. A guard in one place beats the same `if` repeated per endpoint,
 * and it means an illegal move returns 409 rather than silently corrupting a
 * booking's history.
 */
@Injectable()
export class BookingActionsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
    private readonly wallet: WalletService,
  ) {}

  /**
   * Marks payment captured and starts the partner's clock (§6.3 step 5).
   *
   * Called by the payment webhook once a gateway is integrated. Exposed as a service
   * method now so the booking lifecycle is complete and testable without one.
   */
  async markPaid(
    reference: string,
    claims: AccessTokenClaims | undefined,
    paymentId?: string,
  ) {
    const booking = await this.load(reference);

    this.assertTransition(booking.status, 'pending_confirmation', 'system');

    // Every figure needed for the ledger legs, read from the booking's own snapshots
    // rather than recomputed — the rates may have changed since it was created.
    const money = await this.db.execute<{
      id: string;
      partner_id: string;
      customer_profile_id: string;
      currency_id: string;
      fx_rate_to_syp: string;
      total_amount: string;
      wallet_amount: string;
      customer_fee_amount: string;
      partner_commission_amount: string;
      partner_payable_amount: string;
    }>(sql`
      SELECT id, partner_id, customer_profile_id, currency_id,
             fx_rate_to_syp::text AS fx_rate_to_syp,
             total_amount::text AS total_amount,
             wallet_amount::text AS wallet_amount,
             customer_fee_amount::text AS customer_fee_amount,
             partner_commission_amount::text AS partner_commission_amount,
             partner_payable_amount::text AS partner_payable_amount
      FROM bookings WHERE id = ${booking.id}
    `);

    const amounts = money.rows[0];
    if (!amounts) throw notFound(ERROR.BOOKING_NOT_FOUND);

    const windowMinutes = await this.settings.getNumber(
      'booking.confirmation_window_minutes',
      120,
    );

    return this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE bookings
        SET status = 'pending_confirmation',
            paid_at = now(),
            -- The deadline is reset here: until now it held the payment window
            -- (EC-001), and from now it holds the partner's window (§6.4).
            confirmation_deadline_at = now() + (${windowMinutes}::int * INTERVAL '1 minute')
        WHERE id = ${booking.id} AND status = 'pending_payment'
      `);

      await tx.execute(sql`
        INSERT INTO timeline_events (subject_type, subject_id, event_type, actor_type)
        VALUES ('booking', ${booking.id}, 'booking.payment_captured', 'system')
      `);

      /**
       * Two callers, two shapes.
       *
       * A webhook already has a payment row — the one the customer paid against —
       * so it passes the id and this only marks it captured. Inserting a second row
       * there would leave the real attempt permanently "requires_action" and make
       * refunds route through a payment that never took money.
       *
       * The staff simulate-capture path has no row, so one is created to satisfy
       * the ledger's payment_id foreign key.
       */
      const payment =
        paymentId ??
        (await this.createInternalPayment(
          tx as unknown as Database,
          booking.id,
          amounts,
        ));

      if (paymentId) {
        await tx.execute(sql`
          UPDATE payments
          SET status = 'captured'::payment_status, captured_at = now(), updated_at = now()
          WHERE id = ${paymentId}
        `);
      }

      /**
       * §13.3: the money is recorded the moment it is captured, in the SAME
       * transaction as the status change. A ledger entry that outlived a rolled-back
       * capture would show revenue that never arrived.
       */
      const { entryGroupId } = await this.ledger.postBookingPayment(
        tx as unknown as Database,
        {
          id: amounts.id,
          partnerId: amounts.partner_id,
          customerProfileId: amounts.customer_profile_id,
          currencyId: amounts.currency_id,
          fxRateToSyp: amounts.fx_rate_to_syp,
          totalAmount: amounts.total_amount,
          // Splits the debit side; the wallet was already debited when the hold was
          // taken at payment start, so this records where the money came from
          // rather than moving it.
          walletAmount: amounts.wallet_amount,
          customerFeeAmount: amounts.customer_fee_amount,
          partnerCommissionAmount: amounts.partner_commission_amount,
          partnerPayableAmount: amounts.partner_payable_amount,
          reference,
        },
        payment,
        claims?.sub,
      );

      await this.audit.record(
        {
          actorUserId: claims?.sub,
          actorRole: claims?.role,
          action: 'booking.payment_captured',
          subjectType: 'booking',
          subjectId: booking.id,
          before: { status: booking.status },
          after: {
            status: 'pending_confirmation',
            confirmationWindowMinutes: windowMinutes,
            ledgerEntryGroup: entryGroupId,
          },
        },
        tx as unknown as Database,
      );

      return {
        reference,
        status: 'pending_confirmation' as const,
        ledgerEntryGroup: entryGroupId,
      };
    });
  }

  /**
   * Simulates capture, for exercising the lifecycle before a gateway exists.
   *
   * Deliberately staff-gated and separate from markPaid so that when a real webhook
   * arrives it calls markPaid directly and this stays a testing affordance rather
   * than becoming a way to mark bookings paid without money.
   */
  async simulateCapture(reference: string, claims: AccessTokenClaims | undefined) {
    return this.markPaid(reference, claims);
  }

  /**
   * The partner answering within the window (§6.4).
   *
   * A confirmation moves straight to `confirmed`: §6.3 step 7 has SAFRA confirm to
   * the customer as soon as the partner approves, so there is no intermediate state
   * for a booking to get stuck in.
   */
  async partnerDecision(
    reference: string,
    partnerId: string,
    decision: 'confirm' | 'reject',
    reason: string | undefined,
    claims: AccessTokenClaims | undefined,
  ) {
    const booking = await this.load(reference);

    // Ownership is part of the check, and a mismatch is 404 rather than 403 so a
    // partner cannot probe other partners' references.
    if (booking.partner_id !== partnerId) {
      throw notFound(ERROR.BOOKING_NOT_FOUND);
    }

    const target: BookingStatus = decision === 'confirm' ? 'confirmed' : 'cancelled';
    this.assertTransition(booking.status, target, 'partner');

    return this.db.transaction(async (tx) => {
      if (decision === 'confirm') {
        await tx.execute(sql`
          UPDATE bookings
          SET status = 'confirmed',
              partner_responded_at = now(),
              confirmed_at = now(),
              confirmed_by_user_id = ${claims?.sub ?? null},
              confirmation_deadline_at = NULL
          WHERE id = ${booking.id} AND status = 'pending_confirmation'
        `);

        /**
         * Answering promptly is rewarded, because §5.5 ranks on response speed.
         * A simple running average: enough to move the ranking, and replaced by a
         * proper rolling window when the reporting module lands.
         */
        await tx.execute(sql`
          UPDATE partners
          SET avg_response_minutes = COALESCE(
                (avg_response_minutes + GREATEST(1, EXTRACT(EPOCH FROM (now() - b.paid_at)) / 60)) / 2,
                GREATEST(1, EXTRACT(EPOCH FROM (now() - b.paid_at)) / 60)
              )::int
          FROM bookings b
          WHERE partners.id = ${partnerId} AND b.id = ${booking.id} AND b.paid_at IS NOT NULL
        `);
      } else {
        await tx.execute(sql`
          UPDATE bookings
          SET status = 'cancelled',
              partner_responded_at = now(),
              cancelled_at = now(),
              cancellation_reason = ${reason ?? 'Rejected by partner.'}
          WHERE id = ${booking.id} AND status = 'pending_confirmation'
        `);

        /**
         * §6.4 treats a rejection AFTER payment as a violation too — the customer
         * paid on the strength of availability the partner advertised. The fine is
         * lighter than for silence, because at least they answered.
         */
        const priorRows = await tx.execute<{ count: string }>(sql`
          SELECT COUNT(*)::text AS count FROM partner_violations
          WHERE partner_id = ${partnerId} AND kind = 'rejected_after_payment'
        `);

        await tx.execute(sql`
          INSERT INTO partner_violations
            (partner_id, booking_id, kind, occurrence_number, score_penalty)
          VALUES (${partnerId}, ${booking.id}, 'rejected_after_payment',
                  ${Number(priorRows.rows[0]?.count ?? 0) + 1}, 2)
        `);

        await tx.execute(sql`
          UPDATE partners SET score = GREATEST(0, score - 2) WHERE id = ${partnerId}
        `);
      }

      await tx.execute(sql`
        INSERT INTO timeline_events (subject_type, subject_id, event_type, actor_type, actor_user_id, payload)
        VALUES ('booking', ${booking.id},
                ${decision === 'confirm' ? 'booking.confirmed' : 'booking.rejected_by_partner'},
                'partner', ${claims?.sub ?? null},
                ${JSON.stringify({ reason: reason ?? null })}::jsonb)
      `);

      await this.audit.record(
        {
          actorUserId: claims?.sub,
          actorRole: claims?.role,
          action: decision === 'confirm' ? 'booking.confirmed' : 'booking.rejected',
          subjectType: 'booking',
          subjectId: booking.id,
          before: { status: booking.status },
          after: { status: target },
          reason: reason ?? null,
        },
        tx as unknown as Database,
      );

      return { reference, status: target };
    });
  }

  /** Customer or staff cancellation of a live booking. */
  async cancel(
    reference: string,
    reason: string,
    actor: Actor,
    claims: AccessTokenClaims | undefined,
  ) {
    const booking = await this.load(reference);
    this.assertTransition(booking.status, 'cancelled', actor);

    return this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE bookings
        SET status = 'cancelled',
            cancelled_at = now(),
            cancelled_by_user_id = ${claims?.sub ?? null},
            cancellation_reason = ${reason}
        WHERE id = ${booking.id}
      `);

      /**
       * Stored value held against an UNPAID booking goes straight back (§7.3).
       *
       * Only from `pending_payment`: after capture the hold has become part of a
       * settled payment, and returning it here would refund outside the
       * cancellation policy and without a `refunds` row — RefundService owns that
       * path and applies §7.4's tiers to it.
       */
      if (booking.status === 'pending_payment') {
        await this.releaseWalletHold(tx as unknown as Database, booking.id, reference);
      }

      await tx.execute(sql`
        INSERT INTO timeline_events (subject_type, subject_id, event_type, actor_type, actor_user_id, payload)
        VALUES ('booking', ${booking.id}, 'booking.cancelled', ${actor},
                ${claims?.sub ?? null}, ${JSON.stringify({ reason })}::jsonb)
      `);

      await this.audit.record(
        {
          actorUserId: claims?.sub,
          actorRole: claims?.role,
          action: 'booking.cancelled',
          subjectType: 'booking',
          subjectId: booking.id,
          before: { status: booking.status },
          after: { status: 'cancelled' },
          reason,
        },
        tx as unknown as Database,
      );

      // Refund arithmetic against the snapshotted policy lands with the payment
      // module — there is no captured payment to refund until a gateway exists.
      return { reference, status: 'cancelled' as const, refundPending: true };
    });
  }

  /**
   * Returns any stored value held against a booking being cancelled before payment.
   *
   * Reads the amount inside the caller's transaction rather than taking it as an
   * argument, so it cannot be handed a figure that has already gone stale.
   */
  private async releaseWalletHold(
    tx: Database,
    bookingId: string,
    reference: string,
  ): Promise<void> {
    const rows = await tx.execute<{
      wallet_amount: string;
      customer_profile_id: string;
      currency_id: string;
    }>(sql`
      SELECT wallet_amount::text AS wallet_amount, customer_profile_id, currency_id
      FROM bookings WHERE id = ${bookingId}
    `);

    const held = rows.rows[0];
    if (!held || toMinor(held.wallet_amount, MONEY_SCALE) <= 0n) return;

    await this.wallet.credit(tx, {
      customerProfileId: held.customer_profile_id,
      amount: held.wallet_amount,
      currencyId: held.currency_id,
      reason: 'refund',
      bookingId,
      note: `Balance returned — ${reference} was cancelled before payment.`,
    });

    await tx.execute(sql`
      UPDATE bookings SET wallet_amount = 0, updated_at = now() WHERE id = ${bookingId}
    `);
  }

  /**
   * A payment row for a capture that had no gateway behind it.
   *
   * `provider = 'internal'` is what marks it as such, so a later reconciliation can
   * tell staff-simulated money from money an acquirer actually settled.
   */
  private async createInternalPayment(
    tx: Database,
    bookingId: string,
    amounts: { total_amount: string; currency_id: string },
  ): Promise<string> {
    const created = await tx.execute<{ id: string }>(sql`
      INSERT INTO payments
        (booking_id, method, provider, amount, currency_id, status, captured_at)
      VALUES (${bookingId}, 'wallet'::payment_method, 'internal',
              ${amounts.total_amount}, ${amounts.currency_id},
              'captured'::payment_status, now())
      RETURNING id
    `);

    const id = created.rows[0]?.id;
    if (!id) throw new Error('Payment insert returned no row.');

    return id;
  }

  private async load(reference: string) {
    const rows = await this.db.execute<{
      id: string;
      status: BookingStatus;
      partner_id: string;
    }>(sql`
      SELECT id, status::text AS status, partner_id
      FROM bookings
      WHERE reference = ${reference} AND deleted_at IS NULL
      LIMIT 1
    `);

    const booking = rows.rows[0];
    if (!booking) throw notFound(ERROR.BOOKING_NOT_FOUND);

    return booking;
  }

  private assertTransition(from: BookingStatus, to: BookingStatus, actor: Actor): void {
    if (!canTransition(from, to, actor)) {
      /*
        The states are NOT named to the client any more. `from`/`to` are enum identifiers and
        the actor is an internal role — all three go to the log via the thrown code, and none of
        them tells a customer anything they can act on.
      */
      throw conflict(ERROR.BOOKING_TRANSITION_INVALID);
    }
  }
}
