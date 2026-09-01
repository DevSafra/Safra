import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { WalletAdjustmentService } from './wallet-adjustment.service.js';
import { WalletService, withdrawableOf } from './wallet.service.js';
import type { FxRateService } from '../fx/fx-rate.service.js';
import { ERROR } from '@safra/contracts';
import { codeOf } from '../common/errors/app-error.js';

/**
 * Wallet balances against a REAL PostgreSQL.
 *
 * Everything that matters here is a database property: the `FOR UPDATE` row lock
 * that makes concurrent movements safe, the non-negative CHECK, the append-only
 * trigger on `wallet_transactions`, and the deferred trigger that rejects an
 * unbalanced ledger group. A mocked database would assert none of it, and the
 * lost-update bug this service exists to prevent is invisible without real
 * concurrency.
 *
 * **Each test gets its own customer profile.** `wallet_transactions` is append-only
 * by trigger and `wallets` is referenced by it, so neither can be deleted once
 * written. A shared wallet would carry balance between cases and make every
 * assertion depend on execution order.
 *
 * Skipped when DATABASE_URL is unset so local `pnpm test` stays fast; CI
 * provisions a database and runs it.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const ACTOR_ID = '99992222-0000-0000-0000-0000000000b1';

/**
 * FX is stubbed, deliberately.
 *
 * `FxRateService` has its own suite, and it clears `fx_rates` wholesale in its
 * setup — depending on that shared table from a second file would make both suites
 * order-dependent under vitest's parallel runner. What is under test here is the
 * conversion arithmetic and the single-currency invariant, and fixed rates exercise
 * both without the coupling.
 */
const RATES: Record<string, string> = {
  USD: '13000.00',
  EUR: '14000.00',
  JOD: '18800.00',
  SYP: '1',
};

/** Two for everything here; JOD's three is exercised by the currency tests that need it. */
const DECIMALS: Record<string, number> = { USD: 2, EUR: 2, JOD: 3, SYP: 2 };

const fxStub = {
  rateToSyp: (code: string) => {
    const rate = RATES[code];
    if (!rate) throw new Error(`No stub rate for ${code}`);
    return Promise.resolve(rate);
  },
  decimalsOf: (code: string) => {
    const decimals = DECIMALS[code];
    if (decimals === undefined) throw new Error(`No stub decimals for ${code}`);
    return Promise.resolve(decimals);
  },
} as unknown as FxRateService;

