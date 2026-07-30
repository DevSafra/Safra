import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import type { Database } from '@safra/db';

import { DATABASE } from '../database/database.module.js';
import { multiplyDecimalStrings } from '../bookings/pricing.service.js';

/**
 * A single leg of a double-entry movement.
 *
 * Amounts are decimal STRINGS. They arrive from the pricing engine already computed
 * in integer minor units, and converting to a float here to "make the maths easier"
 * would undo that in the one place it matters most.
 */
export interface LedgerLeg {
  account:
    | 'customer_payment'
    | 'safra_commission_customer'
    | 'safra_commission_partner'
    | 'partner_payable'
    | 'partner_payout'
    | 'refund'
    | 'wallet_credit'
    | 'wallet_debit'
    | 'gift_card_redemption'
    | 'partner_fine';
  direction: 'debit' | 'credit';
  amount: string;
  description: string;
}

export interface LedgerContext {
  currencyId: string;
  fxRateToSyp: string;
  bookingId?: string | undefined;
  paymentId?: string | undefined;
  refundId?: string | undefined;
  partnerId?: string | undefined;
  customerProfileId?: string | undefined;
  createdByUserId?: string | undefined;
}

/**
 * Double-entry bookkeeping (SRS §13.3: "every financial operation needs an immutable
 * transaction record").
 *
 * Revenue, partner payables and commission are DERIVED by summing this table — never
 * recomputed from bookings, which can be edited. The ledger is append-only at the
 * database level, and a deferred constraint trigger rejects any group whose debits and
 * credits do not balance, so an unbalanced write is impossible rather than merely
 * discouraged.
 *
 * Every leg carries the FX rate that was in force, so a report run next year
 * reproduces the figure it showed today even though SYP has moved.
 */
