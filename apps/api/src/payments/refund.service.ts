import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { LedgerService, type LedgerLeg } from '../ledger/ledger.service.js';
import { MONEY_SCALE, applyRate, fromMinor, toMinor } from '../common/money.js';
import { WalletService } from '../wallet/wallet.service.js';
import { NotificationService } from '../notifications/notification.service.js';
import { bookingRefundedMail } from '../mail/mail.templates.js';
import { ENV, type Env } from '../config/env.js';
import { describeError } from '../common/errors/safe-error.js';
import { PaymentProviderRegistry } from './providers/provider.registry.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { ERROR } from '@safra/contracts';
import { badRequest, conflict, notFound } from '../common/errors/app-error.js';

/** The shape snapshotted onto the booking at creation. */
interface PolicySnapshot {
  code?: string;
  tiers?: { hoursBeforeCheckIn: number; refundPercent: number }[];
  minRefundPercent?: number;
}

export interface RefundQuote {
  readonly refundPercent: number;
  readonly refundAmount: string;
  readonly currencyCode: string;
  /** Of `refundAmount`, how much goes back to the wallet (§7.3). */
  readonly walletAmount: string;
  /** Of `refundAmount`, how much goes back out through the gateway. */
  readonly providerAmount: string;
  readonly hoursBeforeCheckIn: number;
  readonly tierApplied: string;
  readonly alreadyRefunded: string;
  readonly refundable: string;
}

/**
 * Refunds against the policy the customer actually agreed to (SRS §7.4).
 *
 * The policy is read from `bookings.cancellation_policy_snapshot`, never from the
 * live policy row. A partner who tightens their terms after a booking must not
 * thereby reduce a refund already owed — that is the entire reason the snapshot
 * exists, and reading the current policy here would silently defeat it.
 *
 * Refunds route back through the provider that took the money (`payments.provider`),
 * which is why routing is not consulted: sending a refund out through a different
 * rail would leave the original charge unreconciled and, for a card payment, invite
 * a chargeback on money SAFRA has already returned by other means.
 */
