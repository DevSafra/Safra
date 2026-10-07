import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import { LedgerService } from './ledger.service.js';

/**
 * A balanced group stays balanced in SYP when the rate has a fraction.
 *
 * Every leg's `amount_syp` was rounded on its own, and the balance trigger compares those rounded
 * figures. With a whole-number rate the product never needs rounding, so nobody saw it; with
 * 1.005, a debit of 1.000 is 1.01 SYP while two credits of 0.500 are 0.50 each, and a group that
 * balances to the last fils in its own currency was refused at COMMIT as unbalanced, taking the
 * payment, refund or payout that posted it down with it.
 *
 * The trigger is DEFERRED, so `SET CONSTRAINTS ALL IMMEDIATE` makes it run inside the rollback
 * harness rather than at a commit that never comes.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('a ledger group at a fractional rate', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  const ledger = new LedgerService(db);

  let currencyId = '';

  beforeEach(async () => {
    await harness.begin();

    currencyId =
      (
        await db.execute<{ id: string }>(
          sql`SELECT id FROM currencies WHERE code = 'USD'`,
        )
      ).rows[0]?.id ?? '';
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  const sides = async (entryGroupId: string) =>
    (
      await db.execute<{ debit: string; credit: string }>(sql`
        SELECT COALESCE(SUM(amount_syp) FILTER (WHERE direction = 'debit'), 0)::text  AS debit,
               COALESCE(SUM(amount_syp) FILTER (WHERE direction = 'credit'), 0)::text AS credit
        FROM ledger_entries WHERE entry_group_id = ${entryGroupId}::uuid
      `)
    ).rows[0];

  it.each([
    ['one debit against two credits', ['1.000'], ['0.500', '0.500'], '1.00500000'],
    ['three thirds', ['10.000'], ['3.333', '3.333', '3.334'], '1.33333333'],
    [
      'two debits against three credits',
      ['0.005', '0.005'],
      ['0.003', '0.003', '0.004'],
      '12500.12345678',
    ],
  ])(
    'balances %s in SYP and the trigger accepts it',
    async (_label, debits, credits, rate) => {
      const { entryGroupId } = await ledger.post(
        db,
        [
          ...debits.map((amount) => ({
            account: 'customer_payment' as const,
            direction: 'debit' as const,
            amount,
            description: 'fractional rate probe',
          })),
          ...credits.map((amount) => ({
            account: 'partner_payable' as const,
            direction: 'credit' as const,
            amount,
            description: 'fractional rate probe',
          })),
        ],
        { currencyId, fxRateToSyp: rate },
      );

      await db.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);

      const totals = await sides(entryGroupId);

      expect(totals?.debit).toBe(totals?.credit);
    },
  );

  /* The opposite control: a group that does NOT balance is still refused. */
  it('still refuses a group that is unbalanced in its own currency', async () => {
    await ledger.post(
      db,
      [
        {
          account: 'customer_payment',
          direction: 'debit',
          amount: '1.000',
          description: 'x',
        },
        {
          account: 'partner_payable',
          direction: 'credit',
          amount: '0.900',
          description: 'x',
        },
      ],
      { currencyId, fxRateToSyp: '1.00500000' },
    );

    await expect(db.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`)).rejects.toThrow();
  });
});
