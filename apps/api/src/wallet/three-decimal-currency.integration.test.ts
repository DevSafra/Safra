import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import type { FxRateService } from '../fx/fx-rate.service.js';
import { WalletService } from './wallet.service.js';
import { quantise } from '../common/money.js';

/**
 * JOD has three decimals, and the platform now keeps all three.
 *
 * ## What was wrong
 *
 * `currencies.decimals` has said 3 for JOD since the table was seeded, and two separate things
 * disagreed with it: every money column was `numeric(14, 2)`, and `MONEY_SCALE` was 2. So 10.125
 * JOD was rounded to 10.13 on the way in — not at a boundary anybody had chosen, but at whichever
 * write reached the database first.
 *
 * Nothing had lost money: on 2026-08-26 every booking, unit and payment was USD or SYP. This is the
 * capability arriving before the first row that needs it.
 *
 * ## The two halves, and why both are asserted
 *
 * **Storage** — the column holds the third decimal. **Arithmetic** — a value CREATED by conversion
 * is rounded to the currency's own scale rather than a global one. Fixing only the column would
 * store `10.130`; fixing only the scale would compute 10.125 and then store 10.13. The test for
 * each is written against the currency the other one cannot serve: a USD wallet must NOT acquire a
 * third decimal, and a JOD wallet must not lose one.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** SYP per unit. JOD is worth more than USD, which is what makes the conversion visible. */
const RATES: Record<string, string> = {
  USD: '13000.00000000',
  JOD: '18300.00000000',
  SYP: '1',
};

const fxStub = {
  rateToSyp: (code: string) => {
    const rate = RATES[code];

    if (!rate) throw new Error(`No stub rate for ${code}`);

    return Promise.resolve(rate);
  },
  decimalsOf: (code: string) => Promise.resolve(code === 'JOD' ? 3 : 2),
} as unknown as FxRateService;

describeIfDb('a three-decimal currency', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  const wallet = new WalletService(db, fxStub);

  let profileId = '';

  beforeEach(async () => {
    await harness.begin();

    const made = await db.execute<{ id: string }>(sql`
      INSERT INTO customer_profiles (full_name, email, phone, is_guest)
      VALUES ('نزيل الدينار', 'jod-' || gen_random_uuid() || '@safra.test',
              '+963900000095', false)
      RETURNING id
    `);

    const row = made.rows[0];

    if (!row) throw new Error('Seed produced no customer.');

    profileId = row.id;
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  const idOf = async (code: string): Promise<string> => {
    const rows = await db.execute<{ id: string }>(sql`
      SELECT id FROM currencies WHERE code = ${code}
    `);

    const id = rows.rows[0]?.id;

    if (!id) throw new Error(`${code} is not seeded.`);

    return id;
  };

  /**
   * The assertion the whole change exists for.
   *
   * Watched to fail against `numeric(14, 2)`: the balance came back `10.130`, a fils SAFRA never
   * received and the customer never spent.
   */
  it('keeps the third decimal of a JOD credit', async () => {
    const movement = await wallet.credit(db, {
      customerProfileId: profileId,
      amount: '10.125',
      currencyId: await idOf('JOD'),
      reason: 'sla_compensation',
    });

    expect(movement.appliedAmount, 'nothing was rounded away').toBe('10.125');
    expect(movement.balance).toBe('10.125');

    /* And the DATABASE holds it, not just the value that came back from the service. */
    const stored = await db.execute<{ balance: string; amount: string }>(sql`
      SELECT w.balance::text AS balance, t.amount::text AS amount
      FROM wallets w JOIN wallet_transactions t ON t.wallet_id = w.id
      WHERE w.customer_profile_id = ${profileId}::uuid
    `);

    expect(stored.rows[0]).toStrictEqual({ balance: '10.125', amount: '10.125' });
  });

  /**
   * The other half: a USD wallet must not ACQUIRE a third decimal.
   *
   * The conversion divides, and a division at the carrying scale produces three decimals for every
   * currency. `$9.293` is not an amount anybody can settle — it would sit in a balance that can
   * only ever pay whole cents. Quantising to the wallet's own scale is what stops it, and without
   * that this reads `7.192`.
   */
  it('does not give a USD wallet a fraction of a cent', async () => {
    const movement = await wallet.credit(db, {
      customerProfileId: profileId,
      /* A JOD amount whose conversion does not land on a whole cent. */
      amount: '5.107',
      currencyId: await idOf('JOD'),
      reason: 'sla_compensation',
    });

    expect(movement.currencyCode, 'the wallet was created in the credit currency').toBe(
      'JOD',
    );

    /* Now one that must land in USD: a second wallet, in USD, credited from JOD. */
    const usd = await db.execute<{ id: string }>(sql`
      INSERT INTO customer_profiles (full_name, email, phone, is_guest)
      VALUES ('نزيل الدولار', 'usd-' || gen_random_uuid() || '@safra.test',
              '+963900000096', false)
      RETURNING id
    `);

    const otherProfile = usd.rows[0]?.id ?? '';

    await wallet.credit(db, {
      customerProfileId: otherProfile,
      amount: '1.00',
      currencyId: await idOf('USD'),
      reason: 'sla_compensation',
    });

    const converted = await wallet.credit(db, {
      customerProfileId: otherProfile,
      amount: '5.107',
      currencyId: await idOf('JOD'),
      reason: 'sla_compensation',
    });

    const cents = (converted.appliedAmount.split('.')[1] ?? '').replace(/0+$/, '');

    expect(
      cents.length,
      `«${converted.appliedAmount}» is finer than a cent, which USD cannot pay`,
    ).toBeLessThanOrEqual(2);
  });

  /** And the helper that decides it, on its own — half-up, and never inventing precision. */
  it('rounds to the currency, half-up', () => {
    expect(quantise('9.2934', 2)).toBe('9.290');
    expect(quantise('9.2954', 2)).toBe('9.300');
    expect(quantise('9.2934', 3)).toBe('9.293');
    /* A negative rounds by magnitude, so a debit and a credit of the same size agree. */
    expect(quantise('-9.2954', 2)).toBe('-9.300');
  });
});
