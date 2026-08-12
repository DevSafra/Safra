import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { createRollbackDatabase, type Database } from '@safra/db';

/**
 * References must survive the millionth row.
 *
 * ## The ceiling this exists to hold open
 *
 * Twelve tables carry a human-readable reference — `CUS-000042`, `BKG-2026-000042`, `PAY-000042` —
 * and every default was `lpad(nextval(…)::text, 6, '0')`. `lpad` TRUNCATES when its input is longer
 * than the width, keeping the first six characters: `lpad('1000000', 6, '0')` is `'100000'`. So the
 * millionth row was handed the reference the hundred-thousandth row already had — and because the
 * last digit is what falls off, TEN consecutive counter values then map to one reference.
 *
 * The unique index made that a failed INSERT rather than two bookings quoting one number to two
 * customers. That is the better of the two failures and still a hard ceiling of 999,999 rows on
 * customers, bookings, payments, properties, reviews, payouts, disputes, conversations and gift
 * cards — at volumes this platform is specified for: rule 2 targets 1M users and
 * `docs/load-testing.md` calls for 5M bookings.
 *
 * Found on 2026-08-12 by generating those volumes: `customer_profiles` aborted on the row after
 * 999,999. It had never been reached because no environment had ever held a million of anything.
 *
 * ## Why the test drives the SEQUENCE rather than inserting a million rows
 *
 * `setval` puts the counter where the bug lives. Inserting 999,999 rows to reach the same place
 * would take minutes and prove the same thing.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('reference numbering past a million', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  beforeEach(async () => {
    await harness.begin();
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  /** The helper every reference default now goes through. */
  const referenceNumber = async (n: string): Promise<string> => {
    const rows = await db.execute<{ v: string }>(
      sql`SELECT reference_number(${n}::bigint) AS v`,
    );

    return rows.rows[0]?.v ?? '';
  };

  it('pads below a million exactly as before, so no existing reference changes', async () => {
    expect(await referenceNumber('1')).toBe('000001');
    expect(await referenceNumber('42')).toBe('000042');
    expect(await referenceNumber('999999')).toBe('999999');
  });

  /** The bug, stated: past the width, references simply grow a digit instead of wrapping. */
  it('grows a digit past a million instead of truncating', async () => {
    expect(await referenceNumber('1000000')).toBe('1000000');
    expect(await referenceNumber('1000001')).toBe('1000001');
    expect(await referenceNumber('12345678')).toBe('12345678');
  });

  /**
   * And the old expression, side by side, so the failure is documented rather than remembered.
   *
   * If somebody reintroduces `lpad` for a reference, this is the line that explains why the review
   * comment says no.
   */
  it('shows what lpad did, which is collapse consecutive counters onto one value', async () => {
    /*
      `lpad` truncates on the RIGHT, keeping the first six characters. So a seven-digit counter loses
      its last digit: ten consecutive values become one reference, and that reference is the one
      already issued at a tenth of the counter. `10000000` lands on '100000' too.
    */
    const collapsed = await db.execute<{
      first: string;
      tenth: string;
      eleventh: string;
      older: string;
    }>(sql`
      SELECT lpad('1000000'::text, 6, '0') AS first,
             lpad('1000009'::text, 6, '0') AS tenth,
             lpad('1000010'::text, 6, '0') AS eleventh,
             lpad('100000'::text,  6, '0') AS older
    `);

    const row = collapsed.rows[0];

    /* Ten counter values, one reference. */
    expect(row?.first).toBe('100000');
    expect(row?.tenth).toBe('100000');
    expect(row?.eleventh).toBe('100001');
    /* And it is not a new reference: row 100,000 was given it long ago. */
    expect(row?.older).toBe(row?.first);
  });

  /**
   * End to end through a real DEFAULT, because the helper being right is not the claim — the claim
   * is that inserting across the boundary works.
   *
   * ## Over a TEMPORARY sequence and table, never the shared ones
   *
   * The obvious version of this test is `setval('customer_reference_seq', 999998)` followed by three
   * inserts into `customer_profiles`. It was written that way first and it is wrong twice over.
   *
   * **`setval` is not transactional.** The rollback harness discards the rows and the SEQUENCE KEEPS
   * THE NEW POSITION, so running the test advanced the development database's real counter past a
   * million permanently — every customer created afterwards silently got a seven-digit reference,
   * and running it a few times left the sequence at 1,000,444. A test may not leave that behind.
   *
   * **And it is unsafe under parallelism.** vitest runs files concurrently; another suite inserting a
   * profile between the `setval` and the assertions would take one of the values this test expects.
   *
   * `CREATE TEMP SEQUENCE` and `CREATE TEMP TABLE` are both transactional and session-local, so this
   * exercises the identical DEFAULT expression with nothing shared and nothing to restore.
   */
  it('inserts across the boundary without colliding', async () => {
    await db.execute(sql`CREATE TEMP SEQUENCE ceiling_seq START 999999`);
    await db.execute(sql`
      CREATE TEMP TABLE ceiling_rows (
        reference text NOT NULL UNIQUE
          DEFAULT 'CUS-' || reference_number(nextval('ceiling_seq'))
      )
    `);

    const made: string[] = [];

    for (let i = 0; i < 3; i += 1) {
      const row = await db.execute<{ reference: string }>(sql`
        INSERT INTO ceiling_rows DEFAULT VALUES RETURNING reference
      `);

      made.push(row.rows[0]?.reference ?? '');
    }

    expect(made).toStrictEqual(['CUS-999999', 'CUS-1000000', 'CUS-1000001']);
    expect(new Set(made).size, 'three inserts, three distinct references').toBe(3);
  });

  /**
   * The rule, enforced rather than remembered: no reference default may use `lpad` again.
   *
   * Read out of the live schema, so it covers a table added next year by somebody who copied an
   * older default — which is exactly how all twelve came to share one bug.
   */
  it('leaves no reference default using lpad', async () => {
    const defaults = await db.execute<{ table_name: string; column_default: string }>(sql`
      SELECT table_name, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name = 'reference'
        AND column_default LIKE '%lpad%'
    `);

    expect(
      defaults.rows.map((row) => row.table_name),
      'these reference defaults still truncate past 999999: use reference_number(nextval(...))',
    ).toStrictEqual([]);
  });
});
