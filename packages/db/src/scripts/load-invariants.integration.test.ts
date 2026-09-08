import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '../index.js';
import { INVARIANTS } from './load-invariants.js';

/**
 * Proof that the load test's headline invariant can see the violation it is named after.
 *
 * ## Why this test exists
 *
 * Scenario 2 of `docs/load-testing.md` drives concurrent bookings at a handful of units and asks
 * one question: did two customers get sold the same room? `pnpm load:invariants` is the only thing
 * that can answer it — two requests can both reply 201 and only the database knows where they
 * landed.
 *
 * The check was written as `GROUP BY unit_id, check_in HAVING count(*) > 1`, which finds only the
 * case where two live bookings share an IDENTICAL check-in date. The constraint it stands for
 * forbids any OVERLAP, so Aug 1–5 against Aug 3–7 on one unit — two customers, two shared nights,
 * precisely the failure — returned no rows and printed `ok`.
 *
 * A check that cannot fail is worse than no check, because it is believed. So the query is tested
 * the only way that means anything: write the row the constraint would have refused, and require
 * the invariant to find it.
 *
 * ## How the invalid row is written, and why this changed
 *
 * By SHADOWING `bookings` with a temporary table of the same shape, and running the invariant's own
 * SQL — verbatim, unqualified — against that. PostgreSQL searches `pg_temp` before `public`, so
 * `FROM bookings` inside the invariant resolves to the shadow; `LIKE … INCLUDING DEFAULTS` copies
 * the columns and their defaults and NOT the constraints, so the overlapping pair simply inserts.
 *
 * It used to drop the two exclusion constraints inside the harness's transaction. That was correct
 * about rollback and wrong about LOCKS: `ALTER TABLE … DROP CONSTRAINT` takes ACCESS EXCLUSIVE on
 * `bookings` and `booking_units` and holds it until the transaction ends, so every other suite
 * running in parallel that touched a booking blocked behind this one. Measured on 2026-09-08: five
 * assertions in `sla-expiry.integration.test.ts`, one in the payments suite, and this file's own
 * tests failed on different runs — always in a full run, never alone. Recorded as finding 224 and
 * mis-diagnosed twice as ambient data.
 *
 * A temp shadow takes no lock on anything shared, needs no DDL on a real table, and needs no
 * fixture — no users, partners, properties or currencies, because the invariant reads five columns.
 *
 * ## What this does and does not prove
 *
 * It proves the DETECTOR: given overlapping live stays, the SQL reports them; given a same-day
 * changeover, it does not. That the real table cannot hold such a row is a different guarantee,
 * proved by the exclusion constraint and by `bookings.integration.test.ts`. Both are asserted
 * below — the shadow's shape is compared against the real table's so a column rename cannot leave
 * this passing over a table that no longer resembles the one the invariant runs against.
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
      The shadow. `pg_temp` is searched first, so the invariant's unqualified `FROM bookings` reads
      this and not the real table — and `LIKE` without `INCLUDING CONSTRAINTS` is exactly the
      point: the columns are the same, the guarantees are not.
    */
    await db.execute(
      sql`CREATE TEMP TABLE bookings (LIKE public.bookings INCLUDING DEFAULTS)`,
    );
  });

  afterEach(async () => {
    /*
      Dropped explicitly as well as by the rollback. A temp table created inside a transaction goes
      when the transaction does — but the harness keeps ONE connection for the file, and a leftover
      shadow would silently shadow the next test's real table too.
    */
    await db.execute(sql`DROP TABLE IF EXISTS bookings`);
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  /**
   * Two live stays on one unit, staggered rather than identical.
   *
   * `offsetNights` is what the old query could not see: at 0 the two start on the same day and a
   * GROUP BY on `check_in` catches them; at anything else it does not, and the room is still sold
   * twice. At 5 the second begins on the day the first ends, which is a normal changeover.
   */
  async function overlappingPair(offsetNights: number): Promise<string> {
    const unit = crypto.randomUUID();

    await db.execute(sql`
      INSERT INTO bookings (unit_id, reference, check_in, check_out, status,
                            customer_profile_id, property_id, partner_id, city_id,
                            guests_adults, base_amount, customer_fee_value, customer_fee_amount,
                            partner_commission_rate, partner_commission_amount,
                            total_amount, partner_payable_amount, currency_id,
                            fx_rate_to_syp, total_syp, cancellation_policy_snapshot)
      SELECT ${unit}::uuid,
             'INV-' || leg::text,
             current_date + 400 + (leg * ${offsetNights}::int),
             current_date + 405 + (leg * ${offsetNights}::int),
             'confirmed'::booking_status,
             gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
             2, '200.00', '1.99', '1.99', '0.0700', '14.00', '201.99', '186.00',
             gen_random_uuid(), '13000.00000000', '2625870.00', '{"code":"flex"}'::jsonb
      FROM generate_series(0, 1) AS leg
    `);

    return unit;
  }

  /** The invariant's own SQL, run the way the CLI runs it — over the shadow. */
  async function violations(): Promise<Record<string, unknown>[]> {
    const found = await db.execute<Record<string, unknown>>(sql.raw(DOUBLE_BOOKING_SQL));

    return found.rows;
  }

  /**
   * The shadow has the columns the invariant reads, under the names it reads them by.
   *
   * The control that makes every assertion below mean something. A shadow is only a fair stand-in
   * while it resembles the real table; a renamed column would leave the invariant failing against
   * production and passing here, which is the vacuous green this whole file exists to prevent.
   */
  it('shadows the real table faithfully', async () => {
    const columns = await db.execute<{ column_name: string; table_schema: string }>(sql`
      SELECT column_name, table_schema
      FROM information_schema.columns
      WHERE table_name = 'bookings'
        AND column_name IN ('unit_id', 'reference', 'check_in', 'check_out', 'status')
      ORDER BY table_schema, column_name
    `);

    const schemas = new Set(columns.rows.map((row) => row.table_schema));

    expect(schemas.size, 'the shadow and the real table both exist').toBe(2);
    expect(
      [...schemas].some((schema) => schema.startsWith('pg_temp')),
      'and one of them is the temporary shadow',
    ).toBe(true);
    expect(
      columns.rows.length,
      'five columns in each — a rename would show up as a smaller number',
    ).toBe(10);

    /* And the shadow is what the unqualified name reaches, which is the whole mechanism. */
    const reached = await db.execute<{ schema: string }>(sql`
      SELECT n.nspname AS schema
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.oid = 'bookings'::regclass
    `);

    expect(reached.rows[0]?.schema).toMatch(/^pg_temp/);
  });

  it('finds two stays that start on the same day', async () => {
    const unit = await overlappingPair(0);
    const found = await violations();

    expect(found).not.toHaveLength(0);
    expect(found.every((row) => row['unit'] === unit)).toBe(true);
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
   *
   * Over the shadow this is now a statement about the QUERY rather than about the seed: it used to
   * assert that the whole database held no overlap anywhere, so one stray row from a load fixture
   * read as the invariant over-reporting.
   */
  it('leaves a same-day changeover alone', async () => {
    await overlappingPair(5);

    expect(await violations()).toHaveLength(0);
  });
});
