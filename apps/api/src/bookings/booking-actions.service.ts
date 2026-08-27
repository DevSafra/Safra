import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';

import type { Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { ENV, type Env } from '../config/env.js';
import {
  bookingInvoiceMail,
  bookingConfirmedMail,
  bookingNeedsActionMail,
} from '../mail/mail.templates.js';
import { VoucherService } from './voucher.service.js';
import { describeError } from '../common/errors/safe-error.js';
import { NotificationService } from '../notifications/notification.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { MONEY_SCALE, toMinor } from '../common/money.js';
import { DATABASE } from '../database/database.module.js';
import { SettingsService } from '../settings/settings.service.js';
import { WalletService } from '../wallet/wallet.service.js';
import {
  canTransition,
  transitionLabel,
  type Actor,
  type BookingStatus,
} from './booking-state.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { ERROR, WALLET_NOTE } from '@safra/contracts';
import { assertCanWrite, scopeFilter } from '../rbac/scope.sql.js';
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
  private readonly logger = new Logger(BookingActionsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
    private readonly wallet: WalletService,
    private readonly notifications: NotificationService,
    @Inject(ENV) private readonly env: Env,
    /*
      `MailService` is GONE from here (2026-08-25).

      The confirmation was the only thing that used it, and it now goes through `notify` like every
      other message so it is recorded, linked to its booking, and re-drivable. A service that can
      still reach the transport directly is a service where the next message quietly skips the log.
    */
    private readonly vouchers: VoucherService,
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
    const booking = await this.load(reference, claims);

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
      discount_amount: string;
      wallet_amount: string;
      customer_fee_amount: string;
      partner_commission_amount: string;
      partner_payable_amount: string;
    }>(sql`
      SELECT id, partner_id, customer_profile_id, currency_id,
             fx_rate_to_syp::text AS fx_rate_to_syp,
             total_amount::text AS total_amount,
             discount_amount::text AS discount_amount,
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

    const result = await this.db.transaction(async (tx) => {
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
          /* What the coupon took off, so the group balances — see `postBookingPayment`. */
          discountAmount: amounts.discount_amount,
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

    /*
      The partner is told AFTER the money has moved and the transaction has committed.

      This is the notice `S-2` was about: a partner is fined and loses score for not answering
      within the window (§6.4), and until now the only way to learn a request existed was to be
      looking at the dashboard. Fining somebody for missing a message nobody sent them is not a
      rule, it is a trap.

      Sent outside the transaction on purpose — a mail server that hung would otherwise hold open a
      transaction that has just written ledger entries.
    */
    await this.notifyPartnerOfPendingBooking(booking.id);
    /* §10.3's «الفاتورة» — the receipt, owed the moment the money is captured. */
    await this.sendInvoice(booking.id);

    return result;
  }

  /**
   * «فاتورة حجزك» — §10.3, sent once the payment is captured.
   *
   * Swallowed on failure, outside the transaction, like every other notice here: the money is
   * already captured and the booking has already moved, and a mail server that is down must not
   * undo either. A notice that fails is a `notifications` row the re-drive sweep picks up.
   */
  private async sendInvoice(bookingId: string): Promise<void> {
    try {
      const rows = await this.db.execute<{
        email: string | null;
        locale: string | null;
        reference: string;
        property: string | null;
        total_amount: string;
        currency_code: string;
        customer_profile_id: string;
      }>(sql`
        SELECT cp.email, u.preferred_locale AS locale, b.reference,
               coalesce(pr.name_ar, pr.name_en) AS property,
               b.total_amount::text AS total_amount,
               cur.code AS currency_code, b.customer_profile_id
        FROM bookings b
        JOIN customer_profiles cp ON cp.id = b.customer_profile_id
        JOIN properties pr        ON pr.id = b.property_id
        JOIN currencies cur       ON cur.id = b.currency_id
        LEFT JOIN users u         ON u.id = cp.user_id
        WHERE b.id = ${bookingId}
        LIMIT 1
      `);

      const row = rows.rows[0];

      if (!row?.email) return;

      const locale = row.locale ?? 'ar';

      await this.notifications.notify(
        'booking.invoice',
        bookingInvoiceMail({
          to: row.email,
          locale,
          reference: row.reference,
          property: row.property ?? '',
          amount: row.total_amount,
          currency: row.currency_code,
          url: `${this.env.APP_URL}/${locale}/account/invoices/${encodeURIComponent(row.reference)}`,
        }),
        locale,
        { bookingId, customerProfileId: row.customer_profile_id },
      );
    } catch (error: unknown) {
      this.logger.error(`Invoice mail for ${bookingId} failed: ${describeError(error)}`);
    }
  }

  /**
   * Tells the partner a paid booking is waiting for their decision.
   *
   * The recipient is derived from the BOOKING's own partner, and the deadline from the row that
   * was just written — not from anything a caller passed in. A webhook cannot address this notice.
   *
   * Failure is contained by `NotificationService`: a booking that is paid and pending must not be
   * undone because an email bounced, and the failed attempt is recorded rather than thrown.
   */
  private async notifyPartnerOfPendingBooking(bookingId: string): Promise<void> {
    const found = await this.db.execute<{
      email: string | null;
      locale: string | null;
      partner_id: string;
      reference: string;
      property_name: string | null;
      check_in: string;
      check_out: string;
      deadline: string | null;
    }>(sql`
      SELECT u.email, u.preferred_locale AS locale, pa.id AS partner_id,
             b.reference, pr.name_ar AS property_name,
             b.check_in::text AS check_in, b.check_out::text AS check_out,
             to_char(b.confirmation_deadline_at AT TIME ZONE 'UTC',
                     'YYYY-MM-DD HH24:MI') AS deadline
      FROM bookings b
      JOIN partners pa   ON pa.id = b.partner_id
      JOIN users u       ON u.id = pa.user_id
      JOIN properties pr ON pr.id = b.property_id
      WHERE b.id = ${bookingId} AND u.status = 'active'
    `);

    const row = found.rows[0];

    if (!row?.email) return;

    await this.notifications.notify(
      'booking.needs_action',
      bookingNeedsActionMail({
        to: row.email,
        locale: row.locale ?? 'ar',
        reference: row.reference,
        property: row.property_name ?? '',
        checkIn: row.check_in,
        checkOut: row.check_out,
        deadline: row.deadline ?? '',
        url: `${this.env.PARTNER_URL}/`,
      }),
      row.locale ?? 'ar',
      { bookingId, partnerId: row.partner_id },
    );
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
    const booking = await this.load(reference, claims);

    // Ownership is part of the check, and a mismatch is 404 rather than 403 so a
    // partner cannot probe other partners' references.
    if (booking.partner_id !== partnerId) {
      throw notFound(ERROR.BOOKING_NOT_FOUND);
    }

    const target: BookingStatus = decision === 'confirm' ? 'confirmed' : 'cancelled';
    this.assertTransition(booking.status, target, 'partner');

    const result = await this.db.transaction(async (tx) => {
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
              cancellation_reason = ${reason ?? 'system.partner_rejected'}
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

        /*
          The score deduction that used to sit here is GONE (Bashar, 2026-08-24).

          > *"Violations must not directly affect ranking… creating a violation must not
          > automatically modify ranking. If ranking consequences are desired in the future, they
          > should be derived from objective platform metrics rather than administrative violation
          > records."*

          It deducted two points from `partners.score`, in this transaction, two
          lines below the violation insert — and `partners.score` is a ranking input, so recording
          a violation moved the listing down «SAFRA يوصي». That is precisely the coupling the rule
          forbids: an administrative record changing a placement.

          Nothing about the consequence is lost. The violation is still written, still escalates by
          `occurrence_number`, and can still lead to a warning, a fine or a suspension — which are
          the levers Bashar names. What it no longer does is quietly reprice visibility as a side
          effect of somebody filing a record.

          `violation-ranking.integration.test.ts` pins this. It is the kind of line somebody
          restores in good faith six months from now, because "a partner who does this should rank
          lower" is an intuitive thing to believe.
        */
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

    /*
      §6.3 step 6, AFTER the commit — «تؤكد سفرة الحجز وترسل Email وWhatsApp وVoucher وQR Code».

      Nothing sent this until 2026-08-25: the template was in the catalogue marked implemented and
      no code path called it, so a customer whose booking was confirmed found out by opening the
      site. Sent outside the transaction and swallowed on failure, exactly as the partner's
      needs-action notice is — a mail server must never roll back a confirmation.
    */
    if (decision === 'confirm') await this.sendConfirmation(reference);

    return result;
  }

  /**
   * The staff moves the transition table has always named and no route ever offered.
   *
   * ## Why one method and not four
   *
   * Confirming on the partner's behalf, checking a guest in, undoing that, and completing a stay
   * are the same operation with a different pair of states: guard the move, write the status and
   * its stamp inside one predicate, record a timeline event and an audit row. Four copies would be
   * four places for the predicate to drift, and the predicate is the safety — see below.
   *
   * ## The status is in the WHERE clause, never read-then-written
   *
   * `AND status = <from>` means two operators pressing at once cannot both succeed: the second
   * `UPDATE` matches no rows and answers a conflict. Reading the status, comparing it in TypeScript
   * and then writing would let both through, and the second would silently overwrite the first's
   * stamp. Lifted from `ArrivalsService`, which got this right for the partner side first.
   *
   * ## `assertTransition` as well, and it is not redundant
   *
   * The predicate stops a race; `assertTransition` gives the CALLER a truthful answer about why a
   * move was refused — «this booking is cancelled» rather than «nothing happened». Without it a
   * completed booking and a nonexistent one would be indistinguishable to the console.
   */
  private async move(
    reference: string,
    to: BookingStatus,
    stamps: SQL,
    action: string,
    claims: AccessTokenClaims | undefined,
    reason?: string,
  ): Promise<{ reference: string; status: BookingStatus }> {
    const booking = await this.load(reference, claims);

    this.assertTransition(booking.status, to, 'staff');

    return this.db.transaction(async (tx) => {
      const changed = await tx.execute<{ id: string }>(sql`
        UPDATE bookings
        SET status = ${to}::booking_status, ${stamps}, updated_at = now()
        WHERE id = ${booking.id} AND status = ${booking.status}::booking_status
        RETURNING id
      `);

      /*
        Nothing matched, so somebody else moved it between the load and the write. A conflict, not
        a 404: the booking is there and its state is no longer the one this decision was made
        against, and the operator needs to re-read the screen rather than think it vanished.
      */
      if (!changed.rows[0]) throw conflict(ERROR.BOOKING_TRANSITION_INVALID);

      await tx.execute(sql`
        INSERT INTO timeline_events (subject_type, subject_id, event_type, actor_type, actor_user_id, payload)
        VALUES ('booking', ${booking.id}, ${`booking.${transitionLabel(booking.status, to) ?? to}`},
                'staff', ${claims?.sub ?? null},
                ${JSON.stringify(reason ? { reason } : {})}::jsonb)
      `);

      await this.audit.record(
        {
          actorUserId: claims?.sub,
          actorRole: claims?.role,
          action,
          subjectType: 'booking',
          subjectId: booking.id,
          before: { status: booking.status },
          after: { status: to },
          ...(reason ? { reason } : {}),
        },
        tx as unknown as Database,
      );

      return { reference, status: to };
    });
  }

  /**
   * SAFRA confirms to the customer on the partner's behalf (§6.3 step 7).
   *
   * §6.3 puts SAFRA in the middle of the confirmation, which is why `pending_confirmation →
   * confirmed` names `staff` alongside `system` and has since the table was written. The route for
   * it did not exist: `partner-decision` requires `BOOKING_RESPOND_AS_PARTNER` and a partner id
   * from the token, so a support agent taking the partner's telephone call had no way to record
   * the answer they were just given.
   *
   * The reason is REQUIRED, and it is the whole difference between this and the partner's own
   * confirmation. A booking confirmed by SAFRA rather than by the business hosting it is an
   * exception, and an exception nobody can explain later is one nobody should be able to make.
   *
   * `confirmation_deadline_at` is cleared for the same reason `partnerDecision` clears it: the
   * window is answered, and leaving it set would keep the booking in the SLA sweep's sights and in
   * the dashboard's «تنتهي مهلتها قريباً» count.
   */
  async staffConfirm(
    reference: string,
    reason: string,
    claims: AccessTokenClaims | undefined,
  ) {
    const moved = await this.move(
      reference,
      'confirmed',
      sql`partner_responded_at = now(), confirmed_at = now(),
          confirmed_by_user_id = ${claims?.sub ?? null},
          confirmation_deadline_at = NULL`,
      'booking.staff_confirmed',
      claims,
      reason,
    );

    /*
      The customer gets the same message whether the partner confirmed or SAFRA did on their behalf.

      §6.3 step 6 describes the OUTCOME — the booking is confirmed and the customer is told, with a
      voucher. Who pressed the button is an internal distinction, and sending a different message
      for it would leak an operational detail the customer has no use for.
    */
    await this.sendConfirmation(reference);

    return moved;
  }

  /**
   * The confirmation, its voucher and its QR — §6.3 step 6.
   *
   * ## Swallowed, always
   *
   * The booking IS confirmed by the time this runs; the transaction has committed. A mail server
   * that is down, or a PDF render that times out, must not turn a confirmed stay into an error the
   * partner sees — they would press again, and the second press meets a booking that has already
   * moved. Logged instead, and `notification-redrive` is the recovery path for the notice.
   */
  private async sendConfirmation(reference: string): Promise<void> {
    try {
      /*
        Through `notify`, not `mail.send` — corrected by the final booking audit (2026-08-25).

        It sent directly, which meant §6.3 step 6's confirmation — the one carrying the voucher and
        the QR — wrote NO `notifications` row. Three consequences, none of them visible from the
        code that sent it: §10.3 requires every mail to be linked to its booking on the timeline and
        this one was not; سجل واتساب والبريد showed the most important message the platform sends as
        having never been sent; and a failure could not be re-driven, because the re-drive sweep
        reads exactly the rows this path did not write.
      */
      const rows = await this.db.execute<{
        id: string;
        customer_profile_id: string;
        email: string;
        property: string;
        check_in: string;
        check_out: string;
        locale: string | null;
      }>(sql`
        SELECT cp.email, coalesce(pr.name_ar, pr.name_en) AS property,
               b.check_in::text AS check_in, b.check_out::text AS check_out,
               u.preferred_locale AS locale,
               b.id, b.customer_profile_id
        FROM bookings b
        JOIN customer_profiles cp ON cp.id = b.customer_profile_id
        JOIN properties pr        ON pr.id = b.property_id
        LEFT JOIN users u         ON u.id = cp.user_id
        WHERE b.reference = ${reference}
      `);

      const row = rows.rows[0];

      if (!row) return;

      const { pdf } = await this.vouchers.pdf(reference);

      await this.notifications.notify(
        'booking.confirmed',
        bookingConfirmedMail({
          to: row.email,
          reference,
          property: row.property,
          checkIn: row.check_in,
          checkOut: row.check_out,
          locale: row.locale ?? 'ar',
          voucher: pdf,
        }),
        row.locale ?? 'ar',
        { bookingId: row.id, customerProfileId: row.customer_profile_id },
      );
    } catch (error) {
      /* The reference, never the address — a log line is where PII leaks without a decision. */
      this.logger.error(
        `Confirmation mail for ${reference} failed: ${describeError(error)}`,
      );
    }
  }

  /**
   * Staff record that a guest arrived, for a partner who cannot.
   *
   * The partner's own `ArrivalsService` is the ordinary path and stays it. This is the exception —
   * a partner without the portal to hand, or a front desk that phoned it in — and it differs in
   * exactly one way: there is no `partner_id` in the predicate, because staff are not acting for
   * one business. That is the whole reason it cannot simply reuse the partner method.
   */
  async staffCheckIn(reference: string, claims: AccessTokenClaims | undefined) {
    return this.move(
      reference,
      'checked_in',
      sql`checked_in_at = now()`,
      'booking.checked_in',
      claims,
    );
  }

  /** Undoes it, bounded the same way — `checked_in` is in the predicate, so this cannot reach into `completed`. */
  async staffUndoCheckIn(reference: string, claims: AccessTokenClaims | undefined) {
    return this.move(
      reference,
      'confirmed',
      sql`checked_in_at = NULL`,
      'booking.check_in_undone',
      claims,
    );
  }

  /**
   * The stay is over (§6.3's last step), and this is what a partner gets paid for.
   *
   * ## Nothing could reach this state before 2026-08-25
   *
   * `checked_in → completed` names `system` and `staff` and **neither had a writer** — no route, no
   * scheduled job. The 1,247 completed bookings in the dev database are all seed rows, written
   * directly. That mattered far beyond this screen: `payout.service` accrues over
   * `b.status = 'completed'` and `review.service` refuses a review on anything else, so on a real
   * deployment no partner would ever have been paid and no customer could ever have left a review.
   * `StayCompletionService` is the ordinary path; this is the manual one.
   */
  async staffComplete(reference: string, claims: AccessTokenClaims | undefined) {
    return this.move(
      reference,
      'completed',
      sql`completed_at = now()`,
      'booking.completed',
      claims,
    );
  }

  /** Customer or staff cancellation of a live booking. */
  async cancel(
    reference: string,
    reason: string,
    actor: Actor,
    claims: AccessTokenClaims | undefined,
  ) {
    const booking = await this.load(reference, claims);
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
        await this.releaseWalletHold(tx as unknown as Database, booking.id);
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
  private async releaseWalletHold(tx: Database, bookingId: string): Promise<void> {
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
      note: WALLET_NOTE.RETURNED_CANCELLED,
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

  /**
   * The booking an action names, IF this caller is scoped to reach it.
   *
   * ## The gap this closes (`O-sec-13`, 2026-08-27)
   *
   * Every staff transition on a booking — capture the payment, confirm on the partner's behalf,
   * check in, undo a check-in, complete, cancel — arrives here by REFERENCE, and this returned the
   * row for `reference = $1` and nothing else. `claims` was used to stamp `cancelled_by_user_id`
   * and to write the audit row. So an operations manager scoped to one city could cancel or
   * complete any booking in the country, and references are sequential.
   *
   * `bookings` has been in `SCOPED_RESOURCES` since scope was built. The registry and the detail
   * screen were scoped; the ACTIONS were not, which is the same «the predicate looked like it
   * covered everything» that hid the detail screen until the day before.
   *
   * ## A partner is unaffected
   *
   * `partnerDecision` reaches this too, and a partner's claims carry no `scope` — `scopeOf` answers
   * `UNSCOPED`, `isRestricted` is false, and the predicate folds to TRUE at plan time. Their own
   * boundary is `requirePartnerId`, one layer up, and it is untouched.
   *
   * The predicate here, `assertCanWrite` at each call site: the predicate so a `none` member cannot
   * tell an out-of-scope booking from an absent one, the assertion so a `read_only` member who may
   * legitimately LOOK cannot act.
   */
  private async load(reference: string, claims: AccessTokenClaims | undefined) {
    const rows = await this.db.execute<{
      id: string;
      status: BookingStatus;
      partner_id: string;
      city_id: string | null;
    }>(sql`
      SELECT id, status::text AS status, partner_id, city_id::text AS city_id
      FROM bookings
      WHERE reference = ${reference} AND deleted_at IS NULL
        AND ${scopeFilter(claims, 'city_id')}
      LIMIT 1
    `);

    const booking = rows.rows[0];
    if (!booking) throw notFound(ERROR.BOOKING_NOT_FOUND);

    assertCanWrite(claims, booking.city_id);

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
