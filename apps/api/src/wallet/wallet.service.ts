import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { schema } from '@safra/db';
import { conflict } from '../common/errors/app-error.js';
import {
  ERROR,
  type CursorPage,
  type CursorQuery,
  decodeCursor,
  encodeCursor,
} from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import { FxRateService } from '../fx/fx-rate.service.js';
import {
  MONEY_SCALE,
  quantise,
  divideDecimalStrings,
  fromMinor,
  multiplyDecimalStrings,
  toMinor,
} from '../common/money.js';
import { badRequest } from '../common/errors/app-error.js';

/**
 * SRS §2.3 — the reasons a balance is allowed to move.
 *
 * Derived from the database enum rather than restated, for the same reason
 * `LedgerAccount` is: the hand-written copy had already fallen behind once. Adding a
 * reason is now one edit to `schema/enums.ts`, and a movement naming one the database
 * does not have fails to compile instead of at INSERT time.
 */
export type WalletTxnReason = (typeof schema.walletTxnReason.enumValues)[number];

export interface WalletMovement {
  readonly customerProfileId: string;
  /** Positive decimal string, in `currencyId`. Never a number. */
  readonly amount: string;
  readonly currencyId: string;
  readonly reason: WalletTxnReason;
  readonly bookingId?: string | undefined;
  readonly createdByUserId?: string | undefined;
  readonly note?: string | undefined;
}

/**
 * A credit, and where the money came from (Bashar, 2026-09-01).
 *
 * Every credit must answer «could this ever be paid out in cash», and the answer is not a matter of
 * taste — it is where the money came from. So the type asks each reason the question it can
 * actually answer, and refuses to compile without one:
 *
 * - **`sla_compensation`, `gift_card_transfer`** — SAFRA's own money, or a bearer instrument. The
 *   whole amount is restricted and there is nothing to decide, so there is no field to get wrong.
 * - **`refund`** — a return of what a booking took from this wallet, so `bookingId` is REQUIRED and
 *   the split is read back off that booking's own debits. A refund with no booking has no origin to
 *   return to, and a caller who cannot name one is a caller who does not know what they are giving
 *   back.
 * - **`admin_adjustment`, `profile_claim`** — the reason cannot tell. Finance decides one
 *   (goodwill or correction) and a profile claim carries across whatever the source wallet held, so
 *   both state `restricted` explicitly, in the movement's own currency.
 * - **`booking_payment`, `withdrawal`** — never credits. Money does not arrive by being spent.
 */
type Movement = Omit<WalletMovement, 'reason'>;

export type WalletCredit =
  | (Movement & { readonly reason: 'sla_compensation' | 'gift_card_transfer' })
  | (Movement & { readonly reason: 'refund'; readonly bookingId: string })
  | (Movement & {
      readonly reason: 'admin_adjustment' | 'profile_claim';
      /** How much of `amount` is restricted. `'0'` is a statement, not an omission. */
      readonly restricted: string;
    });

/**
 * A debit, and whether it is allowed to reach restricted money.
 *
 * `'any'` is the ordinary case — a booking spends whatever is there, restricted part first. Only a
 * movement that takes money OUT of the platform passes `'withdrawable'`, and then the restricted
 * part is invisible to it: not skipped over, not spent last, simply not available.
 */
export interface WalletDebit extends WalletMovement {
  readonly from?: 'any' | 'withdrawable';
}

export interface WalletBalance {
  readonly walletId: string;
  readonly balance: string;
  /** The part of `balance` that may never be paid out — see `wallets.restricted_balance`. */
  readonly restrictedBalance: string;
  readonly currencyId: string;
  readonly currencyCode: string;
  /** `currencies.decimals` — two for USD, THREE for JOD. What a credit may round to. */
  readonly currencyDecimals: number;
}

export interface WalletMovementResult extends WalletBalance {
  readonly transactionId: string;
  /** What actually moved, after any cross-currency conversion. */
  readonly appliedAmount: string;
  /** How much of `appliedAmount` was restricted money — credited, or consumed. */
  readonly restrictedApplied: string;
}

/**
 * What is left after the restricted part is set aside.
 *
 * One function rather than a subtraction written wherever it is needed: it is the number a payout
 * would be measured against, and «balance minus restricted» typed out by hand in five places is
 * five chances to write `balance` on the day somebody is in a hurry.
 */
