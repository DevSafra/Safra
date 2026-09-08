import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, afterAll, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '../index.js';
import { INVARIANTS } from './load-invariants.js';

/**
 * Proof that «every captured payment is in the books» can see the violation it is named after.
 *
 * ## Why this invariant exists
 *
 * §13.3's central promise is that the ledger entries are written in the SAME transaction as the
 * capture — so a captured payment with no movement cannot happen by timing, only by a capture path
 * that does not post. Nothing was checking it. `docs/FUTURE-WORK.md` carried «15,106 bookings
 * claiming $3.12M payable with no ledger credit» as an open finding, which read as an unbacked
 * liability; measured properly on 2026-09-08 it was the FIXTURE — 0 of the 351 completed-and-paid
 * bookings without a credit had a timeline event or any ledger row, and they were written in
 * bursts of 24 to 48 a minute. A seeder, exactly the pattern this project has mis-read before.
 *
 * What was genuinely missing was the check that would tell the two apart. This is it.
 *
 * ## Watched to fail, over a shadow
 *
 * The same technique the double-booking suite uses, and for the same reason: the invariant's SQL is
 * run verbatim and unqualified, so a TEMP `payments` table shadows the real one and the row it
 * would otherwise be impossible to write — a capture with no ledger movement — simply inserts. No
 * lock is taken on anything shared.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

function invariantSql(name: string): string {
  const found = INVARIANTS.find((row) => row.name === name);

  if (!found) {
    throw new Error(
      `The "${name}" invariant is gone. If it was renamed, rename it here.`,
    );
  }

  return found.sql;
}

const SQL = invariantSql('every captured payment is in the books');

describeIfDb('the captured-payment invariant', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  let db: Database;

  beforeEach(async () => {
    await harness.begin();
    db = harness.db;

    /*
      Both tables shadowed. The invariant joins `payments` to `bookings`, so shadowing only one
      would leave the join reaching 35,000 real rows and the assertions would be about the fixture
      again — which is the whole thing this test exists to stop doing.
    */
    await db.execute(
      sql`CREATE TEMP TABLE bookings (LIKE public.bookings INCLUDING DEFAULTS)`,
    );
    await db.execute(
      sql`CREATE TEMP TABLE payments (LIKE public.payments INCLUDING DEFAULTS)`,
    );
    await db.execute(
      sql`CREATE TEMP TABLE ledger_entries (LIKE public.ledger_entries INCLUDING DEFAULTS)`,
    );
  });

  afterEach(async () => {
    await db.execute(sql`DROP TABLE IF EXISTS ledger_entries`);
    await db.execute(sql`DROP TABLE IF EXISTS payments`);
    await db.execute(sql`DROP TABLE IF EXISTS bookings`);
    await harness.rollback();
  });

  afterAll(() => harness.close());

  /** A booking and a capture, with the ledger movement written or not. */
  async function capture(options: {
    posted: boolean;
    hoursAgo: number;
    /** `initiated` is the abandoned checkout — see the assertion that names it. */
    status?: 'captured' | 'initiated';
  }): Promise<string> {
    const bookingId = crypto.randomUUID();
    const paymentId = crypto.randomUUID();

    await db.execute(sql`
      INSERT INTO bookings (id, unit_id, reference, check_in, check_out, status,
                            customer_profile_id, property_id, partner_id, city_id,
                            guests_adults, base_amount, customer_fee_value, customer_fee_amount,
                            partner_commission_rate, partner_commission_amount,
                            total_amount, partner_payable_amount, currency_id,
                            fx_rate_to_syp, total_syp, cancellation_policy_snapshot, paid_at)
      VALUES (${bookingId}::uuid, gen_random_uuid(), 'BKG-LEDGER-TEST',
              current_date, current_date + 2, 'confirmed'::booking_status,
              gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
              2, '100.00', '9.00', '9.00', '0.0700', '7.00', '109.00', '93.00',
              gen_random_uuid(), '13000.00000000', '1417000.00', '{"code":"flex"}'::jsonb, now())
    `);

    await db.execute(sql`
      INSERT INTO payments (id, booking_id, reference, provider, method, status,
                            amount, currency_id, captured_at)
      VALUES (${paymentId}::uuid, ${bookingId}::uuid, 'PAY-LEDGER-TEST', 'simulator',
              'visa'::payment_method, ${options.status ?? 'captured'}::payment_status, '109.00',
              gen_random_uuid(), now() - (${options.hoursAgo}::int * interval '1 hour'))
    `);

    if (options.posted) {
      await db.execute(sql`
        INSERT INTO ledger_entries (entry_group_id, account, direction, amount, currency_id,
                                    fx_rate_to_syp, amount_syp, booking_id, payment_id,
                                    description)
        VALUES (gen_random_uuid(), 'partner_payable', 'credit', '93.00', gen_random_uuid(),
                '13000.00000000', '1209000.00', ${bookingId}::uuid, ${paymentId}::uuid,
                'the partner payable for a test capture')
      `);
    }

    return paymentId;
  }

  async function violations(): Promise<Record<string, unknown>[]> {
    const found = await db.execute<Record<string, unknown>>(sql.raw(SQL));

    return found.rows;
  }

  it('finds a capture that posted nothing', async () => {
    await capture({ posted: false, hoursAgo: 1 });

    const found = await violations();

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ payment: 'PAY-LEDGER-TEST' });
  });

  /**
   * The control, and it is what makes the assertion above mean anything.
   *
   * An invariant that reported every captured payment would pass the first test perfectly and be
   * useless — «money was captured» is the ordinary case and must never sound the alarm.
   */
  it('leaves a capture that posted its entries alone', async () => {
    await capture({ posted: true, hoursAgo: 1 });

    expect(await violations()).toHaveLength(0);
  });

  /**
   * An attempt that has NOT been captured posts nothing, and must not be reported.
   *
   * ## Why this case exists
   *
   * Because mutation-testing found it missing. Removing `p.status = 'captured'` from the invariant
   * left all three tests green — the fixture only ever created captured payments, so the clause
   * that stops the alarm firing on every abandoned checkout was asserted by nothing. An
   * `initiated` payment with no ledger movement is the ORDINARY case: the customer opened the page
   * and went away, and there is no money to record.
   */
  it('says nothing about an attempt that was never captured', async () => {
    await capture({ posted: false, hoursAgo: 1, status: 'initiated' });

    expect(await violations()).toHaveLength(0);
  });

  /**
   * And the window, asserted rather than trusted.
   *
   * The scope to 24 hours is the deliberate compromise that lets this alarm be believed: the
   * development database holds 53 seeded captures with no movement, and an invariant reporting
   * those on every run would be switched off. So the boundary is part of the contract, and a
   * change to it has to be a change to this test.
   */
  it('says nothing about a capture older than the window', async () => {
    await capture({ posted: false, hoursAgo: 30 });

    expect(await violations()).toHaveLength(0);
  });
});
