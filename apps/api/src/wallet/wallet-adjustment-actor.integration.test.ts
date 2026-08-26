import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

/**
 * A manual wallet movement names who made it — and the DATABASE is what says so.
 *
 * ## Why this is a constraint and not a code review
 *
 * Four of the five `wallet_txn_reason` values are the platform moving its own money: a refund, an
 * SLA compensation, a booking payment, a profile claim. Those carry no actor and should not — the
 * same argument §15 makes for a scheduled sweep, where inventing an origin is worse than the
 * absence.
 *
 * `admin_adjustment` is the one a PERSON decides. It is §4.1's sensitive financial operation, it is
 * why المحفظة prints a reason column at all, and a row saying a staff member adjusted a balance
 * without saying WHICH is the single row on this table that means nothing.
 *
 * That rule already existed, in one TypeScript `if` inside `WalletService.move()`. Which is the
 * cover-image lesson exactly: a rule enforced by whichever writer you remembered is not a rule. A
 * seed, a repair script or a second service reaches this table without passing that `if`.
 *
 * ## The controls are the point
 *
 * A test that only watches the bad row bounce cannot tell a working constraint from an INSERT that
 * was broken for some unrelated reason — a missing column, a bad enum cast, a null in a NOT NULL.
 * Both controls below use the same statement and differ only in the field under test.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('a wallet movement made by hand', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  let walletId = '';
  let currencyId = '';
  let staffId = '';

  beforeEach(async () => {
    await harness.begin();

    const seeded = await db.execute<{
      wallet_id: string;
      currency_id: string;
      staff_id: string;
    }>(sql`
      WITH cur AS (
        SELECT id FROM currencies WHERE code = 'USD'
      ), cust AS (
        INSERT INTO customer_profiles (full_name, email, phone, is_guest)
        VALUES ('صاحب المحفظة', 'wal-' || gen_random_uuid() || '@safra.test',
                '+963900000093', false)
        RETURNING id
      ), staff AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('wal-s-' || gen_random_uuid() || '@safra.test', '+963900000094',
                'finance_officer', 'active')
        RETURNING id
      ), w AS (
        INSERT INTO wallets (customer_profile_id, currency_id, balance)
        SELECT cust.id, cur.id, '0.00' FROM cust, cur
        RETURNING id, currency_id
      )
      SELECT w.id AS wallet_id, w.currency_id, staff.id AS staff_id FROM w, staff
    `);

    const row = seeded.rows[0];

    if (!row) throw new Error('Seed produced no wallet.');

    walletId = row.wallet_id;
    currencyId = row.currency_id;
    staffId = row.staff_id;
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  /** The same INSERT every time; only `reason` and the actor change. */
  const insert = (reason: string, actor: string | null): Promise<unknown> =>
    db.execute(sql`
      INSERT INTO wallet_transactions
        (wallet_id, direction, reason, amount, currency_id, balance_after, created_by_user_id)
      VALUES (${walletId}, 'credit', ${reason}::wallet_txn_reason, '1.00', ${currencyId},
              '1.00', ${actor})
    `);

  async function refusal(work: Promise<unknown>): Promise<string> {
    try {
      await work;

      return '';
    } catch (error) {
      const cause = (error as { cause?: { constraint?: string } }).cause;

      /* The constraint NAME, not the message — a message is prose and gets reworded. */
      return cause?.constraint ?? String((error as Error).message);
    }
  }

  it('is refused by the database when it names nobody', async () => {
    expect(await refusal(insert('admin_adjustment', null))).toBe(
      'wallet_transactions_adjustment_has_actor',
    );
  });

  /** Control one: the same row WITH an actor is accepted, so the statement itself is sound. */
  it('is accepted when it names the staff member who made it', async () => {
    expect(await refusal(insert('admin_adjustment', staffId))).toBe('');
  });

  /**
   * Control two: the constraint is one-directional on purpose.
   *
   * Every one of the 50,288 rows on 2026-08-26 had no actor on the other four reasons, and that is
   * a FACT rather than an invariant — a refund a staff member issues by hand is a plausible
   * future, and a constraint forbidding the record of who did it would have to be dropped to allow
   * the right thing.
   */
  it('leaves the platform’s own movements alone', async () => {
    expect(await refusal(insert('refund', null))).toBe('');
    expect(await refusal(insert('sla_compensation', null))).toBe('');
  });
});