@Injectable()
export class RefundService {
  private readonly logger = new Logger(RefundService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly registry: PaymentProviderRegistry,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly wallet: WalletService,
    private readonly notifications: NotificationService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * What would be refunded, without refunding it.
   *
   * Separate from `execute` so support staff and the customer-facing cancellation
   * screen can show a figure before anyone commits to it.
   */
  async quote(reference: string): Promise<RefundQuote> {
    const booking = await this.load(reference);
    return this.computeQuote(booking);
  }

  /**
   * Issues the refund.
   *
   * Ordering is deliberate: the refund row is inserted and the ledger posted inside
   * one transaction, and only then is the provider called. If the provider call
   * fails, the row is left `pending` for retry — a state that is visibly incomplete.
   * Calling the provider first and crashing before the insert would move real money
   * with no record of it, which is unrecoverable.
   */
  async execute(
    reference: string,
    reason: string,
    claims: AccessTokenClaims | undefined,
  ): Promise<{ refundId: string; amount: string; status: string; percent: number }> {
    const booking = await this.load(reference);
    const quote = await this.computeQuote(booking);

    return this.post(booking, quote, reason, claims);
  }

  /**
   * The WHOLE amount back, because the customer did nothing wrong (§6.4).
   *
   * ## Why this cannot go through `execute`
   *
   * `computeQuote` applies §7.4's cancellation tiers to `base_amount`, and both halves of that are
   * wrong here. The tiers price a customer's CHANGE OF MIND — a late cancellation refunds less
   * because the partner has lost the chance to re-sell the night. §6.4 is the opposite situation:
   * «الشريك لم يرد خلال ساعتين → إلغاء الحجز، استرداد كامل». The stay did not happen because the
   * PARTNER never answered, so a tier that returns 50% would fine the customer for the partner's
   * silence.
   *
   * And it refunds `total_amount`, not `base_amount`. The service fee is described elsewhere in
   * this file as «earned when the booking is made», which holds for a change of mind — the
   * customer got a booking and gave it up. Here they got NOTHING, so there is nothing the fee was
   * charged for, and keeping it would mean SAFRA profits from its own partner's failure.
   *
   * ## Idempotent by the amount, not by a flag
   *
   * `alreadyRefunded` is subtracted the same way `computeQuote` does it, so a second call after a
   * partial refund tops it up to whole and a second call after a full one refunds zero and is
   * refused. That is what makes it safe to call from a SWEEP that re-reads its own working set.
   */
  async refundInFull(
    reference: string,
    reason: string,
  ): Promise<{ refundId: string; amount: string; status: string; percent: number }> {
    const booking = await this.load(reference);
    const quote = await this.fullQuote(booking);

    return this.post(booking, quote, reason, undefined);
  }

  /**
   * Everything after the figure is agreed — shared by both paths above.
   *
   * Extracted rather than duplicated because it is the part that MOVES money: the refund row, the
   * wallet credit, the ledger legs, the timeline entry and the audit record. Two copies of this
   * would drift, and the direction they drift in is one path forgetting a leg.
   */
  private async post(
    booking: BookingRow,
    quote: RefundQuote,
    reason: string,
    claims: AccessTokenClaims | undefined,
  ): Promise<{ refundId: string; amount: string; status: string; percent: number }> {
    const reference = booking.reference;

    if (toMinor(quote.refundAmount, MONEY_SCALE) <= 0n) {
      throw conflict(ERROR.BOOKING_NO_REFUNDABLE_AMOUNT);
    }

    const payment = await this.findCapturedPayment(booking.id);

    if (!payment) {
      throw conflict(ERROR.BOOKING_NO_CAPTURED_PAYMENT);
    }

    const needsProvider = toMinor(quote.providerAmount, MONEY_SCALE) > 0n;

    /**
     * A refund settled entirely from stored value needs no gateway.
     *
     * Resolving one anyway would fail for exactly the bookings this path exists to
     * serve: a wallet-only payment carries `provider = 'internal'`, which is not in
     * the registry and never will be, so requiring a provider here would make those
     * refunds permanently impossible.
     */
    const provider = needsProvider ? this.registry.bySlug(payment.provider) : undefined;

    if (needsProvider && !provider) {
      /**
       * A refund owed through a provider that is no longer registered needs a human,
       * not a guess. Failing loudly beats silently routing it elsewhere.
       */
      this.logger.error(
        `Refund for ${reference} needs provider "${payment.provider}", which is not registered.`,
      );
      throw conflict(ERROR.PAYMENT_REFUND_UNAVAILABLE);
    }

    const refundId = await this.db.transaction(async (tx) => {
      const inserted = await tx.execute<{ id: string }>(sql`
        INSERT INTO refunds
          (payment_id, booking_id, amount, wallet_amount, currency_id,
           applied_refund_percent, reason, status, initiated_by_user_id)
        VALUES (${payment.id}, ${booking.id}, ${quote.refundAmount},
                ${quote.walletAmount}, ${booking.currency_id},
                ${quote.refundPercent}, ${reason},
                'pending'::refund_status, ${claims?.sub ?? null})
        RETURNING id
      `);

      const id = inserted.rows[0]?.id;
      if (!id) throw new Error('Refund insert returned no row.');

      /**
       * The stored-value portion actually moves here, in the same transaction as
       * the refund row. Unlike the gateway leg — which is a request to a third
       * party that may still fail — a wallet credit is SAFRA's own ledger, so there
       * is no pending state for it to sit in and no reason to defer it.
       */
      if (toMinor(quote.walletAmount, MONEY_SCALE) > 0n) {
        await this.wallet.credit(tx as unknown as Database, {
          customerProfileId: booking.customer_profile_id,
          amount: quote.walletAmount,
          currencyId: booking.currency_id,
          reason: 'refund',
          bookingId: booking.id,
          note: `Refund on ${reference} (${quote.tierApplied})`,
        });
      }

      /**
       * SAFRA's refund account is debited for the whole amount; the credit side
       * splits across wherever the money is going back to. Posted in this
       * transaction so a refund can never exist without its ledger movement (§13.3).
       *
       * `wallet_credit` rather than `customer_payment` for the stored-value part:
       * that money is not leaving SAFRA, it is moving back into a liability owed to
       * the customer, and booking it as an outbound payment would overstate what
       * the gateway actually returned.
       */
      const destinations: LedgerLeg[] = [];

      if (toMinor(quote.providerAmount, MONEY_SCALE) > 0n) {
        destinations.push({
          account: 'customer_payment',
          direction: 'credit',
          amount: quote.providerAmount,
          description: `Refund returned to customer for ${reference}`,
        });
      }

      if (toMinor(quote.walletAmount, MONEY_SCALE) > 0n) {
        destinations.push({
          account: 'wallet_credit',
          direction: 'credit',
          amount: quote.walletAmount,
          description: `Refund returned to wallet for ${reference}`,
        });
      }

      await this.ledger.post(
        tx as unknown as Database,
        [
          {
            account: 'refund',
            direction: 'debit',
            amount: quote.refundAmount,
            description: `Refund on ${reference} (${quote.tierApplied})`,
          },
          ...destinations,
        ],
        {
          currencyId: booking.currency_id,
          fxRateToSyp: booking.fx_rate_to_syp,
          bookingId: booking.id,
          paymentId: payment.id,
          refundId: id,
          partnerId: booking.partner_id,
          customerProfileId: booking.customer_profile_id,
          createdByUserId: claims?.sub,
        },
      );

      await tx.execute(sql`
        INSERT INTO timeline_events
          (subject_type, subject_id, event_type, actor_type, actor_user_id, payload)
        VALUES ('booking', ${booking.id}, 'booking.refund_issued',
                ${claims ? 'staff' : 'system'},
                ${claims?.sub ?? null},
                ${JSON.stringify({
                  amount: quote.refundAmount,
                  toWallet: quote.walletAmount,
                  toProvider: quote.providerAmount,
                  /*
                    The CURRENCY, without which the three figures above mean nothing.

                    Bashar read «المبلغ 200.00» on a booking's timeline (2026-08-25) and could not
                    tell what it was 200 of — and on this platform that is not pedantry: SYP and USD
                    differ by four orders of magnitude, so an unlabelled amount is a number nobody
                    can act on. The console renders a money key together with this one.
                  */
                  currency: quote.currencyCode,
                  percent: quote.refundPercent,
                  tier: quote.tierApplied,
                })}::jsonb)
      `);

      await this.audit.record(
        {
          actorUserId: claims?.sub,
          actorRole: claims?.role,
          action: 'refund.created',
          subjectType: 'booking',
          subjectId: booking.id,
          after: {
            refundId: id,
            amount: quote.refundAmount,
            walletAmount: quote.walletAmount,
            providerAmount: quote.providerAmount,
            /* Same reason as the timeline payload above — three amounts, one currency. */
            currency: quote.currencyCode,
            percent: quote.refundPercent,
            provider: payment.provider,
          },
          reason,
        },
        tx as unknown as Database,
      );

      return id;
    });

    /**
     * Nothing left to send. The stored-value portion was credited inside the
     * transaction above, so the refund is already complete — there is no third
     * party whose acknowledgement it is waiting on.
     */
    if (!provider) {
      await this.db.execute(sql`
        UPDATE refunds
        SET status = 'completed'::refund_status, completed_at = now(), updated_at = now()
        WHERE id = ${refundId}
      `);

      await this.markPaymentRefundState(payment.id);
      await this.tellTheCustomer(booking, quote);

      return {
        refundId,
        amount: quote.refundAmount,
        status: 'completed',
        percent: quote.refundPercent,
      };
    }

    const outcome = await provider.refund({
      paymentProviderRef: payment.provider_ref ?? '',
      // Only the gateway's share. Sending the full amount would return the stored
      // value a second time, through a rail it never came in on.
      amount: { value: quote.providerAmount, currencyCode: quote.currencyCode },
      refundId,
      reason,
    });

    const status = outcome.kind === 'failed' ? 'failed' : outcome.kind;

    await this.db.execute(sql`
      UPDATE refunds
      SET status = ${status}::refund_status,
          provider_ref = ${outcome.kind === 'failed' ? null : outcome.providerRef},
          completed_at = CASE WHEN ${status} = 'completed' THEN now() ELSE NULL END,
          updated_at = now()
      WHERE id = ${refundId}
    `);

    /**
     * The payment reflects whether the refund was total or partial, which is what
     * makes a second refund attempt on the same booking arithmetically correct.
     */
    if (status !== 'failed') {
      await this.markPaymentRefundState(payment.id);
      await this.tellTheCustomer(booking, quote);
    }

    return {
      refundId,
      amount: quote.refundAmount,
      status,
      percent: quote.refundPercent,
    };
  }

  /**
   * «بدأ استرداد مبلغ حجزك» — §10.3 lists the refund among the mails that must exist.
   *
   * ## Here rather than at the call sites
   *
   * Two things issue refunds today — a staff button and §6.4's automatic sweep — and neither told
   * the customer anything. Sending from the SERVICE means the next one is covered without anybody
   * remembering, which is the difference between a rule and a habit.
   *
   * ## Sent AFTER the money has moved, and never able to undo it
   *
   * Outside the transaction and swallowed on failure, the same shape
   * `notifyPartnerOfPendingBooking` uses: the refund is already recorded and posted to the ledger,
   * and a mail server that is down must not roll that back. A notice that fails is a `notifications`
   * row the re-drive sweep picks up; a refund that fails is money.
   *
   * A booking with no email address on it — a guest checkout that captured only a phone — simply
   * gets no mail. That is a real gap for a real customer and it belongs to WhatsApp (roadmap 192),
   * not here.
   */
  private async tellTheCustomer(booking: BookingRow, quote: RefundQuote): Promise<void> {
    try {
      const rows = await this.db.execute<{
        email: string | null;
        locale: string | null;
      }>(sql`
        SELECT cp.email, u.preferred_locale AS locale
        FROM bookings b
        JOIN customer_profiles cp ON cp.id = b.customer_profile_id
        LEFT JOIN users u ON u.id = cp.user_id
        WHERE b.id = ${booking.id}
        LIMIT 1
      `);

      const row = rows.rows[0];

      if (!row?.email) return;

      await this.notifications.notify(
        'booking.refunded',
        bookingRefundedMail({
          to: row.email,
          locale: row.locale ?? 'ar',
          reference: booking.reference,
          amount: quote.refundAmount,
          currency: quote.currencyCode,
          url: `${this.env.APP_URL}/ar/account/bookings/${encodeURIComponent(booking.reference)}`,
        }),
        row.locale ?? 'ar',
        { bookingId: booking.id, customerProfileId: booking.customer_profile_id },
      );
    } catch (error: unknown) {
      this.logger.error(
        `Refund on ${booking.reference} was issued but the customer could not be told: ` +
          `${describeError(error)}`,
      );
    }
  }

  /**
   * §7.4 tier arithmetic.
   *
   * Tiers are expressed as "this many hours before check-in ⇒ this percent", so the
   * applicable tier is the tightest one whose threshold the cancellation still meets.
   * Sorting descending and taking the first match is what makes overlapping tiers
   * resolve to the most generous applicable one rather than to whichever happened to
   * be listed first.
   */
  private async computeQuote(booking: BookingRow): Promise<RefundQuote> {
    const snapshot = (booking.cancellation_policy_snapshot ?? {}) as PolicySnapshot;

    const hoursBeforeCheckIn = Math.floor(
      (new Date(`${booking.check_in}T00:00:00Z`).getTime() - Date.now()) / 3_600_000,
    );

    const tiers = [...(snapshot.tiers ?? [])].sort(
      (a, b) => b.hoursBeforeCheckIn - a.hoursBeforeCheckIn,
    );

    const matched = tiers.find((tier) => hoursBeforeCheckIn >= tier.hoursBeforeCheckIn);

    /**
     * §7.4's floor. Applied even when no tier matches — a late cancellation still
     * owes the minimum, and the DB CHECK constraint enforces the same number, so a
     * policy edited to breach it cannot have produced this snapshot.
     */
    const floor = snapshot.minRefundPercent ?? 50;
    const percent = Math.max(matched?.refundPercent ?? 0, floor);

    /**
     * Refundable base is the BASE amount, not the total. SAFRA's service fee is
     * earned when the booking is made and is not the partner's money to return;
     * refunding it would mean the platform pays for the customer's change of mind.
     */
    const refundableBase = booking.base_amount;
    const alreadyRefunded = await this.sumRefunded(booking.id);

    const gross = fromMinor(
      applyRate(toMinor(refundableBase, MONEY_SCALE), percent / 100),
      MONEY_SCALE,
    );

    const remaining = toMinor(gross, MONEY_SCALE) - toMinor(alreadyRefunded, MONEY_SCALE);

    const refundAmountMinor = remaining > 0n ? remaining : 0n;
    const refundAmount = fromMinor(refundAmountMinor, MONEY_SCALE);

    /**
     * Stored value is returned before card money (§7.3).
     *
     * The customer gets spendable balance back immediately instead of waiting on a
     * card settlement, and SAFRA is not out of pocket for an acquirer's refund fee
     * on money that never went through an acquirer. Capped at what the wallet
     * actually funded, less whatever earlier refunds already returned — otherwise a
     * second partial refund would hand back the same balance twice.
     */
    const walletFunded = toMinor(booking.wallet_amount, MONEY_SCALE);
    const walletAlreadyBack = toMinor(
      await this.sumRefundedToWallet(booking.id),
      MONEY_SCALE,
    );

    const walletHeadroom = walletFunded - walletAlreadyBack;
    const cappedHeadroom = walletHeadroom > 0n ? walletHeadroom : 0n;

    const toWalletMinor =
      refundAmountMinor < cappedHeadroom ? refundAmountMinor : cappedHeadroom;

    return {
      refundPercent: percent,
      refundAmount,
      walletAmount: fromMinor(toWalletMinor, MONEY_SCALE),
      providerAmount: fromMinor(refundAmountMinor - toWalletMinor, MONEY_SCALE),
      currencyCode: booking.currency_code,
      hoursBeforeCheckIn,
      tierApplied: matched
        ? `${matched.hoursBeforeCheckIn}h before check-in`
        : `policy minimum (${floor}%)`,
      alreadyRefunded,
      refundable: gross,
    };
  }

  /**
   * 100% of the TOTAL, less whatever has already gone back.
   *
   * Shares `computeQuote`'s wallet-first split (§7.3) and its already-refunded arithmetic; what it
   * does not share is the tier lookup, because there is no tier to apply — see `refundInFull`.
   */
  private async fullQuote(booking: BookingRow): Promise<RefundQuote> {
    const gross = booking.total_amount;
    const alreadyRefunded = await this.sumRefunded(booking.id);

    const remaining = toMinor(gross, MONEY_SCALE) - toMinor(alreadyRefunded, MONEY_SCALE);
    const refundAmountMinor = remaining > 0n ? remaining : 0n;

    const walletHeadroom =
      toMinor(booking.wallet_amount, MONEY_SCALE) -
      toMinor(await this.sumRefundedToWallet(booking.id), MONEY_SCALE);
    const cappedHeadroom = walletHeadroom > 0n ? walletHeadroom : 0n;

    const toWalletMinor =
      refundAmountMinor < cappedHeadroom ? refundAmountMinor : cappedHeadroom;

    return {
      refundPercent: 100,
      refundAmount: fromMinor(refundAmountMinor, MONEY_SCALE),
      walletAmount: fromMinor(toWalletMinor, MONEY_SCALE),
      providerAmount: fromMinor(refundAmountMinor - toWalletMinor, MONEY_SCALE),
      currencyCode: booking.currency_code,
      hoursBeforeCheckIn: 0,
      /* Named for the RULE rather than a tier, because that is what the audit row has to say. */
      tierApplied: 'full refund (§6.4)',
      alreadyRefunded,
      refundable: gross,
    };
  }

  /** How much of this booking's refunds has already gone back to stored value. */
  private async sumRefundedToWallet(bookingId: string): Promise<string> {
    const rows = await this.db.execute<{ total: string }>(sql`
      SELECT COALESCE(SUM(wallet_amount), 0)::text AS total
      FROM refunds
      WHERE booking_id = ${bookingId} AND status IN ('pending','processing','completed')
    `);

    return rows.rows[0]?.total ?? '0';
  }

  private async sumRefunded(bookingId: string): Promise<string> {
    const rows = await this.db.execute<{ total: string }>(sql`
      SELECT COALESCE(SUM(amount), 0)::text AS total
      FROM refunds
      WHERE booking_id = ${bookingId} AND status IN ('pending','processing','completed')
    `);

    return rows.rows[0]?.total ?? '0';
  }

  private async markPaymentRefundState(paymentId: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE payments p
      SET status = CASE
            WHEN r.refunded >= p.amount THEN 'refunded'::payment_status
            ELSE 'partially_refunded'::payment_status
          END,
          updated_at = now()
      FROM (
        SELECT COALESCE(SUM(amount), 0) AS refunded
        FROM refunds
        WHERE payment_id = ${paymentId} AND status IN ('pending','processing','completed')
      ) r
      WHERE p.id = ${paymentId}
    `);
  }

  private async findCapturedPayment(bookingId: string) {
    const rows = await this.db.execute<{
      id: string;
      provider: string;
      provider_ref: string | null;
      amount: string;
    }>(sql`
      SELECT id, provider, provider_ref, amount::text AS amount
      FROM payments
      WHERE booking_id = ${bookingId}
        AND status IN ('captured','partially_refunded')
        AND deleted_at IS NULL
      ORDER BY captured_at DESC NULLS LAST
      LIMIT 1
    `);

    return rows.rows[0] ?? null;
  }

  private async load(reference: string): Promise<BookingRow> {
    const rows = await this.db.execute<BookingRow>(sql`
      SELECT b.id, b.reference, b.status::text AS status, b.check_in::text AS check_in,
             b.base_amount::text AS base_amount, b.total_amount::text AS total_amount,
             b.wallet_amount::text AS wallet_amount,
             b.currency_id, b.fx_rate_to_syp::text AS fx_rate_to_syp,
             b.partner_id, b.customer_profile_id,
             b.cancellation_policy_snapshot, cur.code AS currency_code
      FROM bookings b
      JOIN currencies cur ON cur.id = b.currency_id
      WHERE b.reference = ${reference} AND b.deleted_at IS NULL
      LIMIT 1
    `);

    const booking = rows.rows[0];
    if (!booking) throw notFound(ERROR.BOOKING_NOT_FOUND);

    if (booking.status === 'draft') {
      throw badRequest(ERROR.BOOKING_DRAFT_NOT_REFUNDABLE);
    }

    return booking;
  }
}

/** A `type`, not an `interface` — see the note on PaymentRow in the webhook service. */
type BookingRow = {
  id: string;
  reference: string;
  status: string;
  check_in: string;
  base_amount: string;
  total_amount: string;
  wallet_amount: string;
  currency_id: string;
  currency_code: string;
  fx_rate_to_syp: string;
  partner_id: string;
  customer_profile_id: string;
  cancellation_policy_snapshot: unknown;
};
