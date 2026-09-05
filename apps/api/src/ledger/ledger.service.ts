import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import type { Database } from '@safra/db';
import { schema } from '@safra/db';

import { DATABASE } from '../database/database.module.js';
import {
  MONEY_SCALE,
  fromMinor,
  multiplyDecimalStrings,
  toMinor,
} from '../common/money.js';

/**
 * The accounts, derived from the database enum rather than restated.
 *
 * This union used to be written out by hand and had already fallen behind twice —
 * `payment_provider_fee` and `wallet_adjustment` both existed in PostgreSQL while
 * TypeScript refused to accept them. Deriving it means adding a value is one edit
 * to `schema/enums.ts`, and a leg naming an account the database does not have
 * fails to compile instead of at INSERT time.
 */
export type LedgerAccount = (typeof schema.ledgerAccount.enumValues)[number];

/**
 * A single leg of a double-entry movement.
 *
 * Amounts are decimal STRINGS. They arrive from the pricing engine already computed
 * in integer minor units, and converting to a float here to "make the maths easier"
 * would undo that in the one place it matters most.
 */
export interface LedgerLeg {
  account: LedgerAccount;
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
   * One movement, because the customer's money splits three ways:
   *
   *   DEBIT  customer_payment           what came in through the gateway
   *   DEBIT  wallet_debit               what came out of stored value (§7.3)
   *   CREDIT safra_commission_customer  the flat service fee SAFRA keeps
   *   CREDIT safra_commission_partner   the % SAFRA deducts from the partner
   *   CREDIT partner_payable            what the partner is owed
   *
   * Debits equal credits by construction: total = fee + commission + payable, and
   * the debit side splits that same total across however many sources funded it. If
   * the arithmetic ever drifts, the trigger rejects the transaction rather than
   * letting the books go out.
   *
   * The split lives HERE rather than in the booking's own amounts: netting a wallet
   * payment out of `total_amount` would break the identity above, because the fee
   * and commission are still owed on the full price regardless of how it was paid.
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
      /** Portion funded from the wallet; the rest came through the gateway. */
      walletAmount?: string | undefined;
      customerFeeAmount: string;
      partnerCommissionAmount: string;
      partnerPayableAmount: string;
      /** What a coupon took off the total. Zero or absent when none applied. */
      discountAmount?: string | undefined;
      reference: string;
    },
    paymentId: string,
    actorUserId?: string,
  ): Promise<{ entryGroupId: string }> {
    const total = toMinor(booking.totalAmount, MONEY_SCALE);
    const fromWallet = toMinor(booking.walletAmount ?? '0', MONEY_SCALE);
    const fromGateway = total - fromWallet;

    if (fromWallet < 0n || fromGateway < 0n) {
      // The wallet cannot have funded more than the booking cost. Reaching here
      // means a hold was placed against the wrong total, and posting it would
      // record a negative receipt.
      throw new Error(
        `Wallet portion ${booking.walletAmount} exceeds the total ${booking.totalAmount}.`,
      );
    }

    /**
     * A zero-value leg is omitted rather than written.
     *
     * A wallet-only booking has no gateway receipt, and posting `customer_payment
     * 0.00` would put a row in the books asserting money arrived through a rail
     * nobody used — which is exactly the kind of entry that makes a rail-mix report
     * lie.
     */
    const funding: LedgerLeg[] = [];

    /*
      A discount is a DEBIT beside the money that actually arrived.

      This group balances on `total = fee + commission + payable`, and a coupon makes the customer
      pay less while the partner is owed exactly the same. Without a leg of its own the group would
      be short by the discount and the deferred constraint trigger would refuse the whole capture —
      which is the right failure, and this is the entry that makes it unnecessary.

      It says the true thing: SAFRA gave up that revenue to win the booking. It is not a reduction
      of what the partner earned, and `partner_payable` above is untouched.
    */
    const discount = toMinor(booking.discountAmount ?? '0', MONEY_SCALE);

    if (discount > 0n) {
      funding.push({
        account: 'coupon_discount',
        direction: 'debit',
        amount: fromMinor(discount, MONEY_SCALE),
        description: `Coupon discount on ${booking.reference}`,
      });
    }

    if (fromGateway > 0n) {
      funding.push({
        account: 'customer_payment',
        direction: 'debit',
        amount: fromMinor(fromGateway, MONEY_SCALE),
        description: `Payment received for ${booking.reference}`,
      });
    }

    if (fromWallet > 0n) {
      funding.push({
        account: 'wallet_debit',
        direction: 'debit',
        amount: fromMinor(fromWallet, MONEY_SCALE),
        description: `Wallet balance applied to ${booking.reference}`,
      });
    }

    return this.post(
      tx,
      [
        ...funding,
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
   * Forgiving a fine — as a SECOND, opposite entry, never as an edit to the first.
   *
   * > Bashar, 2026-08-24: *"A waived fine must never delete or rewrite history. The original fine
   * > entry must remain permanently visible. Fine −50, Waiver +50. The net effect becomes zero, but
   * > history remains complete."*
   *
   * ## Why the legs are the original's, reversed
   *
   * `postPartnerFine` debits `partner_fine` and credits `wallet_credit`. This does exactly the
   * opposite, for exactly the same amount — so the partner's fine balance nets to zero AND the
   * customer's wallet credit is taken back, which is the half that is easy to forget. Forgiving the
   * partner without reversing the compensation would leave SAFRA having paid a guest out of its own
   * pocket for an offence it decided did not stand, and nothing in the ledger would say so.
   *
   * ## Why it cannot be a partial amount
   *
   * `fineWaiveSchema` takes none, and this takes the figure from the original entry rather than
   * from a caller. Two numbers that are meant to cancel and are supplied separately WILL disagree
   * eventually, and reconciling a ledger where they have is the worst hour anybody spends.
   *
   * ## The group id goes back to the violation
   *
   * `partner_violations.waiver_ledger_group_id`, so a screen showing the waived fine finds its pair
   * rather than inferring it from amounts that happen to sum to nothing.
   */
  async postFineWaiver(
    tx: Database,
    input: {
      bookingId?: string | undefined;
      partnerId: string;
      customerProfileId?: string | undefined;
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
          direction: 'credit',
          amount: input.amount,
          description: `Fine waived for ${input.reference}`,
        },
        {
          account: 'wallet_debit',
          direction: 'debit',
          amount: input.amount,
          description: `Compensation reversed on waiver for ${input.reference}`,
        },
      ],
      {
        currencyId: input.currencyId,
        fxRateToSyp: input.fxRateToSyp,
        ...(input.bookingId ? { bookingId: input.bookingId } : {}),
        partnerId: input.partnerId,
        ...(input.customerProfileId
          ? { customerProfileId: input.customerProfileId }
          : {}),
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

  /**
   * Gives back the partner commission on a booking whose stay price went back in full.
   *
   * ## Bashar's decision, 2026-09-05
   *
   * "If a booking is fully refunded to the customer, the associated partner commission should also
   * be reversed. SAFRA should not continue recognising partner commission revenue when the
   * underlying booking value has been fully returned and the partner ultimately earned nothing."
   *
   * Before this, 962,598,000 SYP of commission stood across 5,289 bookings whose customers had
   * every riyal of the stay price returned — sixty-four per cent of what the treasury called
   * earned. It survived only because nothing reversed it.
   *
   * ## The threshold is base_amount, not total_amount
   *
   * The commission is a percentage of the STAY, so the stay is what has to have gone back. The
   * service fee is a separate question with a separate answer that Bashar left standing: an
   * ordinary cancellation returns base_amount and keeps the fee, and the fee stays recognised.
   * That asymmetry is the whole point of the two thresholds, and it is why this reverses one
   * account and not both.
   *
   * ## Why the counter-leg is the refund account
   *
   * The refund already debited `refund` for everything that went back and credited wherever it
   * went. Crediting `refund` here says that this much of that outflow was funded by SAFRA giving
   * up revenue it had booked, rather than by SAFRA spending. It touches only the two accounts the
   * decision is about; `partner_payable` is left alone, because a partner payout selects on a
   * booking being completed and so never pays a refunded one anyway.
   *
   * ## Idempotent, because three code paths complete a refund
   *
   * A wallet-only refund completes inline, a provider refund completes on its reply, and an
   * asynchronous provider completes on a webhook. All three call this, so it must be safe to call
   * twice — the guard is the absence of a debit on the account for this booking, which is the
   * state itself rather than a flag beside it.
   */
  async reverseCommissionIfFullyRefunded(
    tx: Database,
    bookingId: string,
  ): Promise<{ entryGroupId: string } | null> {
    const rows = await tx.execute<{
      base_amount: string;
      commission: string;
      currency_id: string;
      fx_rate_to_syp: string;
      partner_id: string | null;
      refunded: string;
      already: string;
    }>(sql`
      SELECT b.base_amount::text,
             b.partner_commission_amount::text AS commission,
             b.currency_id::text,
             b.fx_rate_to_syp::text,
             b.partner_id::text,
             coalesce((
               SELECT sum(r.amount) FROM refunds r
                WHERE r.booking_id = b.id
                  AND r.status = 'completed'
                  AND r.deleted_at IS NULL
             ), 0)::text AS refunded,
             (
               SELECT count(*) FROM ledger_entries e
                WHERE e.booking_id = b.id
                  AND e.account = 'safra_commission_partner'
                  AND e.direction = 'debit'
             )::text AS already
        FROM bookings b
       WHERE b.id = ${bookingId}
    `);

    const row = rows.rows[0];

    if (!row) return null;

    /* Already given back. The guard is the ledger's own state, so a retry cannot double-reverse. */
    if (Number(row.already) > 0) return null;

    const commission = toMinor(row.commission, MONEY_SCALE);

    if (commission <= 0n) return null;
    if (toMinor(row.refunded, MONEY_SCALE) < toMinor(row.base_amount, MONEY_SCALE))
      return null;

    /*
      Its OWN transaction, because all three callers reach here AFTER theirs has closed.

      `post` writes one leg per statement and the balance trigger is deferred to COMMIT. Outside a
      transaction each statement commits by itself, so the trigger fired on the debit alone and
      raised "debits 182000.00 <> credits 0.00" — a half-written group rejecting itself. The legs
      have to reach COMMIT together, which is what this wraps them in. Nested inside a caller that
      already has one, it is a savepoint and behaves the same.
    */
    return tx.transaction(async (inner) =>
      this.post(
        inner as unknown as Database,
        [
          {
            account: 'safra_commission_partner',
            direction: 'debit',
            amount: row.commission,
            description: 'Commission reversed, booking refunded in full',
          },
          {
            account: 'refund',
            direction: 'credit',
            amount: row.commission,
            description: 'Commission reversed, booking refunded in full',
          },
        ],
        {
          currencyId: row.currency_id,
          fxRateToSyp: row.fx_rate_to_syp,
          bookingId,
          partnerId: row.partner_id ?? undefined,
        },
      ),
    );
  }
}
