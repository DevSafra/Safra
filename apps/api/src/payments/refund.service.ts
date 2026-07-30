import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { applyRate, fromMinor, toMinor } from '../bookings/pricing.service.js';
import { PaymentProviderRegistry } from './providers/provider.registry.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/** Minor units for every currency SAFRA handles; §1.4 lists no zero-decimal ones. */
const MONEY_SCALE = 2;

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

    if (toMinor(quote.refundAmount, MONEY_SCALE) <= 0n) {
      throw new ConflictException('No refundable amount remains on this booking.');
    }

    const payment = await this.findCapturedPayment(booking.id);

    if (!payment) {
      throw new ConflictException(
        'This booking has no captured payment, so there is nothing to refund.',
      );
    }

    const provider = this.registry.bySlug(payment.provider);

    if (!provider) {
      /**
       * A refund owed through a provider that is no longer registered needs a human,
       * not a guess. Failing loudly beats silently routing it elsewhere.
       */
      this.logger.error(
        `Refund for ${reference} needs provider "${payment.provider}", which is not registered.`,
      );
      throw new ConflictException(
        'Refunds through the original payment method are temporarily unavailable.',
      );
    }

    const refundId = await this.db.transaction(async (tx) => {
      const inserted = await tx.execute<{ id: string }>(sql`
        INSERT INTO refunds
          (payment_id, booking_id, amount, currency_id, applied_refund_percent,
           reason, status, initiated_by_user_id)
        VALUES (${payment.id}, ${booking.id}, ${quote.refundAmount},
                ${booking.currency_id}, ${quote.refundPercent}, ${reason},
                'pending'::refund_status, ${claims?.sub ?? null})
        RETURNING id
      `);

      const id = inserted.rows[0]?.id;
      if (!id) throw new Error('Refund insert returned no row.');

      /**
       * Two legs: SAFRA's refund account is debited, the customer's payment account
       * credited back. Posted in this transaction so a refund can never exist
       * without its ledger movement (§13.3).
       */
      await this.ledger.post(
        tx as unknown as Database,
        [
          {
            account: 'refund',
            direction: 'debit',
            amount: quote.refundAmount,
            description: `Refund on ${reference} (${quote.tierApplied})`,
          },
          {
            account: 'customer_payment',
            direction: 'credit',
            amount: quote.refundAmount,
            description: `Refund returned to customer for ${reference}`,
          },
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
        VALUES ('booking', ${booking.id}, 'booking.refund_issued', 'staff',
                ${claims?.sub ?? null},
                ${JSON.stringify({
                  amount: quote.refundAmount,
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
            percent: quote.refundPercent,
            provider: payment.provider,
          },
          reason,
        },
        tx as unknown as Database,
      );

      return id;
    });

    const outcome = await provider.refund({
      paymentProviderRef: payment.provider_ref ?? '',
      amount: { value: quote.refundAmount, currencyCode: quote.currencyCode },
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
    }

    return {
      refundId,
      amount: quote.refundAmount,
      status,
      percent: quote.refundPercent,
    };
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

    const refundAmount = fromMinor(remaining > 0n ? remaining : 0n, MONEY_SCALE);

    return {
      refundPercent: percent,
      refundAmount,
      currencyCode: booking.currency_code,
      hoursBeforeCheckIn,
      tierApplied: matched
        ? `${matched.hoursBeforeCheckIn}h before check-in`
        : `policy minimum (${floor}%)`,
      alreadyRefunded,
      refundable: gross,
    };
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
      SELECT b.id, b.status::text AS status, b.check_in::text AS check_in,
             b.base_amount::text AS base_amount, b.total_amount::text AS total_amount,
             b.currency_id, b.fx_rate_to_syp::text AS fx_rate_to_syp,
             b.partner_id, b.customer_profile_id,
             b.cancellation_policy_snapshot, cur.code AS currency_code
      FROM bookings b
      JOIN currencies cur ON cur.id = b.currency_id
      WHERE b.reference = ${reference} AND b.deleted_at IS NULL
      LIMIT 1
    `);

    const booking = rows.rows[0];
    if (!booking) throw new NotFoundException('Booking not found.');

    if (booking.status === 'draft') {
      throw new BadRequestException('A draft booking has no payment to refund.');
    }

    return booking;
  }
}

/** A `type`, not an `interface` — see the note on PaymentRow in the webhook service. */
type BookingRow = {
  id: string;
  status: string;
  check_in: string;
  base_amount: string;
  total_amount: string;
  currency_id: string;
  currency_code: string;
  fx_rate_to_syp: string;
  partner_id: string;
  customer_profile_id: string;
  cancellation_policy_snapshot: unknown;
};