export function withdrawableOf(wallet: {
  readonly balance: string;
  readonly restrictedBalance: string;
}): string {
  const free =
    toMinor(wallet.balance, MONEY_SCALE) - toMinor(wallet.restrictedBalance, MONEY_SCALE);

  return fromMinor(free > 0n ? free : 0n, MONEY_SCALE);
}

/** One line of the customer-facing statement (§2.3). */
export interface WalletStatementEntry {
  readonly id: string;
  readonly direction: 'credit' | 'debit';
  readonly reason: WalletTxnReason;
  readonly amount: string;
  readonly balanceAfter: string;
  readonly bookingReference: string | null;
  readonly note: string | null;
  readonly createdAt: string;
}

/**
 * The customer's stored balance (SRS §2.3, §7.3).
 *
 * Three invariants this service exists to hold, none of which the previous
 * inline implementation held:
 *
 *  1. **Arithmetic is exact.** The balance was previously advanced with
 *     `Number(balance) + compensation`, which is float arithmetic on money — the
 *     same class of defect as the FX fallback, and in the same codebase that
 *     computes every booking total in integer minor units precisely to avoid it.
 *  2. **A wallet holds exactly one currency.** `wallets` has a unique index per
 *     customer and a single `currency_id`, so a customer who is compensated once
 *     for a JOD booking and once for a USD booking previously had two different
 *     currencies added into one scalar. That is not a rounding error, it is a
 *     balance that means nothing. Amounts in another currency are converted
 *     through SYP — the only rates SAFRA holds — and a wallet's own currency
 *     never changes after creation.
 *  3. **The cached balance can never disagree with its transactions.** Both are
 *     written in one transaction under a row lock, so a concurrent debit cannot
 *     read a stale balance and overdraw. The database has a non-negative CHECK as
 *     the last line of defence; this service is what stops it ever firing.
 *
 * Every method takes an explicit transaction handle where it must participate in a
 * caller's atomic unit — a wallet credit that survives while the booking
 * cancellation it compensates for rolls back is money invented from nothing.
 */