describeIfDb('customer wallet', () => {
  /*
    ROLLED BACK, and the four tests that cannot be are in `wallet-concurrency.integration.test.ts`.

    This whole suite used to commit, because a lost-update test needs a real pool of connections and
    a rollback harness pins one. The cost was paid by all twenty-one tests here: every fixture they
    made was permanent, and they surfaced on Bashar's console as rows at the top of المحفظة while he
    was reviewing that screen — «Seed balance for the rollback case.» in English, on an Arabic-only
    console, on 2026-08-26. 12,048 «Wallet Test» profiles had also accumulated since 2026-08-07.

    Only the concurrency cases need to commit. Everything here is a property of one transaction —
    the non-negative CHECK, the append-only trigger, the currency conversion, the balanced ledger
    group — and a rollback harness asserts all of them while leaving nothing behind.
  */
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  let wallet: WalletService;
  let adjustments: WalletAdjustmentService;

  /** A fresh customer per test, so balances never carry between cases. */
  let profileId: string;

  beforeEach(async () => {
    await harness.begin();

    wallet = new WalletService(db, fxStub);
    adjustments = new WalletAdjustmentService(
      db,
      wallet,
      new (await import('../ledger/ledger.service.js')).LedgerService(db),
      fxStub,
      new AuditService(db),
    );

    await db.execute(sql`
      INSERT INTO users (id, email, role)
      VALUES (${ACTOR_ID}::uuid, 'wallet-test-finance@safra.test', 'finance_officer')
      ON CONFLICT DO NOTHING`);

    profileId = await createCustomer(db);
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  // ── Crediting ───────────────────────────────────────────────────────────────

  describe('credit', () => {
    it('creates the wallet on first use and records the movement', async () => {
      const result = await wallet.credit(db, {
        customerProfileId: profileId,
        amount: '10.000',
        currencyId: await currencyId(db, 'USD'),
        reason: 'sla_compensation',
      });

      expect(result.balance).toBe('10.000');
      expect(result.currencyCode).toBe('USD');
      expect(await wallet.sumTransactions(result.walletId)).toBe('10.000');
    });

    it('accumulates across movements', async () => {
      const usd = await currencyId(db, 'USD');

      await wallet.credit(db, {
        customerProfileId: profileId,
        amount: '10.000',
        currencyId: usd,
        reason: 'sla_compensation',
      });
      const second = await wallet.credit(db, {
        customerProfileId: profileId,
        amount: '5.55',
        currencyId: usd,
        reason: 'sla_compensation',
      });

      expect(second.balance).toBe('15.550');
    });

    /**
     * The cached balance is a read optimisation. If it can ever disagree with the
     * append-only trail then one of them is lying about what a customer is owed,
     * and only the trail is admissible.
     */
    it('keeps the cached balance equal to the sum of its transactions', async () => {
      const usd = await currencyId(db, 'USD');
      const amounts = ['0.01', '0.10', '0.20', '33.33', '0.07'];

      for (const amount of amounts) {
        await wallet.credit(db, {
          customerProfileId: profileId,
          amount,
          currencyId: usd,
          reason: 'sla_compensation',
        });
      }

      const current = await wallet.findByCustomer(profileId);

      expect(current?.balance).toBe('33.710');
      expect(await wallet.sumTransactions(current?.walletId ?? '')).toBe('33.710');
    });

    it('rejects a zero or negative movement', async () => {
      const usd = await currencyId(db, 'USD');

      await expect(
        wallet.credit(db, {
          customerProfileId: profileId,
          amount: '0.000',
          currencyId: usd,
          reason: 'sla_compensation',
        }),
      ).rejects.toThrow(/positive amount/i);

      await expect(
        wallet.credit(db, {
          customerProfileId: profileId,
          amount: '-5.00',
          currencyId: usd,
          reason: 'sla_compensation',
        }),
      ).rejects.toThrow(/positive amount/i);
    });

    /**
     * §4.1 — a manual movement that nobody is accountable for must not exist.
     *
     * Asserted on the CODE rather than the wording. This condition is a programming error, not
     * something a customer can cause, so the client is told only "something went wrong" (rule 1:
     * the detail belongs in the log). The old assertion matched `/acting user/i` against the
     * response prose, which made the test a hostage of a message this deliberately made generic.
     */
    it('refuses an admin adjustment with no acting user', async () => {
      const attempt = wallet.credit(db, {
        customerProfileId: profileId,
        amount: '10.000',
        currencyId: await currencyId(db, 'USD'),
        reason: 'admin_adjustment',
        restricted: '0',
      });

      await expect(attempt).rejects.toThrow();
      await expect(attempt.catch(codeOf)).resolves.toBe(ERROR.INTERNAL_ACTOR_REQUIRED);
    });
  });

  // ── Debiting ────────────────────────────────────────────────────────────────

  describe('debit', () => {
    it('reduces the balance', async () => {
      const usd = await currencyId(db, 'USD');

      await wallet.credit(db, {
        customerProfileId: profileId,
        amount: '50.000',
        currencyId: usd,
        reason: 'sla_compensation',
      });

      const spent = await wallet.debit(db, {
        customerProfileId: profileId,
        amount: '19.99',
        currencyId: usd,
        reason: 'booking_payment',
      });

      expect(spent.balance).toBe('30.010');
    });

    /**
     * The wallet is SAFRA's liability to the customer, not a credit line. A
     * negative balance is a debt they never agreed to.
     */
    it('refuses to overdraw', async () => {
      const usd = await currencyId(db, 'USD');

      await wallet.credit(db, {
        customerProfileId: profileId,
        amount: '10.000',
        currencyId: usd,
        reason: 'sla_compensation',
      });

      await expect(
        wallet.debit(db, {
          customerProfileId: profileId,
          amount: '10.01',
          currencyId: usd,
          reason: 'booking_payment',
        }),
      ).rejects.toThrow(/less than/i);

      expect((await wallet.findByCustomer(profileId))?.balance).toBe('10.000');
    });

    it('allows spending the balance down to exactly zero', async () => {
      const usd = await currencyId(db, 'USD');

      await wallet.credit(db, {
        customerProfileId: profileId,
        amount: '10.000',
        currencyId: usd,
        reason: 'sla_compensation',
      });

      const spent = await wallet.debit(db, {
        customerProfileId: profileId,
        amount: '10.000',
        currencyId: usd,
        reason: 'booking_payment',
      });

      expect(spent.balance).toBe('0.000');
    });
  });

  // ── Concurrency ─────────────────────────────────────────────────────────────

  describe('single currency', () => {
    /**
     * The corruption this service was written to stop.
     *
     * A customer compensated once on a USD booking and once on a JOD booking used
     * to have both numbers added into one scalar. 10 + 10 = 20 in a currency that
     * does not exist.
     */
    it('converts a foreign-currency credit instead of adding it as-is', async () => {
      await wallet.credit(db, {
        customerProfileId: profileId,
        amount: '10.000',
        currencyId: await currencyId(db, 'USD'),
        reason: 'sla_compensation',
      });

      const second = await wallet.credit(db, {
        customerProfileId: profileId,
        amount: '10.000',
        currencyId: await currencyId(db, 'JOD'),
        reason: 'sla_compensation',
      });

      // 10 JOD -> 188,000 SYP -> 14.46 USD. NOT 10.00.
      expect(second.appliedAmount).toBe('14.460');
      expect(second.balance).toBe('24.460');
      expect(second.currencyCode).toBe('USD');
    });

    it('never changes the wallet currency after creation', async () => {
      await wallet.credit(db, {
        customerProfileId: profileId,
        amount: '10.000',
        currencyId: await currencyId(db, 'EUR'),
        reason: 'sla_compensation',
      });

      await wallet.credit(db, {
        customerProfileId: profileId,
        amount: '10.000',
        currencyId: await currencyId(db, 'USD'),
        reason: 'sla_compensation',
      });

      expect((await wallet.findByCustomer(profileId))?.currencyCode).toBe('EUR');
    });

    it('records the converted amount on the transaction, not the requested one', async () => {
      await wallet.credit(db, {
        customerProfileId: profileId,
        amount: '10.000',
        currencyId: await currencyId(db, 'USD'),
        reason: 'sla_compensation',
      });

      const movement = await wallet.credit(db, {
        customerProfileId: profileId,
        amount: '10.000',
        currencyId: await currencyId(db, 'JOD'),
        reason: 'sla_compensation',
      });

      const rows = await db.execute<{ amount: string }>(sql`
        SELECT amount::text AS amount FROM wallet_transactions
        WHERE id = ${movement.transactionId}`);

      expect(rows.rows[0]?.amount).toBe('14.460');
    });
  });

  // ── Statement ───────────────────────────────────────────────────────────────

  describe('statement', () => {
    it('returns movements newest first', async () => {
      const usd = await currencyId(db, 'USD');

      for (const amount of ['1.00', '2.00', '3.00']) {
        await wallet.credit(db, {
          customerProfileId: profileId,
          amount,
          currencyId: usd,
          reason: 'sla_compensation',
        });
      }

      const current = await wallet.findByCustomer(profileId);
      const page = await wallet.listTransactions(current?.walletId ?? '', { limit: 20 });

      expect(page.items.map((i) => i.amount)).toStrictEqual(['3.000', '2.000', '1.000']);
      expect(page.items[0]?.balanceAfter).toBe('6.000');
      expect(page.nextCursor).toBeNull();
    });

    /**
     * Movements written in one transaction share a `created_at`. Without the id
     * tiebreaker in the keyset comparison, one of them is skipped at a page
     * boundary — a statement that silently omits a credit.
     */
    it('pages without skipping movements that share a timestamp', async () => {
      const usd = await currencyId(db, 'USD');

      await db.transaction(async (tx) => {
        for (const amount of ['1.000', '2.000', '3.000', '4.000']) {
          await wallet.credit(tx as unknown as Database, {
            customerProfileId: profileId,
            amount,
            currencyId: usd,
            reason: 'sla_compensation',
          });
        }
      });

      const current = await wallet.findByCustomer(profileId);
      const walletId = current?.walletId ?? '';

      const first = await wallet.listTransactions(walletId, { limit: 2 });
      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).not.toBeNull();

      const second = await wallet.listTransactions(walletId, {
        limit: 2,
        cursor: first.nextCursor as string,
      });

      const seen = [...first.items, ...second.items].map((i) => i.amount);

      expect(new Set(seen).size).toBe(4);
      expect(seen.sort()).toStrictEqual(['1.000', '2.000', '3.000', '4.000']);
    });

    it('rejects a malformed cursor rather than restarting from page one', async () => {
      await wallet.credit(db, {
        customerProfileId: profileId,
        amount: '1.00',
        currencyId: await currencyId(db, 'USD'),
        reason: 'sla_compensation',
      });

      const current = await wallet.findByCustomer(profileId);

      await expect(
        wallet.listTransactions(current?.walletId ?? '', {
          limit: 20,
          cursor: 'not-a-cursor',
        }),
      ).rejects.toThrow(/malformed/i);
    });
  });

  // ── Immutability ────────────────────────────────────────────────────────────

  describe('append-only trail', () => {
    it('refuses to rewrite a recorded movement', async () => {
      const movement = await wallet.credit(db, {
        customerProfileId: profileId,
        amount: '10.000',
        currencyId: await currencyId(db, 'USD'),
        reason: 'sla_compensation',
      });

      await expect(
        db.execute(sql`
          UPDATE wallet_transactions SET amount = 999 WHERE id = ${movement.transactionId}`),
      ).rejects.toThrow();
    });

    it('refuses to delete a recorded movement', async () => {
      const movement = await wallet.credit(db, {
        customerProfileId: profileId,
        amount: '10.000',
        currencyId: await currencyId(db, 'USD'),
        reason: 'sla_compensation',
      });

      await expect(
        db.execute(
          sql`DELETE FROM wallet_transactions WHERE id = ${movement.transactionId}`,
        ),
      ).rejects.toThrow();
    });
  });

  // ── Finance adjustment ──────────────────────────────────────────────────────

  describe('manual adjustment', () => {
    it('credits, posts a balanced ledger group and audits the change', async () => {
      const result = await adjustments.adjust(
        profileId,
        {
          amount: '25.000',
          direction: 'credit',
          fund: 'compensation',
          currency: 'USD',
          note: 'تعويض ودّي عن تأخّر تسجيل الوصول.',
        },
        { userId: ACTOR_ID, role: 'finance_officer' },
      );

      expect(result.balance).toBe('25.000');

      /* Restricted in full: goodwill is SAFRA's money and stays inside the platform. */
      expect(result.restrictedApplied).toBe('25.000');
      expect(result.restrictedBalance).toBe('25.000');

      /**
       * The deferred balance trigger would already have rejected an unbalanced
       * group at COMMIT, so reaching here proves it balanced. This asserts the
       * SHAPE — the goodwill went to its own expense account rather than being
       * netted against commission revenue.
       *
       * `wallet_compensation`, not `wallet_adjustment`: once finance states that a credit is
       * goodwill rather than a correction, the books have to agree with the wallet about the same
       * movement (Bashar, 2026-09-01). The correction case is the test below.
       */
      const legs = await db.execute<{ account: string; direction: string }>(sql`
        SELECT account::text AS account, direction::text AS direction
        FROM ledger_entries
        WHERE customer_profile_id = ${profileId}
        ORDER BY account`);

      expect(legs.rows).toStrictEqual([
        { account: 'wallet_compensation', direction: 'debit' },
        { account: 'wallet_credit', direction: 'credit' },
      ]);
    });

    /**
     * The other answer, and it has to reach both places.
     *
     * A correction is the customer's own money going back where it belongs — withdrawable, and an
     * expense account it was never an expense of. Asserted as a PAIR with the test above because
     * the failure worth catching is the two drifting apart: a wallet that says «this is theirs»
     * over books that say «we gave this away» is one movement described two ways, and whichever
     * report somebody opens first becomes the version they act on.
     */
    it('leaves a correction withdrawable, and books it as a correction', async () => {
      const result = await adjustments.adjust(
        profileId,
        {
          amount: '25.000',
          direction: 'credit',
          fund: 'customer',
          currency: 'USD',
          note: 'إعادة مبلغ حُصّل مرتين عن طريق الخطأ.',
        },
        { userId: ACTOR_ID, role: 'finance_officer' },
      );

      expect(result.restrictedApplied).toBe('0.000');
      expect(result.restrictedBalance).toBe('0.000');
      expect(withdrawableOf(result)).toBe('25.000');

      const legs = await db.execute<{ account: string; direction: string }>(sql`
        SELECT account::text AS account, direction::text AS direction
        FROM ledger_entries
        WHERE customer_profile_id = ${profileId}
        ORDER BY account`);

      expect(legs.rows).toStrictEqual([
        { account: 'wallet_adjustment', direction: 'debit' },
        { account: 'wallet_credit', direction: 'credit' },
      ]);
    });

    it('records the balance either side of the adjustment', async () => {
      await adjustments.adjust(
        profileId,
        {
          amount: '25.000',
          direction: 'credit',
          fund: 'compensation',
          currency: 'USD',
          note: 'أول دفعة ودّية.',
        },
        { userId: ACTOR_ID, role: 'finance_officer' },
      );

      await adjustments.adjust(
        profileId,
        {
          amount: '5.00',
          direction: 'debit',
          fund: 'compensation',
          currency: 'USD',
          note: 'تصحيح إضافة زائدة.',
        },
        { userId: ACTOR_ID, role: 'finance_officer' },
      );

      const rows = await db.execute<{ before: unknown; after: unknown }>(sql`
        SELECT before, after FROM audit_log
        WHERE action = 'wallet.adjusted' AND actor_user_id = ${ACTOR_ID}::uuid
        ORDER BY created_at DESC LIMIT 1`);

      const before = rows.rows[0]?.before as { balance?: string } | null;
      const after = rows.rows[0]?.after as { balance?: string; note?: string } | null;

      expect(before?.balance).toBe('25.000');
      expect(after?.balance).toBe('20.000');
      expect(after?.note).toBe('تصحيح إضافة زائدة.');
    });

    /**
     * A failed adjustment must leave nothing behind: no balance change, no ledger
     * entry, no audit row claiming money moved.
     */
    it('rolls the whole movement back when the debit would overdraw', async () => {
      await adjustments.adjust(
        profileId,
        {
          amount: '10.000',
          direction: 'credit',
          fund: 'compensation',
          currency: 'USD',
          note: 'رصيد ابتدائي لحالة التراجع.',
        },
        { userId: ACTOR_ID, role: 'finance_officer' },
      );

      await expect(
        adjustments.adjust(
          profileId,
          {
            amount: '99.00',
            direction: 'debit',
            fund: 'compensation',
            currency: 'USD',
            note: 'This one must not go through.',
          },
          { userId: ACTOR_ID, role: 'finance_officer' },
        ),
      ).rejects.toThrow(/less than/i);

      expect((await wallet.findByCustomer(profileId))?.balance).toBe('10.000');

      const legs = await db.execute<{ count: string }>(sql`
        SELECT COUNT(*)::text AS count FROM ledger_entries
        WHERE customer_profile_id = ${profileId}`);

      // Only the successful credit's two legs.
      expect(legs.rows[0]?.count).toBe('2');
    });

    it('refuses a currency SAFRA does not know', async () => {
      await expect(
        adjustments.adjust(
          profileId,
          {
            amount: '10.000',
            direction: 'credit',
            fund: 'compensation',
            currency: 'ZZZ',
            note: 'Should never be applied.',
          },
          { userId: ACTOR_ID, role: 'finance_officer' },
        ),
      ).rejects.toThrow(/unknown currency/i);
    });
  });
});

/**
 * A customer profile nobody else's test will touch.
 *
 * Not cleaned up, and cannot be: `wallet_transactions` is append-only by trigger
 * and `wallets` is referenced by it, so the profile behind them is undeletable too.
 * CI runs against a fresh database; locally the residue is namespaced
 * `wallet-test-*@safra.test`.
 */
async function createCustomer(db: Database): Promise<string> {
  const id = randomUUID();

  await db.execute(sql`
    INSERT INTO customer_profiles (id, full_name, email, phone)
    VALUES (${id}::uuid, 'Wallet Test', ${`wallet-test-${id}@safra.test`}, '+963900000003')`);

  return id;
}

async function currencyId(db: Database, code: string): Promise<string> {
  const rows = await db.execute<{ id: string }>(
    sql`SELECT id FROM currencies WHERE code = ${code}`,
  );

  const id = rows.rows[0]?.id;
  if (!id) throw new Error(`Currency ${code} is not seeded.`);

  return id;
}
