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
  /**
   * Gives back what a refund means the partner did not earn — and what SAFRA did not earn on it.
   *
   * ## Bashar's rule (2026-09-07)
   *
   * «For a full refund, partner commission must be fully reversed. For a partial refund, partner
   * payable should be reduced proportionally to the refunded amount. SAFRA should not silently
   * absorb refund costs while continuing to recognise the full partner earning and full commission
   * as if no refund occurred.»
   *
   * ## Why the arithmetic closes exactly
   *
   * A capture posts credits of `fee + commission + payable` against the money that arrived, so the
   * ACCOMMODATION is `commission + payable` — SAFRA's cut of the room plus the partner's share of
   * it. A refund returns a slice of the accommodation (the SAFRA fee is not refunded, which is the
   * existing rule and unchanged here), so returning that slice means giving back the same
   * proportion of each.
   *
   * The two reversals therefore sum to exactly the refund, and the `refund` clearing account nets
   * to zero once they are posted:
   *
   *     capture   customer_payment DR total   | fee CR, commission CR, payable CR
   *     refund    refund DR R                 | customer_payment CR R
   *     this      commission DR c·p, payable DR y·p | refund CR R
   *
   * Leaving `partner_payable` alone — which is what the previous version did — left SAFRA's books
   * asserting it still owed the partner for a stay that was entirely returned: $2,883,565.44 across
   * 15,499 fully refunded bookings on this database, with the commission dutifully reversed beside
   * it. Reversing one and not the other is not half right; it is a balance sheet that does not
   * describe the world.
   *
   * ## Every figure comes from the LEDGER, not from the booking
   *
   * The original amounts are the capture's own credits and the reversals are its own debits, so
   * this is idempotent under a retry, correct across SEVERAL refunds on one booking, and unaffected
   * by `bookings.partner_payable_amount` being reduced afterwards (which it is, below, because that
   * column is what accrual reads).
   *
   * A payout RELEASE also debits `partner_payable` — and carries no `booking_id`, because it pays a
   * whole transfer rather than one stay. That is what separates a release from a reversal here, and
   * it is a structural difference rather than a description this could mistake.
   */
  async reverseForRefund(
    tx: Database,
    bookingId: string,
  ): Promise<{ entryGroupId: string } | null> {
    const rows = await tx.execute<{
      currency_id: string;
      fx_rate_to_syp: string;
      partner_id: string | null;
      refunded: string;
      commission_credited: string;
      commission_reversed: string;
      payable_credited: string;
      payable_reversed: string;
      base_amount: string;
      commission_column: string;
      payable_column: string;
    }>(sql`
      SELECT b.currency_id::text,
             b.fx_rate_to_syp::text,
             b.partner_id::text,
             b.base_amount::text AS base_amount,
             b.partner_commission_amount::text AS commission_column,
             b.partner_payable_amount::text AS payable_column,
             coalesce((
               SELECT sum(r.amount) FROM refunds r
                WHERE r.booking_id = b.id
                  AND r.status = 'completed'
                  AND r.deleted_at IS NULL
             ), 0)::text AS refunded,
             coalesce((
               SELECT sum(e.amount) FROM ledger_entries e
                WHERE e.booking_id = b.id
                  AND e.account = 'safra_commission_partner'
                  AND e.direction = 'credit'
             ), 0)::text AS commission_credited,
             coalesce((
               SELECT sum(e.amount) FROM ledger_entries e
                WHERE e.booking_id = b.id
                  AND e.account = 'safra_commission_partner'
                  AND e.direction = 'debit'
             ), 0)::text AS commission_reversed,
             coalesce((
               SELECT sum(e.amount) FROM ledger_entries e
                WHERE e.booking_id = b.id
                  AND e.account = 'partner_payable'
                  AND e.direction = 'credit'
             ), 0)::text AS payable_credited,
             coalesce((
               SELECT sum(e.amount) FROM ledger_entries e
                WHERE e.booking_id = b.id
                  AND e.account = 'partner_payable'
                  AND e.direction = 'debit'
             ), 0)::text AS payable_reversed
        FROM bookings b
       WHERE b.id = ${bookingId}
    `);

    const row = rows.rows[0];

    if (!row) return null;

    const commission = toMinor(row.commission_credited, MONEY_SCALE);
    const payable = toMinor(row.payable_credited, MONEY_SCALE);
    const accommodation = commission + payable;

    /*
      No capture in the LEDGER, and the obligation still has to come down.
      -------------------------------------------------------------------
      Bashar, 2026-09-07: «Partner payable amounts should be reduced proportionally to the refunded
      amount. SAFRA should not absorb partial-refund costs while continuing to recognise the full
      partner earning.» That is a rule about the OBLIGATION, and it cannot be conditional on the
      ledger having something to reverse.

      A booking in this state is a data-integrity fault rather than a timing gap: §13.3 posts the
      capture group in the SAME transaction as the status change, so a payable with no
      `partner_payable` credit behind it means the capture never happened. `bookings
      .partner_payable_amount` is then a quote that accrual would nonetheless pay.

      So the column comes down and NO ledger legs are posted. Debiting an account that was never
      credited would take it negative for money it never held — the books would stop describing the
      world in order to look tidy, which is the opposite of the consistency being asked for. The
      fault is reported instead: `docs/FUTURE-WORK.md` carries it, and the guard that would stop
      accrual paying an unbacked payable is a separate decision because refusing to pay a partner
      is not the same act as reducing what they are owed.
    */
    if (accommodation <= 0n) {
      /*
        The obligation still comes down, and if the money has ALREADY gone the overpayment is
        still recorded. Missing that was a real gap in the first version of this branch: a booking
        with no capture group whose transfer had been paid would have had its column reduced and
        left no balance behind, so the difference would have been absorbed in silence — the exact
        thing both of Bashar's 2026-09-07 decisions exist to stop.
      */
      const reduced = await this.reducePayableWithoutLedger(tx, bookingId, row);

      if (reduced !== null) await this.recordOverpayment(tx, bookingId, reduced);

      return null;
    }

    /*
      A refund can never exceed the accommodation: the SAFRA fee is not refundable, and a figure
      above the accommodation would otherwise reverse more than was ever credited.
    */
    const refunded = toMinor(row.refunded, MONEY_SCALE);
    const returned = refunded > accommodation ? accommodation : refunded;

    if (returned <= 0n) return null;

    /*
      The commission share, rounded half-up, and the payable share taking the REMAINDER.

      Deriving both by multiplication would leave the pair short or long by a rounding unit, and the
      `refund` clearing account would then carry a residue for ever. Taking the remainder makes the
      two sum to the refund exactly, which is what lets that account net to zero.
    */
    const targetCommission = (commission * returned + accommodation / 2n) / accommodation;
    const targetPayable = returned - targetCommission;

    const commissionDelta =
      targetCommission - toMinor(row.commission_reversed, MONEY_SCALE);
    const payableDelta = targetPayable - toMinor(row.payable_reversed, MONEY_SCALE);

    /*
      Nothing left to reverse. Negative would mean more has been given back than the refunds
      justify — never written, because a reversal that un-reverses is a correction somebody should
      make deliberately rather than a side effect of a retry.
    */
    if (commissionDelta <= 0n && payableDelta <= 0n) return null;

    const legs: LedgerLeg[] = [];
    const note =
      returned >= accommodation
        ? 'Reversed, booking refunded in full'
        : 'Reversed in proportion to the refund';

    if (commissionDelta > 0n) {
      legs.push({
        account: 'safra_commission_partner',
        direction: 'debit',
        amount: fromMinor(commissionDelta, MONEY_SCALE),
        description: note,
      });
    }

    if (payableDelta > 0n) {
      legs.push({
        account: 'partner_payable',
        direction: 'debit',
        amount: fromMinor(payableDelta, MONEY_SCALE),
        description: note,
      });
    }

    legs.push({
      account: 'refund',
      direction: 'credit',
      amount: fromMinor(
        (commissionDelta > 0n ? commissionDelta : 0n) +
          (payableDelta > 0n ? payableDelta : 0n),
        MONEY_SCALE,
      ),
      description: note,
    });

    /*
      Its OWN transaction, because all callers reach here AFTER theirs has closed.

      `post` writes one leg per statement and the balance trigger is deferred to COMMIT. Outside a
      transaction each statement commits by itself, so the trigger fired on the debit alone and
      raised "debits 182000.00 <> credits 0.00" — a half-written group rejecting itself. The legs
      have to reach COMMIT together, which is what this wraps them in. Nested inside a caller that
      already has one, it is a savepoint and behaves the same.
    */
    return tx.transaction(async (inner) => {
      const posted = await this.post(inner as unknown as Database, legs, {
        currencyId: row.currency_id,
        fxRateToSyp: row.fx_rate_to_syp,
        bookingId,
        partnerId: row.partner_id ?? undefined,
      });

      /*
        And the SNAPSHOT accrual reads.

        `bookings.partner_payable_amount` is what `PayoutService.accrue` copies onto a payout item,
        so a reversal that only reached the ledger would still have paid the partner in full at the
        next accrual. Set from the ledger rather than decremented, so a retry cannot drift it.
      */
      await inner.execute(sql`
        UPDATE bookings
           SET partner_payable_amount = ${fromMinor(payable - targetPayable, MONEY_SCALE)},
               updated_at = now()
         WHERE id = ${bookingId}
      `);

      /*
        And any payout line that has NOT been paid yet.

        A booking refunded before its transfer goes out must not still be on it at the old figure.
        A PAID payout is deliberately untouched — its total is frozen by trigger the moment money
        moves, and money already sent to a partner is a recovery for a person to decide on rather
        than something to quietly rewrite. `docs/FUTURE-WORK.md` records that case.

        The payouts are read FIRST because a fully reversed line is deleted rather than zeroed —
        `partner_payout_items_positive` forbids a zero line, and rightly: a transfer listing a
        booking worth nothing is a reconciliation puzzle for whoever reads it later. Deleting it
        cannot resurrect the booking either, since accrual only attaches a payable above zero.
        Retotalling after the delete needs the ids in hand, or the query has nothing left to find.
      */
      const affected = await inner.execute<{ payout_id: string }>(sql`
        SELECT i.payout_id::text
          FROM partner_payout_items i
          JOIN partner_payouts p ON p.id = i.payout_id
         WHERE i.booking_id = ${bookingId}
           AND p.deleted_at IS NULL
           AND p.status NOT IN ('paid', 'cancelled')
      `);

      const remaining = payable - targetPayable;

      if (affected.rows.length > 0) {
        if (remaining <= 0n) {
          await inner.execute(sql`
            DELETE FROM partner_payout_items WHERE booking_id = ${bookingId}
          `);
        } else {
          await inner.execute(sql`
            UPDATE partner_payout_items
               SET amount = ${fromMinor(remaining, MONEY_SCALE)}
             WHERE booking_id = ${bookingId}
          `);
        }

        for (const row of affected.rows) {
          await inner.execute(sql`
            UPDATE partner_payouts p
               SET gross_amount = coalesce(i.total, 0),
                   -- Every subtraction, or the identity CHECK refuses the row. recovery_amount
                   -- joined fine_amount on 2026-09-07, and a retotal that forgot it would fail on
                   -- exactly the payouts carrying an overpayment: the ones that matter.
                   net_amount = coalesce(i.total, 0) - p.fine_amount - p.recovery_amount,
                   updated_at = now()
              FROM (
                SELECT coalesce(sum(amount), 0) AS total
                  FROM partner_payout_items WHERE payout_id = ${row.payout_id}
              ) i
             WHERE p.id = ${row.payout_id}
          `);
        }
      }

      /*
        And the case where the money has ALREADY gone.

        A booking on a PAID payout cannot have its line corrected: the total is frozen by trigger
        the moment money moves, and rightly — a transfer is evidence of what happened rather than a
        figure to restate. So the difference between what was paid for that stay and what it is now
        worth is a real overpayment, and until 2026-09-07 it had nowhere to live.
      */
      await this.recordOverpayment(inner as unknown as Database, bookingId, remaining);

      return posted;
    });
  }

  /**
   * The overpayment a refund creates on a transfer that has already been paid.
   *
   * ## Bashar's rule (2026-09-07)
   *
   * «If a payout has already been paid and a refund later creates an overpayment, I want the
   * difference recorded as a recoverable balance that is deducted from future payouts. Do not
   * automatically create negative transfers or attempt to claw money back outside the normal
   * payout process.»
   *
   * So this records and does not collect. The deduction happens in `PayoutService` when the next
   * transfer is totalled, through the ordinary process, where the partner can see it.
   *
   * ## The amount is what was PAID minus what the stay is now worth
   *
   * Not the whole reversal. Part of a booking's payable may still be sitting on an unpaid payout,
   * and that part is corrected in place by the caller — recovering it as well would take it twice.
   *
   * ## Idempotent, and it can only grow
   *
   * One row per booking, so a second refund on the same stay raises the SAME balance rather than a
   * second one a partner cannot reconcile. `greatest` on update, because `recovered_amount` may
   * already have been taken against it and the CHECK will not allow the recorded overpayment to
   * fall below what has been collected. `settled_at` is recomputed with it: a balance that grows
   * past what has been recovered is outstanding again, and the CHECK holds the two in agreement.
   */
  private async recordOverpayment(
    tx: Database,
    bookingId: string,
    remaining: bigint,
  ): Promise<void> {
    const paid = await tx.execute<{
      payout_id: string;
      partner_id: string;
      currency_id: string;
      paid_amount: string;
    }>(sql`
      SELECT i.payout_id::text, p.partner_id::text, p.currency_id::text,
             i.amount::text AS paid_amount
        FROM partner_payout_items i
        JOIN partner_payouts p ON p.id = i.payout_id
       WHERE i.booking_id = ${bookingId}
         AND p.deleted_at IS NULL
         AND p.status = 'paid'
       LIMIT 1
    `);

    const row = paid.rows[0];

    if (!row) return;

    const overpaid = toMinor(row.paid_amount, MONEY_SCALE) - remaining;

    if (overpaid <= 0n) return;

    const amount = fromMinor(overpaid, MONEY_SCALE);

    await tx.execute(sql`
      INSERT INTO partner_recoveries
        (partner_id, booking_id, currency_id, amount, paid_payout_id)
      VALUES (${row.partner_id}, ${bookingId}, ${row.currency_id}, ${amount},
              ${row.payout_id})
      ON CONFLICT (booking_id) DO UPDATE
         SET amount = greatest(partner_recoveries.amount, excluded.amount),
             settled_at = CASE
               WHEN partner_recoveries.recovered_amount
                      >= greatest(partner_recoveries.amount, excluded.amount)
               THEN coalesce(partner_recoveries.settled_at, now())
               ELSE NULL
             END,
             updated_at = now()
    `);
  }

  /**
   * The obligation, reduced in proportion, for a booking the ledger never captured.
   *
   * ## Why the basis is not the column itself
   *
   * `payable × (1 − p)` applied twice reduces twice. Every input here is IMMUTABLE — `base_amount`
   * and `partner_commission_amount` are never written by this service, and completed refunds only
   * accumulate — so the target is a fixed value that repeated calls converge on rather than walk
   * down. That is what makes a retry, a webhook arriving after a reply, and a second refund all
   * land on the same figure.
   *
   * ## And it can only ever fall
   *
   * `least(current, target)`. The identity `base = commission + payable` holds on the overwhelming
   * majority of bookings and is broken on a few hundred, and where it is broken this must not
   * INVENT an obligation larger than the one on record. Under-reducing in that corner is a gap
   * worth reporting; over-recognising what SAFRA owes is the defect being fixed, and it would be
   * perverse to reintroduce it here.
   */
  private async reducePayableWithoutLedger(
    tx: Database,
    bookingId: string,
    row: { refunded: string; base_amount: string; commission_column: string },
  ): Promise<bigint | null> {
    const base = toMinor(row.base_amount, MONEY_SCALE);

    if (base <= 0n) return null;

    const refunded = toMinor(row.refunded, MONEY_SCALE);
    const returned = refunded > base ? base : refunded;

    if (returned <= 0n) return null;

    const quoted = toMinor(row.commission_column, MONEY_SCALE);
    const original = base - quoted;

    if (original <= 0n) return null;

    /* Kept, not multiplied out: the remaining share of an obligation that was never captured. */
    const target = (original * (base - returned)) / base;

    await tx.execute(sql`
      UPDATE bookings
         SET partner_payable_amount = least(
               partner_payable_amount,
               ${fromMinor(target, MONEY_SCALE)}::numeric
             ),
             updated_at = now()
       WHERE id = ${bookingId}
         AND partner_payable_amount > ${fromMinor(target, MONEY_SCALE)}::numeric
    `);

    return target;
  }
}