@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly fx: FxRateService,
  ) {}

  /**
   * Adds to a balance, creating the wallet on first use.
   *
   * MUST be called inside the caller's transaction when it accompanies another
   * change (a cancellation, a refund, a ledger posting).
   */
  async credit(tx: Database, movement: WalletCredit): Promise<WalletMovementResult> {
    return this.move(tx, movement, 'credit');
  }

  /**
   * Subtracts from a balance.
   *
   * Refuses rather than going negative. The wallet is SAFRA's liability to the
   * customer, not a credit line, and a negative balance would silently become a
   * debt the customer never agreed to.
   */
  async debit(tx: Database, movement: WalletDebit): Promise<WalletMovementResult> {
    return this.move(tx, movement, 'debit');
  }

  /**
   * Validates, then performs the movement inside a transaction of its own.
   *
   * The nesting is what makes the row lock mean anything. Outside a transaction,
   * node-postgres hands each statement whichever pooled connection is free — so a
   * `SELECT … FOR UPDATE` and the `UPDATE` that follows it can run on different
   * connections, the lock is released the instant the first statement commits, and
   * the protection is decorative. A caller reaching for `wallet.credit(this.db, …)`
   * would get no safety at all and no error telling them so.
   *
   * Wrapping here removes the choice. Given the root connection this opens a real
   * transaction; given a caller's transaction, drizzle issues a SAVEPOINT instead —
   * and a savepoint does not release row locks, so the lock is still held until the
   * OUTER transaction commits, which is what a caller combining a wallet credit
   * with a booking cancellation needs.
   */
  private async move(
    tx: Database,
    movement: WalletCredit | WalletDebit,
    direction: 'credit' | 'debit',
  ): Promise<WalletMovementResult> {
    const requested = toMinor(movement.amount, MONEY_SCALE);

    /**
     * Zero is rejected, not silently ignored. A zero movement writes a row that
     * says nothing happened, and a caller asking for one has a bug worth seeing.
     */
    if (requested <= 0n) {
      throw badRequest(ERROR.WALLET_AMOUNT_NOT_POSITIVE);
    }

    if (movement.reason === 'admin_adjustment' && !movement.createdByUserId) {
      /**
       * §4.1 makes a manual adjustment a sensitive action, and the schema keeps a
       * `created_by_user_id` for exactly this. An unattributable one is worse than
       * no feature at all: it is money moved by nobody.
       */
      throw badRequest(ERROR.INTERNAL_ACTOR_REQUIRED);
    }

    return tx.transaction((scoped) =>
      this.applyLocked(scoped as unknown as Database, movement, direction),
    );
  }

  private async applyLocked(
    tx: Database,
    movement: WalletCredit | WalletDebit,
    direction: 'credit' | 'debit',
  ): Promise<WalletMovementResult> {
    const wallet = await this.lockOrCreate(tx, movement);

    /**
     * The amount as the WALLET understands it. A credit denominated in another
     * currency is converted here rather than at the call site, so no caller can
     * skip it.
     */
    const applied = await this.intoWalletCurrency(
      movement.amount,
      movement.currencyId,
      wallet,
    );

    const appliedMinor = toMinor(applied, MONEY_SCALE);
    const currentMinor = toMinor(wallet.balance, MONEY_SCALE);
    const restrictedMinor = toMinor(wallet.restrictedBalance, MONEY_SCALE);

    /*
      A movement that may not touch restricted money is measured against the WITHDRAWABLE part.

      This is the enforcement point, and it is deliberately not a subtraction done by the caller: a
      caller that read the balance, subtracted, and then asked for a debit would be reading outside
      this lock, and between its read and its write a booking could have spent the very money it was
      counting on. Inside the lock the two cannot disagree.

      A separate code from an ordinary shortfall, because they need different sentences. Somebody
      holding $35 who is told their balance is too small has been told something untrue; what is too
      small is the part of it that is theirs.
    */
    if (direction === 'debit' && (movement as WalletDebit).from === 'withdrawable') {
      const withdrawable = currentMinor - restrictedMinor;

      if (appliedMinor > withdrawable) {
        throw conflict(ERROR.WALLET_NOT_WITHDRAWABLE, {
          withdrawable: fromMinor(withdrawable > 0n ? withdrawable : 0n, MONEY_SCALE),
          restricted: wallet.restrictedBalance,
          currency: wallet.currencyCode,
          requested: applied,
        });
      }
    }

    /*
      How much of this movement is restricted money, decided INSIDE the lock.

      It has to be here rather than at the call site for the same reason the currency conversion is:
      a debit's split depends on the balance it is spending against, and a balance read before the
      lock is a balance that may already have moved.
    */
    const restrictedApplied =
      direction === 'credit'
        ? await this.restrictedCredit(tx, movement as WalletCredit, applied, wallet)
        : this.restrictedDebit(movement, appliedMinor, restrictedMinor);

    const nextMinor =
      direction === 'credit' ? currentMinor + appliedMinor : currentMinor - appliedMinor;

    const nextRestrictedMinor =
      direction === 'credit'
        ? restrictedMinor + restrictedApplied
        : restrictedMinor - restrictedApplied;

    if (nextMinor < 0n) {
      /**
       * States the shortfall. Unlike a resource-existence probe there is nothing to
       * enumerate — the caller already holds this wallet — and "insufficient
       * balance" without the numbers is the kind of error that generates a support
       * ticket instead of resolving one.
       */
      /*
        A CODE with the figures in `params`, not a sentence (`O-api-2`, 2026-08-25).

        The reasoning above still holds — the numbers belong in the refusal — but they belong as
        VALUES. `${balance} ${currency}, which is less than…` freezes English word order and clause
        order into the API, and a customer reads this one: it is the only refusal on this list that
        a paying person meets. `wallet.balance_below_amount` places the same three values wherever
        each language wants them.
      */
      throw conflict(ERROR.WALLET_BALANCE_BELOW_AMOUNT, {
        balance: wallet.balance,
        currency: wallet.currencyCode,
        requested: applied,
      });
    }

    const nextBalance = fromMinor(nextMinor, MONEY_SCALE);
    const nextRestricted = fromMinor(nextRestrictedMinor, MONEY_SCALE);

    await tx.execute(sql`
      UPDATE wallets
      SET balance = ${nextBalance},
          restricted_balance = ${nextRestricted},
          updated_at = now()
      WHERE id = ${wallet.walletId}
    `);

    /**
     * The append-only trail. Written in the same statement sequence as the balance
     * update and inside the same transaction, so `SUM(transactions)` and the cached
     * balance cannot drift — the cache is a read optimisation, never a second
     * source of truth.
     */
    const inserted = await tx.execute<{ id: string }>(sql`
      INSERT INTO wallet_transactions
        (wallet_id, direction, reason, amount, restricted_amount, currency_id,
         balance_after, booking_id, created_by_user_id, note)
      VALUES (
        ${wallet.walletId}, ${direction}::ledger_direction,
        ${movement.reason}::wallet_txn_reason, ${applied},
        ${fromMinor(restrictedApplied, MONEY_SCALE)}, ${wallet.currencyId},
        ${nextBalance}, ${movement.bookingId ?? null},
        ${movement.createdByUserId ?? null}, ${movement.note ?? null}
      )
      RETURNING id
    `);

    const transactionId = inserted.rows[0]?.id;
    if (!transactionId) {
      throw new Error('Wallet transaction insert returned no row.');
    }

    return {
      walletId: wallet.walletId,
      transactionId,
      balance: nextBalance,
      restrictedBalance: nextRestricted,
      appliedAmount: applied,
      restrictedApplied: fromMinor(restrictedApplied, MONEY_SCALE),
      currencyId: wallet.currencyId,
      currencyCode: wallet.currencyCode,
      currencyDecimals: wallet.currencyDecimals,
    };
  }

  /**
   * How much of a CREDIT is restricted money.
   *
   * Three answers, one per shape of credit, and the type has already made the caller say which:
   *
   * - **A compensation or a gift card** is entirely SAFRA's, so all of it.
   * - **A refund** returns what a booking took, so it returns it to the SAME parts it came from —
   *   restricted first, capped at what that booking still owes back. This is the case the whole
   *   design exists for: a booking paid with a $40 compensation and refunded would otherwise hand
   *   back $40 of money the customer could take out in cash, and the control would be undone by
   *   the most ordinary event in the system.
   * - **An adjustment or a claim** is whatever the caller stated, clamped to what actually landed
   *   after conversion so a rounded-down credit cannot end up more restricted than it is large.
   */
  private async restrictedCredit(
    tx: Database,
    movement: WalletCredit,
    applied: string,
    wallet: WalletBalance,
  ): Promise<bigint> {
    const appliedMinor = toMinor(applied, MONEY_SCALE);

    /*
      Positive tests, in the order the cases were described.

      Written as «is it one of the two that need no field» first, it did not compile: TypeScript
      narrows a union DISCRIMINANT to `never` but keeps the member, so `restricted` still appeared
      to be missing on a branch it cannot reach. Asking each case what it IS costs nothing and the
      narrowing then holds.
    */
    if (movement.reason === 'admin_adjustment' || movement.reason === 'profile_claim') {
      const stated = toMinor(
        await this.intoWalletCurrency(movement.restricted, movement.currencyId, wallet),
        MONEY_SCALE,
      );

      if (stated < 0n) return 0n;

      return stated > appliedMinor ? appliedMinor : stated;
    }

    if (movement.reason === 'refund') {
      const owed = await this.restrictedOutstanding(
        tx,
        wallet.walletId,
        movement.bookingId,
      );

      return owed < appliedMinor ? owed : appliedMinor;
    }

    /* A compensation or a gift card: all of it is SAFRA's, and there was nothing to decide. */
    return appliedMinor;
  }

  /**
   * How much restricted money a DEBIT consumes.
   *
   * Restricted first for ordinary spending, and this direction is the conservative one in both
   * senses. It never tells somebody they still hold compensation they have already spent, and it
   * leaves the customer's OWN money in the wallet — the part they could one day take out — rather
   * than spending the withdrawable half on a booking and stranding a balance that can only ever be
   * spent here.
   *
   * `from: 'withdrawable'` makes the restricted part invisible instead: the refusal has already
   * happened in `move()`, so by here there is nothing restricted to take.
   */
  private restrictedDebit(
    movement: WalletCredit | WalletDebit,
    appliedMinor: bigint,
    restrictedMinor: bigint,
  ): bigint {
    /* Only a debit reaches here, and only a debit carries `from` — a credit has no such field. */
    if ('from' in movement && movement.from === 'withdrawable') return 0n;

    return appliedMinor < restrictedMinor ? appliedMinor : restrictedMinor;
  }

  /**
   * How much restricted money one booking has taken from this wallet and not yet given back.
   *
   * Read from the trail rather than kept as a counter on the booking: the rows already say it, and
   * a counter is a second place for the same fact to be wrong. Every debit for the booking adds
   * what it consumed, every credit against it subtracts what was returned, and the difference is
   * what a further refund may still return as restricted.
   *
   * Never negative. A booking that has somehow been refunded more restricted money than it took
   * must not turn the excess into a licence to restrict fresh money, and — more to the point — the
   * remainder of any refund is customer money, which is exactly what stays withdrawable.
   */
  private async restrictedOutstanding(
    tx: Database,
    walletId: string,
    bookingId: string,
  ): Promise<bigint> {
    const rows = await tx.execute<{ outstanding: string }>(sql`
      SELECT COALESCE(SUM(
        CASE WHEN direction = 'debit' THEN restricted_amount ELSE -restricted_amount END
      ), 0)::text AS outstanding
      FROM wallet_transactions
      WHERE wallet_id = ${walletId} AND booking_id = ${bookingId}
    `);

    const outstanding = toMinor(rows.rows[0]?.outstanding ?? '0', MONEY_SCALE);

    return outstanding > 0n ? outstanding : 0n;
  }

  /**
   * Takes a row lock on the wallet, creating it if the customer has none.
   *
   * `FOR UPDATE` is what makes concurrent movements safe. Without it two requests
   * read the same balance, each computes its own successor, and the second write
   * silently discards the first — the classic lost update, and on a balance it
   * means real money vanishing or being spent twice.
   *
   * The insert races too: two first-ever movements arriving together would both
   * see no wallet. `ON CONFLICT DO NOTHING` against the unique index resolves that
   * without either failing, and the follow-up SELECT then locks whichever row won.
   */
  private async lockOrCreate(
    tx: Database,
    movement: WalletCredit | WalletDebit,
  ): Promise<WalletBalance> {
    const existing = await this.selectForUpdate(tx, movement.customerProfileId);
    if (existing) return existing;

    await tx.execute(sql`
      INSERT INTO wallets (customer_profile_id, balance, currency_id)
      VALUES (${movement.customerProfileId}, 0, ${movement.currencyId})
      ON CONFLICT DO NOTHING
    `);

    const created = await this.selectForUpdate(tx, movement.customerProfileId);

    if (!created) {
      /**
       * The insert affected nothing and the row is still absent, which means the
       * customer profile does not exist. A foreign key would have raised on the
       * insert, so this is close to unreachable — but falling through would leave
       * the caller with an unexplained undefined.
       */
      throw badRequest(ERROR.CUSTOMER_NOT_FOUND);
    }

    return created;
  }

  private async selectForUpdate(
    tx: Database,
    customerProfileId: string,
  ): Promise<WalletBalance | undefined> {
    const rows = await tx.execute<{
      id: string;
      balance: string;
      restricted_balance: string;
      currency_id: string;
      code: string;
      decimals: number;
    }>(sql`
      SELECT w.id, w.balance::text AS balance,
             w.restricted_balance::text AS restricted_balance,
             w.currency_id, cur.code, cur.decimals
      FROM wallets w
      JOIN currencies cur ON cur.id = w.currency_id
      WHERE w.customer_profile_id = ${customerProfileId}
        AND w.deleted_at IS NULL
      FOR UPDATE OF w
    `);

    const row = rows.rows[0];
    if (!row) return undefined;

    return {
      walletId: row.id,
      balance: row.balance,
      restrictedBalance: row.restricted_balance,
      currencyId: row.currency_id,
      currencyCode: row.code,
      currencyDecimals: Number(row.decimals),
    };
  }

  /**
   * Converts an amount into the wallet's currency, via SYP.
   *
   * SAFRA stores only `X → SYP` rates (see FxRateService), so a JOD amount landing
   * in a USD wallet goes JOD → SYP → USD. Both legs use exact decimal arithmetic;
   * doing it with `Number()` would put a float in the middle of a money path at SYP
   * magnitudes, which is the range where doubles stop representing every integer.
   *
   * Conversion is deliberately NOT silent: the resulting transaction records the
   * converted amount, and the rate used is logged, because a customer looking at a
   * $14.46 credit for a 10.000 JOD compensation needs that to be explicable.
   */
  private async intoWalletCurrency(
    amount: string,
    fromCurrencyId: string,
    wallet: WalletBalance,
  ): Promise<string> {
    if (fromCurrencyId === wallet.currencyId) return amount;

    const from = await this.currencyCode(fromCurrencyId);

    const fromRate = await this.fx.rateToSyp(from);
    const toRate = await this.fx.rateToSyp(wallet.currencyCode);

    const inSyp = multiplyDecimalStrings(amount, fromRate, MONEY_SCALE);
    /*
      Quantised to the WALLET's own decimals, not to the carrying scale.

      A division at scale 3 produces a third decimal for every currency, and $9.293 is not an
      amount anybody can settle — it would sit in a USD balance that can only ever pay whole
      cents. A JOD wallet keeps all three, because JOD has three.
    */
    const converted = quantise(
      divideDecimalStrings(inSyp, toRate, MONEY_SCALE),
      wallet.currencyDecimals,
    );

    this.logger.log(
      `Wallet movement converted ${amount} ${from} to ${converted} ` +
        `${wallet.currencyCode} via SYP (${from}→SYP ${fromRate}, ` +
        `${wallet.currencyCode}→SYP ${toRate}).`,
    );

    return converted;
  }

  private async currencyCode(currencyId: string): Promise<string> {
    const rows = await this.db.execute<{ code: string }>(sql`
      SELECT code FROM currencies WHERE id = ${currencyId}
    `);

    const code = rows.rows[0]?.code;
    if (!code) throw badRequest(ERROR.GEO_CURRENCY_UNKNOWN);

    return code;
  }

  /**
   * The customer's balance, or null when they have never had one.
   *
   * Null rather than a synthetic zero wallet: "you have no wallet" and "your wallet
   * is empty" are different facts, and only the second one should render a
   * statement link.
   */
  async findByCustomer(customerProfileId: string): Promise<WalletBalance | null> {
    const rows = await this.db.execute<{
      id: string;
      balance: string;
      restricted_balance: string;
      currency_id: string;
      code: string;
      decimals: number;
    }>(sql`
      SELECT w.id, w.balance::text AS balance,
             w.restricted_balance::text AS restricted_balance,
             w.currency_id, cur.code, cur.decimals
      FROM wallets w
      JOIN currencies cur ON cur.id = w.currency_id
      WHERE w.customer_profile_id = ${customerProfileId}
        AND w.deleted_at IS NULL
    `);

    const row = rows.rows[0];
    if (!row) return null;

    return {
      walletId: row.id,
      balance: row.balance,
      restrictedBalance: row.restricted_balance,
      currencyId: row.currency_id,
      currencyCode: row.code,
      currencyDecimals: Number(row.decimals),
    };
  }

  /**
   * The balance, split into the part that came from gift cards and the rest.
   *
   * Bashar, 2026-08-11: محفظتي should show «رصيد بطاقات الهدايا ٢٥$» and «الرصيد الحالي ١٠$» with
   * «المجموع المتاح للإنفاق ٣٥$» beneath them.
   *
   * ## The split needs a spending ORDER, and this is it
   *
   * A wallet holds ONE balance — one row, one number — so "how much of it came from a gift card" has no
   * answer until you decide which money is spent first. Nothing in the schema records that, because
   * nothing needs to: a debit reduces the balance and every currency unit in it is identical.
   *
   * Two rules together, and the second exists because of a rule Bashar added the same day — a gift card
   * may only be BOUGHT with الرصيد الحالي, never with gift money:
   *
   * 1. **Gift money is spent first** on ordinary spending — a booking, a fee.
   * 2. **Buying a gift card does not touch it**, so that debit is excluded from what consumes it.
   *
   *     gift = clamp(Σ gift_card_transfer CREDITS − Σ debits OTHER THAN a card purchase, 0, balance)
   *
   * The exclusion in (2) is not a nicety; without it the two rules contradict each other. Gift 25 and
   * cash 10, then a 10 card bought out of cash: the balance is 25, and a rule that let that debit
   * consume gift money would report gift 15 and cash 10 — claiming a purchase came from money it was
   * forbidden to use. With the exclusion it reports gift 25 and cash 0, which is what happened.
   *
   * Worked through the rest: a $25 card redeemed onto a $10 refund balance shows 25 and 10. Spend $20 on
   * a stay and it shows 5 and 10 — the gift went first. Spend $30 and it shows 0 and 5. The two parts
   * always sum to the balance, which is the one invariant a reader can check for themselves.
   *
   * Gift-first for ordinary spending is the conservative choice: promotional money is the part that can
   * carry an expiry, so spending it first never tells somebody they still hold gift money they have used.
   *
   * A `gift_card_transfer` DEBIT can only be a card purchase — that reason is written in exactly two
   * places, the redemption credit and the purchase debit — so the predicate is exact rather than a guess.
   *
   * ## What it assumes
   *
   * That `balance` equals the sum of its history. Every movement this service makes writes a
   * `wallet_transactions` row, so that holds for any wallet the app has touched — but a balance set
   * DIRECTLY, with no row behind it, is money the derivation cannot attribute, and the clamp then hands
   * it to the gift side. The testbed used to seed exactly that, and محفظتي showed «الرصيد الحالي ٠$» on a
   * wallet that had never seen a gift card; `seed-testbed.ts` now writes the opening credit too.
   *
   * The `least(…, balance)` clamp is defensive rather than load-bearing. With a complete history and the
   * cash-only purchase rule enforced, gift-credited minus gift-consumed cannot exceed the balance: card
   * purchases are capped at the cash part, so the cash part can never go negative.
   *
   * ## Why derived rather than a second column
   *
   * A `gift_balance` column would have to be kept in step by every debit in the system, and the first
   * one that forgot would produce two numbers that disagree about the same money. Derivation cannot
   * drift: it is computed from the same append-only rows the statement is drawn from.
   *
   * ## Why it is not on `findByCustomer`
   *
   * That method is on the checkout and gift-purchase paths, which need a balance and a currency and
   * nothing else. This aggregate is one indexed pass over `wallet_transactions_wallet_idx` per call —
   * cheap for a statement a person reads, and not worth paying for on every write path.
   *
   * The arithmetic stays in SQL, in `numeric`. Doing it in JavaScript would put money through a float.
   * The result is cast to `numeric(15, 3)` — the column's own type — because `greatest(0, …)` otherwise
   * yields an integer zero and an empty gift part would print as "0" beside balances reading "35.000".
   * It must track the column: while this said `numeric(14, 2)` after the columns went to scale 3, one
   * field of this very object came back with two decimals and its neighbour with three.
   */
  async composition(
    customerProfileId: string,
  ): Promise<(WalletBalance & { giftBalance: string }) | null> {
    const rows = await this.db.execute<{
      id: string;
      balance: string;
      restricted_balance: string;
      currency_id: string;
      code: string;
      decimals: number;
      gift_balance: string;
    }>(sql`
      SELECT w.id, w.balance::text AS balance,
             w.restricted_balance::text AS restricted_balance,
             w.currency_id, cur.code, cur.decimals,
             greatest(
               0,
               least(
                 coalesce(moved.gift_credited, 0) - coalesce(moved.spent_from_gift, 0),
                 w.balance
               )
             )::numeric(15, 3)::text AS gift_balance
      FROM wallets w
      JOIN currencies cur ON cur.id = w.currency_id
      LEFT JOIN LATERAL (
        SELECT
          sum(CASE WHEN t.direction = 'credit' AND t.reason = 'gift_card_transfer'
                   THEN t.amount ELSE 0 END) AS gift_credited,
          sum(CASE WHEN t.direction = 'debit' AND t.reason <> 'gift_card_transfer'
                   THEN t.amount ELSE 0 END) AS spent_from_gift
        FROM wallet_transactions t
        WHERE t.wallet_id = w.id
      ) moved ON true
      WHERE w.customer_profile_id = ${customerProfileId}
        AND w.deleted_at IS NULL
    `);

    const row = rows.rows[0];

    if (!row) return null;

    return {
      walletId: row.id,
      balance: row.balance,
      restrictedBalance: row.restricted_balance,
      currencyId: row.currency_id,
      currencyCode: row.code,
      currencyDecimals: Number(row.decimals),
      giftBalance: row.gift_balance,
    };
  }

  /**
   * One page of the customer's statement, newest first.
   *
   * Keyset-paginated on `(created_at, id)` against the existing
   * `wallet_transactions_wallet_idx`, so page 500 costs what page 1 costs. The id
   * tiebreaker is load-bearing: two movements in the same transaction share a
   * `created_at` to the microsecond, and without it one of them would be skipped
   * across a page boundary.
   */
  async listTransactions(
    walletId: string,
    query: CursorQuery,
  ): Promise<CursorPage<WalletStatementEntry>> {
    let after: { sortKey: string; id: string } | null = null;

    if (query.cursor !== undefined) {
      after = decodeCursor(query.cursor);

      // A 400, never a silent restart from page 1 — see BookingsService.list.
      if (!after) throw badRequest(ERROR.REQUEST_CURSOR_INVALID);
    }

    /**
     * Row comparison, not two chained conditions. `(a, b) < (x, y)` is one
     * lexicographic test the planner can satisfy from the `(wallet_id, created_at)`
     * index, and it is far harder to get subtly wrong than the equivalent
     * `a < x OR (a = x AND b < y)`.
     *
     * The timestamp is compared at the precision it was read at — see the note on
     * `encodeCursor`. A millisecond-truncated bound here silently ends the
     * statement at the first page.
     */
    const keyset = after
      ? sql`AND (wt.created_at, wt.id) < (${after.sortKey}::timestamptz, ${after.id}::uuid)`
      : sql``;

    // One extra row reveals whether a further page exists, without a COUNT over
    // the whole trail.
    const rows = await this.db.execute<{
      id: string;
      direction: string;
      reason: string;
      amount: string;
      balance_after: string;
      booking_reference: string | null;
      note: string | null;
      created_at: string;
    }>(sql`
      SELECT wt.id,
             wt.direction::text     AS direction,
             wt.reason::text        AS reason,
             wt.amount::text        AS amount,
             wt.balance_after::text AS balance_after,
             b.reference            AS booking_reference,
             wt.note,
             -- ISO 8601 at microsecond precision: PostgreSQL's own text rendering
             -- ("2026-07-30 19:48:31.476+00") is neither ISO nor safely parseable
             -- by a strict client, and truncating to milliseconds here would break
             -- the keyset bound below.
             to_char(wt.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
               AS created_at
      FROM wallet_transactions wt
      LEFT JOIN bookings b ON b.id = wt.booking_id
      WHERE wt.wallet_id = ${walletId}
      ${keyset}
      ORDER BY wt.created_at DESC, wt.id DESC
      LIMIT ${query.limit + 1}
    `);

    const hasMore = rows.rows.length > query.limit;
    const page = hasMore ? rows.rows.slice(0, query.limit) : rows.rows;
    const last = page.at(-1);

    return {
      items: page.map((row) => ({
        id: row.id,
        direction: row.direction as 'credit' | 'debit',
        reason: row.reason as WalletTxnReason,
        amount: row.amount,
        balanceAfter: row.balance_after,
        bookingReference: row.booking_reference,
        note: row.note,
        createdAt: row.created_at,
      })),
      // The raw microsecond key, not a Date — see encodeCursor.
      nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null,
    };
  }

  /**
   * Recomputes the balance from the immutable trail.
   *
   * The transactions are the authority; `wallets.balance` is a cache. This is what
   * a reconciliation job compares against, and what the tests assert after
   * concurrent movements — a drift here means the lock or the transaction boundary
   * has been broken by a later change.
   */
  async sumTransactions(walletId: string): Promise<string> {
    const rows = await this.db.execute<{ total: string }>(sql`
      SELECT COALESCE(SUM(
        CASE WHEN direction = 'credit' THEN amount ELSE -amount END
      ), 0)::text AS total
      FROM wallet_transactions
      WHERE wallet_id = ${walletId}
    `);

    return fromMinor(toMinor(rows.rows[0]?.total ?? '0', MONEY_SCALE), MONEY_SCALE);
  }

  /**
   * The same recomputation for the restricted part.
   *
   * `restricted_balance` stands in exactly the relation to `restricted_amount` that `balance`
   * stands in to `amount`, so it gets the same treatment: the cache is a read optimisation and the
   * append-only rows are the authority. A finance screen showing one beside the other is how drift
   * in the number that GATES A PAYOUT gets noticed by the person who would authorise it.
   */
  async sumRestricted(walletId: string): Promise<string> {
    const rows = await this.db.execute<{ total: string }>(sql`
      SELECT COALESCE(SUM(
        CASE WHEN direction = 'credit' THEN restricted_amount ELSE -restricted_amount END
      ), 0)::text AS total
      FROM wallet_transactions
      WHERE wallet_id = ${walletId}
    `);

    return fromMinor(toMinor(rows.rows[0]?.total ?? '0', MONEY_SCALE), MONEY_SCALE);
  }
}
