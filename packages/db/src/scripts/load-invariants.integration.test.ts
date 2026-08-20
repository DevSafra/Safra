import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '../index.js';
import { INVARIANTS } from './load-invariants.js';

/**
 * Proof that the load test's headline invariant can see the violation it is named after.
 *
 * ## Why this test exists
 *
 * Scenario 2 of `docs/load-testing.md` drives concurrent bookings at a handful of units and asks one
 * question: did two customers get sold the same room? `pnpm load:invariants` is the only thing that
 * can answer it — two requests can both reply 201 and only the database knows where they landed.
 *
 * The check was written as `GROUP BY unit_id, check_in HAVING count(*) > 1`, which finds only the
 * case where two live bookings share an IDENTICAL check-in date. The constraint it stands for
 * forbids any OVERLAP, so Aug 1–5 against Aug 3–7 on one unit — two customers, two shared nights,
 * precisely the failure — returned no rows and printed `ok`.
 *
 * A check that cannot fail is worse than no check, because it is believed. So the query is now
 * tested the only way that means anything: take the constraint away, write the row it would have
 * refused, and require the invariant to find it.
 *
 * ## Why the constraint is dropped inside the transaction
 *
 * There is no other way to create the state. `bookings_no_overlapping_stays_v2` refuses the INSERT,
 * which is exactly right and exactly why a passing invariant proves nothing on its own — the
 * database, not the query, is what keeps the data clean today. The rollback harness makes the DDL
 * disposable: PostgreSQL rolls back `ALTER TABLE … DROP CONSTRAINT` like anything else, so the
 * constraint is back before the next test and the development database is untouched.
 *
 * That also states the dependency plainly: this suite proves the DETECTOR works. The constraint
 * itself is proved by `bookings.integration.test.ts` and by scenario 2's own run.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/**
 * Looked up by name rather than by index, and required rather than skipped.
 *
 * If the invariant is renamed this suite must fail loudly: a test that silently stops covering the
 * thing it was written for is the same failure it is here to prevent, one level up.
 */
function invariantSql(name: string): string {
  const found = INVARIANTS.find((row) => row.name === name);

  if (!found) {
    throw new Error(
      `The "${name}" invariant is gone. It is scenario 2's only verdict — if it was renamed, ` +
        'rename it here; if it was deleted, that is the finding.',
    );
  }

  return found.sql;
}

const DOUBLE_BOOKING_SQL = invariantSql('no double-booked nights');

describeIfDb('the double-booking invariant detects an overlap', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  let db: Database;

  beforeEach(async () => {
    await harness.begin();
    db = harness.db;

    /*
      The constraint has to go before the overlapping row can exist. Inside the harness's
      transaction, so it returns on rollback.
    */
    await db.execute(
      sql`ALTER TABLE bookings DROP CONSTRAINT bookings_no_overlapping_stays_v2`,
    );
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  /**
   * Two live bookings on one unit, staggered rather than identical.
   *
   * `offsetNights` is what the old query could not see: at 0 the two stays start on the same day and
   * a GROUP BY on `check_in` catches them; at anything else it does not, and the room is still sold
   * twice.
   */
  async function overlappingPair(offsetNights: number): Promise<string> {
    const tag = `inv-${Math.random().toString(36).slice(2, 10)}`;

    await db.execute(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1) AS city_id,
               (SELECT id FROM currencies WHERE code = 'USD')           AS currency_id,
               (SELECT id FROM property_types LIMIT 1)                  AS type_id,
               (SELECT id FROM partner_types LIMIT 1)                   AS partner_type_id,
               (SELECT id FROM cancellation_policies LIMIT 1)           AS policy_id
      ), cu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES (${tag} || '-c@safra.test', '+963900000180', 'customer', 'active')
        RETURNING id
      ), pu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES (${tag} || '-p@safra.test', '+963900000181', 'partner', 'active')
        RETURNING id
      ), cp AS (
        INSERT INTO customer_profiles (user_id, full_name, email, phone, is_guest)
        SELECT cu.id, 'ثابت', ${tag} || '-cp@safra.test', '+963900000180', false
        FROM cu RETURNING id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT pu.id, ref.partner_type_id, 'Invariant Test', 'ثابت', ref.city_id, 'x',
               '+963900000181', ${tag} || '-pa@safra.test', 'approved'
        FROM pu, ref RETURNING id, city_id
      ), pr AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, address, status)
        SELECT pa.id, ref.city_id, ref.type_id, ref.policy_id,
               ${tag}, ${tag}, 'Invariant', 'Invariant', 'x', 'published'
        FROM pa, ref RETURNING id, partner_id
      ), un AS (
        INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price,
                           currency_id)
        SELECT pr.id, 'وحدة', 'Unit', 'Einheit', 2, '100.00', ref.currency_id
        FROM pr, ref RETURNING id
      )
      INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                            check_in, check_out, guests_adults, status,
                            base_amount, customer_fee_value, customer_fee_amount,
                            partner_commission_rate, partner_commission_amount,
                            total_amount, partner_payable_amount, currency_id,
                            fx_rate_to_syp, total_syp, cancellation_policy_snapshot)
      SELECT cp.id, un.id, pr.id, pr.partner_id, ref.city_id,
             current_date + 400 + (leg * ${offsetNights}::int),
             current_date + 405 + (leg * ${offsetNights}::int),
             2, 'confirmed'::booking_status,
             '200.00', '1.99', '1.99', '0.0700', '14.00', '201.99', '186.00',
             ref.currency_id, '13000.00000000', '2625870.00', '{"code":"flex"}'::jsonb
      FROM cp, un, pr, ref, generate_series(0, 1) AS leg
    `);

    return tag;
  }

  /** The invariant's own SQL, run the way the CLI runs it. */
  async function violations(): Promise<Record<string, unknown>[]> {
    const found = await db.execute<Record<string, unknown>>(sql.raw(DOUBLE_BOOKING_SQL));

    return found.rows;
  }

  it('finds two stays that start on the same day', async () => {
    await overlappingPair(0);

    expect(await violations()).not.toHaveLength(0);
  });

  /**
   * The regression. Staggered by two nights: five-night stays starting two days apart share three
   * nights, and the old `GROUP BY check_in` query returned nothing at all for it.
   */
  it('finds two stays that overlap without sharing a check-in date', async () => {
    await overlappingPair(2);

    const found = await violations();

    expect(found).not.toHaveLength(0);
    expect(found[0]).toMatchObject({
      stay_a: expect.any(String),
      stay_b: expect.any(String),
    });
  });

  /**
   * The other half of correctness, and the reason the test is `>` and not `>=`.
   *
   * A checkout and the next check-in on the SAME day is the normal case — one guest leaves in the
   * morning, the next arrives in the afternoon. `daterange(check_in, check_out, '[)')` excludes the
   * checkout day for exactly this reason. An invariant that flagged it would fire on a healthy
   * database every day, and an alarm that always sounds gets switched off.
   */
  it('leaves a same-day changeover alone', async () => {
    await overlappingPair(5);

    expect(await violations()).toHaveLength(0);
  });
});
