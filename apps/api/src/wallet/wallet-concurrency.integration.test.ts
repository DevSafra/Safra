import { randomUUID } from 'node:crypto';

import { inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, schema, type Database } from '@safra/db';

import { WalletService } from './wallet.service.js';
import type { FxRateService } from '../fx/fx-rate.service.js';

/**
 * The four wallet tests that must COMMIT, and nothing else.
 *
 * ## Why this file is separate
 *
 * A lost update is only visible when two transactions genuinely race, which needs a real pool of
 * several connections. `createRollbackDatabase` pins ONE connection inside ONE transaction, so the
 * "concurrent" calls would serialise and every assertion here would pass trivially — the worst kind
 * of green.
 *
 * The price is that everything these tests write is permanent: `wallet_transactions` is append-only
 * by trigger, and `wallets` is referenced by it. Nothing can be deleted once written.
 *
 * That price used to be paid by the WHOLE wallet suite, which lived in one file for this reason —
 * and it showed up on Bashar's console as fixture rows at the top of المحفظة, on the screen he was
 * reviewing. 12,048 «Wallet Test» profiles had also accumulated since 2026-08-07 before an
 * `afterAll` was added. Splitting the four tests that need to commit from the twenty-one that do
 * not means the rest leave nothing behind at all.
 *
 * ## What is still left behind, deliberately
 *
 * The customer profiles are SOFT-deleted below, so العملاء stops showing them while the ledger
 * keeps every reference §13.3 requires it to keep. The movements themselves stay, because a
 * financial record that can be deleted is not one.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** SYP per unit — only USD is used here, so a second rate would be unreachable. */
const fxStub = {
  rateToSyp: () => Promise.resolve('13000.00000000'),
  decimalsOf: () => Promise.resolve(2),
} as unknown as FxRateService;

describeIfDb('concurrent wallet movements', () => {
  let db: Database;
  let wallet: WalletService;

  /** A fresh customer per test, so balances never carry between cases. */
  let profileId: string;

  /** Every customer this file created, so it can take them away again. */
  const created: string[] = [];

  beforeAll(() => {
    /* Six, not one: a pool of one would serialise these into passing trivially. */
    db = createDatabase(DATABASE_URL as string, 6);
    wallet = new WalletService(db, fxStub);
  });

  afterAll(async () => {
    /*
      SOFT-deleted, and that is the only correct option rather than a softer one.

      A hard delete was tried and the database refused it: `ledger_entries` is append-only, guarded
      by `deny_mutation`, because §13.3 requires an immutable record of every financial movement.
      The wallet movements these tests make are real ledger entries, so the profiles they belong to
      can never be removed — and they should not be.
    */
    if (created.length > 0) {
      await db.execute(
        sql`UPDATE customer_profiles SET deleted_at = now()
            WHERE ${inArray(schema.customerProfiles.id, created)}`,
      );
    }

    await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
  });

  beforeEach(async () => {
    profileId = await createCustomer(db);
    created.push(profileId);
  });

  describe('concurrent movements', () => {
    /**
     * The lost update, pinned.
     *
     * Without `FOR UPDATE` both transactions read the same balance, each computes
     * its own successor, and the second write silently discards the first. On a
     * balance that is money vanishing. This is the test that fails if the row lock
     * is ever removed.
     */
    it('does not lose a credit when five arrive at once', async () => {
      const usd = await currencyId(db, 'USD');

      await Promise.all(
        Array.from({ length: 5 }, () =>
          db.transaction((tx) =>
            wallet.credit(tx as unknown as Database, {
              customerProfileId: profileId,
              amount: '10.000',
              currencyId: usd,
              reason: 'sla_compensation',
            }),
          ),
        ),
      );

      const current = await wallet.findByCustomer(profileId);

      expect(current?.balance).toBe('50.000');
      expect(await wallet.sumTransactions(current?.walletId ?? '')).toBe('50.000');
    });

    /**
     * Two debits racing for one balance. Exactly one may win; the database CHECK
     * would catch the other, but the point is that the lock refuses it cleanly
     * first, with an error a customer-facing caller can act on.
     */
    it('cannot be double-spent by two concurrent debits', async () => {
      const usd = await currencyId(db, 'USD');

      await wallet.credit(db, {
        customerProfileId: profileId,
        amount: '10.000',
        currencyId: usd,
        reason: 'sla_compensation',
      });

      const attempts = await Promise.allSettled(
        Array.from({ length: 2 }, () =>
          db.transaction((tx) =>
            wallet.debit(tx as unknown as Database, {
              customerProfileId: profileId,
              amount: '10.000',
              currencyId: usd,
              reason: 'booking_payment',
            }),
          ),
        ),
      );

      expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(1);
      expect((await wallet.findByCustomer(profileId))?.balance).toBe('0.000');
    });

    /**
     * The same guarantee for a caller who did NOT open a transaction.
     *
     * Outside one, node-postgres hands each statement whichever pooled connection
     * is free, so `SELECT … FOR UPDATE` and the `UPDATE` after it can land on
     * different connections and the lock protects nothing. The service opens its
     * own transaction rather than trusting callers to, and this is what proves it —
     * remove the wrapping and these credits start losing each other.
     */
    it('is safe even when the caller passes no transaction', async () => {
      const usd = await currencyId(db, 'USD');

      await Promise.all(
        Array.from({ length: 5 }, () =>
          wallet.credit(db, {
            customerProfileId: profileId,
            amount: '3.33',
            currencyId: usd,
            reason: 'refund',
          }),
        ),
      );

      const current = await wallet.findByCustomer(profileId);

      expect(current?.balance).toBe('16.650');
      expect(await wallet.sumTransactions(current?.walletId ?? '')).toBe('16.650');
    });

    /** Two first-ever movements racing must not both try to create the wallet. */
    it('creates exactly one wallet when two movements race on a new customer', async () => {
      const usd = await currencyId(db, 'USD');

      await Promise.all(
        Array.from({ length: 3 }, () =>
          db.transaction((tx) =>
            wallet.credit(tx as unknown as Database, {
              customerProfileId: profileId,
              amount: '7.00',
              currencyId: usd,
              reason: 'refund',
            }),
          ),
        ),
      );

      const rows = await db.execute<{ count: string }>(sql`
        SELECT COUNT(*)::text AS count FROM wallets
        WHERE customer_profile_id = ${profileId}`);

      expect(rows.rows[0]?.count).toBe('1');
      expect((await wallet.findByCustomer(profileId))?.balance).toBe('21.000');
    });
  });

  // ── Currency ────────────────────────────────────────────────────────────────
});

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
