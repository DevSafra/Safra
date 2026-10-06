import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { LedgerService, type LedgerLeg } from '../ledger/ledger.service.js';
import { MONEY_SCALE, applyRate, fromMinor, quantise, toMinor } from '../common/money.js';
import { WalletService } from '../wallet/wallet.service.js';
import { NotificationService } from '../notifications/notification.service.js';
import { bookingRefundedMail } from '../mail/mail.templates.js';
import { ENV, type Env } from '../config/env.js';
import { describeError } from '../common/errors/safe-error.js';
import { PaymentProviderRegistry } from './providers/provider.registry.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import {
  ERROR,
  WALLET_NOTE,
  normaliseBankAccount,
  type SettleRefundRequest,
} from '@safra/contracts';
import { FieldEncryptionService } from '../common/crypto/field-encryption.service.js';
import { assertCanWrite, scopeFilter } from '../rbac/scope.sql.js';
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
    /** Reads and records the account a bank transfer came from; see `settle`. */
    private readonly crypto: FieldEncryptionService,
  ) {}

  /**
   * What would be refunded, without refunding it.
   *
   * Separate from `execute` so support staff and the customer-facing cancellation
   * screen can show a figure before anyone commits to it.
   */
  async quote(
    reference: string,
    claims: AccessTokenClaims | undefined,
  ): Promise<RefundQuote> {
    const booking = await this.load(reference, claims);
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
    const booking = await this.load(reference, claims);
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
    /* No actor: the SLA sweep. Unrestricted by construction — see `load`. */
    const booking = await this.load(reference, undefined);
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
      /*
        One refund per booking at a time (audit 2026-10-04).

        The quote was computed BEFORE this transaction, from what had already been refunded at that
        moment. Two requests in the same second (a double-click, two officers) both quoted the same
        figure against the same "nothing refunded yet", and both inserted it: the trigger in
        post/0026 caps a refund at what the payment took, not at what the policy owes, so a 50% tier
        paid out twice. Locking the booking row makes the second request wait for the first to
        commit, and re-reading the refunded total under that lock tells it the quote is stale.
      */
      await tx.execute(sql`SELECT id FROM bookings WHERE id = ${booking.id} FOR UPDATE`);

      const current = await this.returnedSoFar(tx as unknown as Database, booking.id);

      if (
        toMinor(current.total, MONEY_SCALE) !==
        toMinor(quote.alreadyRefunded, MONEY_SCALE)
      ) {
        throw conflict(ERROR.REFUND_QUOTE_CHANGED);
      }

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
          note: WALLET_NOTE.REFUNDED,
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

      await this.markPaymentRefundState(this.db, payment.id);
      await this.ledger.reverseForRefund(this.db, booking.id);
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

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE refunds
        SET status = ${status}::refund_status,
            provider_ref = ${outcome.kind === 'failed' ? null : outcome.providerRef},
            completed_at = CASE WHEN ${status} = 'completed' THEN now() ELSE NULL END,
            updated_at = now()
        WHERE id = ${refundId}
      `);

      /*
        A refusal returns NOTHING through the gateway, so its leg comes back out of the books.

        The group above credited `customer_payment` for the gateway share on the assumption it
        would leave. It did not, and the retry the system sweep makes posts that leg again — so
        without this the books would say the share was returned twice while the customer had it
        once. The wallet share is NOT reversed: it was credited in the transaction above and is
        the customer's balance now, which is why `returnedSoFar` counts it and a retry does not
        credit it again (audit 2026-10-06).
      */
      if (outcome.kind === 'failed') {
        await this.ledger.post(
          tx as unknown as Database,
          [
            {
              account: 'customer_payment',
              direction: 'debit',
              amount: quote.providerAmount,
              description: `Refund on ${reference} refused by the provider`,
            },
            {
              account: 'refund',
              direction: 'credit',
              amount: quote.providerAmount,
              description: `Refund on ${reference} refused by the provider`,
            },
          ],
          {
            currencyId: booking.currency_id,
            fxRateToSyp: booking.fx_rate_to_syp,
            bookingId: booking.id,
            paymentId: payment.id,
            refundId,
            partnerId: booking.partner_id,
            customerProfileId: booking.customer_profile_id,
            createdByUserId: claims?.sub,
          },
        );
      }
    });

    /**
     * The payment reflects whether the refund was total or partial, which is what
     * makes a second refund attempt on the same booking arithmetically correct.
     * A failed one too: its wallet share has gone back regardless.
     */
    await this.markPaymentRefundState(this.db, payment.id);

    if (status !== 'failed') {
      /*
        Only once the money is actually back. A refund still `processing` at the provider has not
        returned anything, so reversing here would give up the commission AND reduce what the
        partner is owed before the customer had the funds — and the webhook path posts it when that
        provider confirms.
      */
      if (status === 'completed') {
        await this.ledger.reverseForRefund(this.db, booking.id);
      }

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

    /*
      Measured to midnight in the CITY's timezone, by the database, as stay completion and the
      arrivals board measure their dates. It was measured to midnight UTC, so a Damascus stay's
      tiers closed three hours late and a cancellation just past a threshold was still paid the
      more generous tier.
    */
    const hoursBeforeCheckIn = booking.hours_before_check_in;

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
     * Refundable base is what the customer PAID toward the stay, not the total. SAFRA's
     * service fee is earned when the booking is made and is not the partner's money to
     * return; refunding it would mean the platform pays for the customer's change of mind.
     *
     * Less any coupon, and never more than was captured (audit 2026-10-06). A tier is a
     * share of what the customer paid; applied to the undiscounted base, a 100% tier on a
     * couponed stay asked for more than the payment took — post/0026 refused it and the
     * refund answered 500 — and every partial tier paid the coupon back in cash.
     */
    const refundableBase = this.capturedCap(booking, stayPaid(booking));
    const returned = await this.returnedSoFar(this.db, booking.id);
    const alreadyRefunded = returned.total;

    /*
      Quantised to the BOOKING's currency.

      A percentage creates a value rather than carrying one — 50% of 10.05 is 5.025, and half a
      cent is not refundable in USD. Rounding here rather than at the column means the figure the
      customer is quoted and the figure that is stored are the same number.
    */
    const gross = quantise(
      fromMinor(applyRate(refundableBase, percent / 100), MONEY_SCALE),
      Number(booking.currency_decimals),
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
    const walletAlreadyBack = toMinor(returned.wallet, MONEY_SCALE);

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
    /* Capped at what was captured, for the reason `computeQuote` gives. */
    const gross = fromMinor(
      this.capturedCap(booking, toMinor(booking.total_amount, MONEY_SCALE)),
      MONEY_SCALE,
    );
    const returned = await this.returnedSoFar(this.db, booking.id);
    const alreadyRefunded = returned.total;

    const remaining = toMinor(gross, MONEY_SCALE) - toMinor(alreadyRefunded, MONEY_SCALE);
    const refundAmountMinor = remaining > 0n ? remaining : 0n;

    const walletHeadroom =
      toMinor(booking.wallet_amount, MONEY_SCALE) - toMinor(returned.wallet, MONEY_SCALE);
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

  /** `value`, never more than the booking's capture: the payment's own share plus the wallet's. */
  private capturedCap(booking: BookingRow, value: bigint): bigint {
    const captured = toMinor(booking.captured_amount, MONEY_SCALE);
    const capped = value < captured ? value : captured;

    return capped > 0n ? capped : 0n;
  }

  /**
   * What this booking's refunds have already returned, in total and to stored value.
   *
   * A live refund counts in full. A FAILED one counts its wallet share only (audit 2026-10-06):
   * that share was credited in the transaction that wrote the row, and a provider refusing the
   * gateway share later takes none of it back. Counting a failed refund as nothing made the
   * system sweep's retry credit the wallet share a second time.
   *
   * One query for every reader — both quotes and the re-check under the booking lock in `post` —
   * because a quote and its re-check that disagree about a failed refund refuse every retry.
   */
  private async returnedSoFar(
    executor: Database,
    bookingId: string,
  ): Promise<{ total: string; wallet: string }> {
    const rows = await executor.execute<{ total: string; wallet: string }>(sql`
      SELECT COALESCE(SUM(CASE WHEN status = 'failed' THEN wallet_amount ELSE amount END), 0)::text
               AS total,
             COALESCE(SUM(wallet_amount), 0)::text AS wallet
      FROM refunds
      WHERE booking_id = ${bookingId}
        AND status IN ('pending','processing','completed','failed')
        AND deleted_at IS NULL
    `);

    return { total: rows.rows[0]?.total ?? '0', wallet: rows.rows[0]?.wallet ?? '0' };
  }

  /**
   * Finance confirming that an OFFLINE refund actually left SAFRA's account (finding 222).
   *
   * Bashar's decision, 2026-09-08: *«an offline refund must have an equivalent completion step,
   * just like a payment capture… the refund should become completed, the ledger should be updated,
   * partner payable adjustments should be applied, commission adjustments should be applied,
   * treasury balances should remain correct.»* He called it a launch blocker.
   *
   * ## What was wrong
   *
   * The reversal of `partner_payable` and `safra_commission_partner` is posted only when a refund
   * reaches `completed`, and that is correct: a refund still `processing` has returned nothing, so
   * reversing early would take money off the partner before the customer had it. For a gateway the
   * webhook posts it. For an OFFLINE rail nothing ever did — `ManualTransferProvider.refund()` can
   * only report `processing` because a human executes the transfer, and `parseWebhook()` returns
   * null because banks send none. `InternalCaptureProvider`, behind every staff-recorded capture,
   * is identical.
   *
   * So 236 refunds worth $47,326.37 sat `processing` for ever: the customer's page said «in
   * progress» indefinitely, and decision 198's proportional reduction never happened — SAFRA
   * absorbed the refund and the partner kept the full payable. The provider's own comment said
   * «the refund row stays open until finance confirms it», and there was nothing to confirm with.
   *
   * ## This is the mirror of «تأكيد استلام الحوالة»
   *
   * That control records money coming IN on a rail that cannot report for itself. This records
   * money going OUT on the same kind of rail, and does the same two things the webhook path does:
   * complete the row, then post the reversal. Nothing new about the accounting — only a person
   * where a bank would have been.
   *
   * ## Restricted to an offline rail, deliberately
   *
   * A gateway refund is confirmed by its webhook. Letting a person settle one would post a
   * reversal asserting money moved when no bank had said so — the exact error the deferral exists
   * to prevent, arriving through a button instead.
   *
   * ## Idempotent, and atomically so
   *
   * The status update carries its own `WHERE status = 'processing'` and the caller acts on the row
   * count, so two operators pressing at once produce one settlement and one conflict rather than
   * two reversals. `reverseForRefund` is idempotent in its own right — it derives every figure
   * from the ledger's credits minus what is already reversed — so even a retry that got past this
   * could not double-post.
   */
  async settle(
    refundId: string,
    claims: AccessTokenClaims | undefined,
    input: SettleRefundRequest,
  ) {
    const found = await this.db.execute<{
      booking_id: string;
      city_id: string | null;
      payment_id: string;
      provider: string;
      status: string;
      amount: string;
      currency_code: string;
      reference: string;
      payer_account_encrypted: string | null;
    }>(sql`
      SELECT r.booking_id::text, b.city_id::text AS city_id, r.payment_id::text,
             p.provider::text AS provider,
             r.status::text AS status, r.amount::text AS amount, cur.code AS currency_code,
             b.reference, p.payer_account_encrypted
        FROM refunds r
        JOIN payments p ON p.id = r.payment_id
        JOIN bookings b ON b.id = r.booking_id
        JOIN currencies cur ON cur.id = r.currency_id
       WHERE r.id = ${refundId}::uuid
         AND r.deleted_at IS NULL
         -- Scope, as a WHERE clause: "not in your cities" answers the same as "not there".
         AND ${scopeFilter(claims, 'b.city_id')}
    `);

    const refund = found.rows[0];

    if (!refund) throw notFound(ERROR.REFUND_NOT_FOUND);

    /*
      `read_only` passes the predicate above, which governs READS, and is refused here, as `load`
      refuses it for issuing a refund. Settling moves the ledger and confirms money left SAFRA's
      account, so a finance officer who may only look at a city must not be able to do it there.
    */
    assertCanWrite(claims, refund.city_id);

    if (refund.status !== 'processing') throw conflict(ERROR.REFUND_NOT_PENDING);

    /*
      Offline-ness is asked of the REGISTRY, not of a list of slugs here. The day Sham Cash is
      contracted its answer comes from the same flag, and a provider retired since the row was
      written reads as NOT offline — which refuses the settlement rather than allowing one nobody
      can explain.
    */
    if (this.registry.bySlug(refund.provider)?.isOffline !== true) {
      throw badRequest(ERROR.REFUND_NOT_OFFLINE);
    }

    /*
      Back to the account the money came FROM (Bashar, 2026-10-02).

      A transfer finance confirmed carries the sender's account, recorded with the capture. One
      confirmed before that was recorded has none, and this step is where it is supplied, once, from
      the statement of the INCOMING transfer; without it there is nothing to check a destination
      against, and a refund to an account nobody can vouch for is the thing this exists to stop.
    */
    const destination = normaliseBankAccount(input.destinationAccount);

    /*
      Compared BEFORE anything is written (audit 2026-10-04).

      Where no source is on record, the typed one is checked against the destination first and
      recorded only inside the settlement transaction below. It used to be written here, outside
      that transaction and before the comparison, so a mistyped digit was committed even though the
      settlement was refused, and post/0027's set-once rule then made the typo permanent.
    */
    const recordedSource = refund.payer_account_encrypted
      ? null
      : input.sourceAccount
        ? normaliseBankAccount(input.sourceAccount)
        : null;

    if (!refund.payer_account_encrypted && !recordedSource) {
      throw conflict(ERROR.REFUND_SOURCE_UNKNOWN);
    }

    const source = refund.payer_account_encrypted
      ? this.crypto.decrypt(refund.payer_account_encrypted)
      : recordedSource;

    if (source !== destination) {
      /* A security event, logged by id and never by account number. */
      this.logger.warn(
        `Refund ${refundId} on ${refund.reference}: settlement refused, the destination is not ` +
          `the account the transfer came from (by ${claims?.sub ?? 'unknown'}).`,
      );
      throw conflict(ERROR.REFUND_DESTINATION_MISMATCH);
    }

    await this.db.transaction(async (tx) => {
      /* Recorded with the settlement it vouches for, so a refused attempt leaves nothing behind. */
      if (recordedSource) {
        const written = await tx.execute(sql`
          UPDATE payments
             SET payer_account_encrypted = ${this.crypto.encrypt(recordedSource)},
                 payer_account_last4 = ${recordedSource.slice(-4)},
                 updated_at = now()
           WHERE id = ${refund.payment_id}::uuid AND payer_account_encrypted IS NULL
        `);

        /* Somebody recorded one between the read and here: theirs stands, and this asks again. */
        if (written.rowCount === 0) throw conflict(ERROR.PAYMENT_PAYER_ACCOUNT_SET);
      }

      /*
        The destination is the payment's OWN ciphertext, copied, not what was typed encrypted
        afresh: post/0027_bank_transfer_refund.sql then proves it is the same account by comparing
        two strings, and refuses any completion that is not.
      */
      const settled = await tx.execute(sql`
        UPDATE refunds r
           SET status = 'completed'::refund_status,
               completed_at = now(),
               updated_at = now(),
               destination_account_encrypted = p.payer_account_encrypted,
               destination_account_last4 = p.payer_account_last4,
               transfer_reference = ${input.transferReference}
          FROM payments p
         WHERE r.id = ${refundId}::uuid AND r.status = 'processing' AND p.id = r.payment_id
      `);

      /* Somebody else settled it between the read above and here. One settlement, one conflict. */
      if (settled.rowCount === 0) throw conflict(ERROR.REFUND_NOT_PENDING);

      await this.markPaymentRefundState(tx as unknown as Database, refund.payment_id);

      /*
        The accounting, inside the same transaction as the status it depends on.

        `reverseForRefund` debits `safra_commission_partner` and `partner_payable` in proportion to
        what was returned, reduces `bookings.partner_payable_amount` (which is what accrual reads),
        and retotals any payout line the stay is on. Treasury balances derive from these same
        entries, so they stay correct by construction rather than by a second write — and the
        ledger's deferred balance trigger fires at COMMIT, which is why this cannot run outside.
      */
      await this.ledger.reverseForRefund(tx as unknown as Database, refund.booking_id);

      await this.audit.record(
        {
          actorUserId: claims?.sub,
          actorRole: claims?.role,
          action: 'refund.settled',
          subjectType: 'booking',
          subjectId: refund.booking_id,
          after: {
            refundId,
            amount: refund.amount,
            /* The refund's own currency: an SYP refund logged as USD read four orders out. */
            currency: refund.currency_code,
            provider: refund.provider,
            /* The bank's reference, never the account: an account number is not for the audit log. */
            transferReference: input.transferReference,
          },
        },
        tx as unknown as Database,
      );
    });

    this.logger.log(
      `Refund ${refundId} on ${refund.reference} settled by ${claims?.sub ?? 'unknown'}: ` +
        `${refund.amount} on ${refund.provider}, payable and commission reversed.`,
    );

    return { refundId, status: 'completed' as const, amount: refund.amount };
  }

  /**
   * `refunded` once BOTH sources are back, `partially_refunded` until then.
   *
   * A booking is funded from two places: the payment's own rail and the wallet. The gateway
   * share is compared with the payment's own amount, and the wallet share with what the wallet
   * funded on the booking, so neither can mark the other's money returned (audit 2026-10-04).
   *
   * A WALLET payment has no gateway share at all — its `amount` IS the wallet's share — so its
   * gateway side is zero by definition. Comparing the gateway share (always nothing) with its
   * amount left every fully refunded wallet-only payment `partially_refunded` for good
   * (audit 2026-10-06). A failed refund's wallet share counts, for the reason `returnedSoFar` gives.
   */
  private async markPaymentRefundState(
    executor: Database,
    paymentId: string,
  ): Promise<void> {
    await executor.execute(sql`
      UPDATE payments p
      SET status = CASE
            WHEN r.gateway >= CASE WHEN p.method = 'wallet' THEN 0 ELSE p.amount END
             AND r.wallet >= b.wallet_amount
            THEN 'refunded'::payment_status
            ELSE 'partially_refunded'::payment_status
          END,
          updated_at = now()
      FROM bookings b,
      (
        SELECT COALESCE(SUM(amount - wallet_amount)
                 FILTER (WHERE status IN ('pending','processing','completed')), 0) AS gateway,
               COALESCE(SUM(wallet_amount), 0) AS wallet
        FROM refunds
        WHERE payment_id = ${paymentId}
          AND status IN ('pending','processing','completed','failed')
          AND deleted_at IS NULL
      ) r
      WHERE p.id = ${paymentId} AND b.id = p.booking_id
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

  /**
   * The booking a refund names, IF this caller is scoped to reach it.
   *
   * ## The gap this closes (`O-sec-13`, 2026-08-27)
   *
   * `quote` and `execute` are `REFUND_READ`/`REFUND_CREATE` on `payments/:reference`, and this
   * resolved the booking by reference alone. A refund moves real money back to a customer, so a
   * city-scoped finance officer could issue one against any booking in the country — and see the
   * quote for it first, which is the reconnaissance step.
   *
   * ## `undefined` claims are the SWEEP, and stay unrestricted
   *
   * `refundInFull` is called by the SLA expiry sweep with no actor at all. `scopeOf(undefined)`
   * answers `UNSCOPED`, so the predicate folds to TRUE and the system path is unchanged — which is
   * correct: a job has no geography and refusing it would strand the money it exists to return.
   */
  private async load(
    reference: string,
    claims: AccessTokenClaims | undefined,
  ): Promise<BookingRow> {
    const rows = await this.db.execute<BookingRow>(sql`
      SELECT b.id, b.reference, b.status::text AS status, b.check_in::text AS check_in,
             b.base_amount::text AS base_amount, b.total_amount::text AS total_amount,
             b.wallet_amount::text AS wallet_amount,
             b.currency_id, b.fx_rate_to_syp::text AS fx_rate_to_syp,
             b.partner_id, b.customer_profile_id, b.city_id::text AS city_id,
             b.cancellation_policy_snapshot, cur.code AS currency_code,
             cur.decimals AS currency_decimals,
             b.discount_amount::text AS discount_amount,
             -- What the booking actually took: its payment's own share (a wallet payment's amount
             -- IS the wallet share, so it is not counted twice) plus the wallet's.
             (COALESCE((
                SELECT p.amount FROM payments p
                 WHERE p.booking_id = b.id
                   AND p.status IN ('captured','partially_refunded','refunded')
                   AND p.method <> 'wallet'
                   AND p.deleted_at IS NULL
                 ORDER BY p.captured_at DESC NULLS LAST
                 LIMIT 1
              ), 0) + b.wallet_amount)::text AS captured_amount,
             -- Midnight of check-in in the CITY's timezone, as stay completion reads its dates.
             floor(extract(epoch FROM (
               (b.check_in::timestamp AT TIME ZONE COALESCE(ci.timezone, 'UTC')) - now()
             )) / 3600)::int AS hours_before_check_in
      FROM bookings b
      JOIN currencies cur ON cur.id = b.currency_id
      LEFT JOIN cities ci ON ci.id = b.city_id
      WHERE b.reference = ${reference} AND b.deleted_at IS NULL
        AND ${scopeFilter(claims, 'b.city_id')}
      LIMIT 1
    `);

    const booking = rows.rows[0];
    if (!booking) throw notFound(ERROR.BOOKING_NOT_FOUND);

    /* `read_only` passes the predicate — it may look — and is refused here. */
    assertCanWrite(claims, booking.city_id);

    if (booking.status === 'draft') {
      throw badRequest(ERROR.BOOKING_DRAFT_NOT_REFUNDABLE);
    }

    return booking;
  }
}

/** A `type`, not an `interface` — see the note on PaymentRow in the webhook service. */
type BookingRow = {
  /** The city, for the scope predicate and guard in `load`. */
  city_id: string | null;
  id: string;
  reference: string;
  status: string;
  check_in: string;
  base_amount: string;
  total_amount: string;
  wallet_amount: string;
  currency_id: string;
  currency_code: string;
  currency_decimals: number;
  fx_rate_to_syp: string;
  partner_id: string;
  customer_profile_id: string;
  cancellation_policy_snapshot: unknown;
  discount_amount: string;
  /** The payment's own share plus the wallet's — the ceiling on anything refunded. */
  captured_amount: string;
  /** To midnight of check-in in the city's timezone, computed by the database. */
  hours_before_check_in: number;
};

/** What the customer paid toward the stay: the base less any coupon, never below zero. */
function stayPaid(booking: BookingRow): bigint {
  const paid =
    toMinor(booking.base_amount, MONEY_SCALE) -
    toMinor(booking.discount_amount, MONEY_SCALE);

  return paid > 0n ? paid : 0n;
}