@Injectable()
export class LedgerService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Writes one balanced group.
   *
   * MUST be called inside the caller's transaction. A ledger entry that survives
   * while the payment it describes rolls back is worse than no entry at all — it
   * would show money that never moved.
   */
  async post(
    tx: Database,
    legs: LedgerLeg[],
    context: LedgerContext,
  ): Promise<{ entryGroupId: string }> {
    if (legs.length < 2) {
      throw new Error('A ledger group needs at least a debit and a credit.');
    }

    const entryGroupId = uuidv7();

    for (const leg of legs) {
      const amountSyp = multiplyDecimalStrings(leg.amount, context.fxRateToSyp, 2);

      await tx.execute(sql`
        INSERT INTO ledger_entries
          (entry_group_id, account, direction, amount, currency_id,
           fx_rate_to_syp, amount_syp, booking_id, payment_id, refund_id,
           partner_id, customer_profile_id, description, created_by_user_id)
        VALUES (
          ${entryGroupId}, ${leg.account}::ledger_account, ${leg.direction}::ledger_direction,
          ${leg.amount}, ${context.currencyId},
          ${context.fxRateToSyp}, ${amountSyp},
          ${context.bookingId ?? null}, ${context.paymentId ?? null},
          ${context.refundId ?? null}, ${context.partnerId ?? null},
          ${context.customerProfileId ?? null}, ${leg.description},
          ${context.createdByUserId ?? null}
        )
      `);
    }

    // The balance trigger is DEFERRED, so it fires at COMMIT — after every leg of the
    // group exists. Nothing to assert here; the database is the authority.
    return { entryGroupId };
  }

  /**
   * The entries for a captured booking payment.
   *
   * One movement, four legs, because the customer's money splits three ways:
   *
   *   DEBIT  customer_payment           total the customer paid
   *   CREDIT safra_commission_customer  the flat service fee SAFRA keeps
   *   CREDIT safra_commission_partner   the % SAFRA deducts from the partner
   *   CREDIT partner_payable            what the partner is owed
   *
   * Debits equal credits by construction: total = fee + commission + payable, which
   * is the same identity the pricing tests assert. If the arithmetic ever drifts, the
   * trigger rejects the transaction rather than letting the books go out.
   */
  async postBookingPayment(
    tx: Database,
    booking: {
      id: string;
      partnerId: string;
      customerProfileId: string;
      currencyId: string;
      fxRateToSyp: string;
      totalAmount: string;
      customerFeeAmount: string;
      partnerCommissionAmount: string;
      partnerPayableAmount: string;
      reference: string;
    },
    paymentId: string,
    actorUserId?: string,
  ): Promise<{ entryGroupId: string }> {
    return this.post(
      tx,
      [
        {
          account: 'customer_payment',
          direction: 'debit',
          amount: booking.totalAmount,
          description: `Payment received for ${booking.reference}`,
        },
        {
          account: 'safra_commission_customer',
          direction: 'credit',
          amount: booking.customerFeeAmount,
          description: `Service fee on ${booking.reference}`,
        },
        {
          account: 'safra_commission_partner',
          direction: 'credit',
          amount: booking.partnerCommissionAmount,
          description: `Partner commission on ${booking.reference}`,
        },
        {
          account: 'partner_payable',
          direction: 'credit',
          amount: booking.partnerPayableAmount,
          description: `Payable to partner for ${booking.reference}`,
        },
      ],
      {
        currencyId: booking.currencyId,
        fxRateToSyp: booking.fxRateToSyp,
        bookingId: booking.id,
        paymentId,
        partnerId: booking.partnerId,
        customerProfileId: booking.customerProfileId,
        createdByUserId: actorUserId,
      },
    );
  }

  /**
   * A partner fine, credited to the customer's wallet (§6.4, P-007).
   *
   * Two legs: the partner owes the fine, the customer's wallet gains it. SAFRA is
   * merely the conduit here, which is why no commission account is involved — the
   * money passes through rather than being earned.
   */
  async postPartnerFine(
    tx: Database,
    input: {
      bookingId: string;
      partnerId: string;
      customerProfileId: string;
      currencyId: string;
      fxRateToSyp: string;
      amount: string;
      reference: string;
    },
  ): Promise<{ entryGroupId: string }> {
    return this.post(
      tx,
      [
        {
          account: 'partner_fine',
          direction: 'debit',
          amount: input.amount,
          description: `Fine for missing the confirmation window on ${input.reference}`,
        },
        {
          account: 'wallet_credit',
          direction: 'credit',
          amount: input.amount,
          description: `Compensation credited for ${input.reference}`,
        },
      ],
      {
        currencyId: input.currencyId,
        fxRateToSyp: input.fxRateToSyp,
        bookingId: input.bookingId,
        partnerId: input.partnerId,
        customerProfileId: input.customerProfileId,
      },
    );
  }

  /**
   * Balances per account, in SYP.
   *
   * Sums the immutable entries rather than reading a cached total, so the figure
   * cannot silently disagree with the underlying records. Cheap enough with the
   * account/date index; a materialised rollup arrives with the reports module.
   */
  async trialBalance(): Promise<{
    accounts: { account: string; debitSyp: string; creditSyp: string; netSyp: string }[];
    balanced: boolean;
  }> {
    const rows = await this.db.execute<{
      account: string;
      debit_syp: string;
      credit_syp: string;
      net_syp: string;
    }>(sql`
      SELECT
        account::text AS account,
        COALESCE(SUM(amount_syp) FILTER (WHERE direction = 'debit'), 0)::text  AS debit_syp,
        COALESCE(SUM(amount_syp) FILTER (WHERE direction = 'credit'), 0)::text AS credit_syp,
        (
          COALESCE(SUM(amount_syp) FILTER (WHERE direction = 'debit'), 0)
          - COALESCE(SUM(amount_syp) FILTER (WHERE direction = 'credit'), 0)
        )::text AS net_syp
      FROM ledger_entries
      GROUP BY account
      ORDER BY account
    `);

    const totals = await this.db.execute<{ debit: string; credit: string }>(sql`
      SELECT
        COALESCE(SUM(amount_syp) FILTER (WHERE direction = 'debit'), 0)::text  AS debit,
        COALESCE(SUM(amount_syp) FILTER (WHERE direction = 'credit'), 0)::text AS credit
      FROM ledger_entries
    `);

    const debit = totals.rows[0]?.debit ?? '0';
    const credit = totals.rows[0]?.credit ?? '0';

    return {
      accounts: rows.rows.map((r) => ({
        account: r.account,
        debitSyp: r.debit_syp,
        creditSyp: r.credit_syp,
        netSyp: r.net_syp,
      })),
      // Compared as strings via the same exact-decimal path, not as floats.
      balanced: debit === credit,
    };
  }
}
