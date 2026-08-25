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

export interface WalletBalance {
  readonly walletId: string;
  readonly balance: string;
  readonly currencyId: string;
  readonly currencyCode: string;
}

export interface WalletMovementResult extends WalletBalance {
  readonly transactionId: string;
  /** What actually moved, after any cross-currency conversion. */
  readonly appliedAmount: string;
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
  async credit(tx: Database, movement: WalletMovement): Promise<WalletMovementResult> {
    return this.move(tx, movement, 'credit');
  }

  /**
   * Subtracts from a balance.
   *
   * Refuses rather than going negative. The wallet is SAFRA's liability to the
   * customer, not a credit line, and a negative balance would silently become a
   * debt the customer never agreed to.
   */
  async debit(tx: Database, movement: WalletMovement): Promise<WalletMovementResult> {
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
    movement: WalletMovement,
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
    movement: WalletMovement,
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

    const nextMinor =
      direction === 'credit' ? currentMinor + appliedMinor : currentMinor - appliedMinor;

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

    await tx.execute(sql`
      UPDATE wallets
      SET balance = ${nextBalance}, updated_at = now()
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
        (wallet_id, direction, reason, amount, currency_id, balance_after,
         booking_id, created_by_user_id, note)
      VALUES (
        ${wallet.walletId}, ${direction}::ledger_direction,
        ${movement.reason}::wallet_txn_reason, ${applied}, ${wallet.currencyId},
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
      appliedAmount: applied,
      currencyId: wallet.currencyId,
      currencyCode: wallet.currencyCode,
    };
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
    movement: WalletMovement,
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
      currency_id: string;
      code: string;
    }>(sql`
      SELECT w.id, w.balance::text AS balance, w.currency_id, cur.code
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
      currencyId: row.currency_id,
      currencyCode: row.code,
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
    const converted = divideDecimalStrings(inSyp, toRate, MONEY_SCALE);

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
      currency_id: string;
      code: string;
    }>(sql`
      SELECT w.id, w.balance::text AS balance, w.currency_id, cur.code
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
      currencyId: row.currency_id,
      currencyCode: row.code,
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
   * The result is cast to `numeric(14, 2)` — the column's own type — because `greatest(0, …)` otherwise
   * yields an integer zero and an empty gift part would print as "0" beside balances reading "35.00".
   */
  async composition(
    customerProfileId: string,
  ): Promise<(WalletBalance & { giftBalance: string }) | null> {
    const rows = await this.db.execute<{
      id: string;
      balance: string;
      currency_id: string;
      code: string;
      gift_balance: string;
    }>(sql`
      SELECT w.id, w.balance::text AS balance, w.currency_id, cur.code,
             greatest(
               0,
               least(
                 coalesce(moved.gift_credited, 0) - coalesce(moved.spent_from_gift, 0),
                 w.balance
               )
             )::numeric(14, 2)::text AS gift_balance
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
      currencyId: row.currency_id,
      currencyCode: row.code,
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
}
