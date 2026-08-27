import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import {
  CASCADE_HANDLES,
  CASCADE_ROOTS,
  findUnhandledReferences,
} from './testbed-cascade.js';

/**
 * `db:testbed` can still be run.
 *
 * ## Why a test guards a developer script
 *
 * Because the script is the RESET, and several specs consume a fixture per run —
 * `customer-gifts.spec.ts` opens one dispute, `booking-actions.spec.ts` spends one
 * `pending_payment` booking, `enforcement.spec.ts` raises one violation. When the reset stops
 * working the suite degrades a little every day and there is no way back, which is what happened
 * between 2026-08-23 and 2026-08-27: all 32 (booking × reason) dispute pairs were spent and the
 * remedy the failure message itself printed could not run.
 *
 * ## What had actually rotted
 *
 * The cascade is a hand-written list of tables in foreign-key order. TEN were missing — three off
 * a booking (`booking_verifications`, `booking_internal_notes`, `coupon_redemptions`), one off a
 * unit, and six off a partner including the contract, its signatures, the employee roster and the
 * payout account. Every one arrived with a feature; none had a row on a fixture yet, so the reset
 * kept working right up until one did.
 *
 * That is why this is checked against the DATABASE and not against a list somebody keeps in
 * `packages/db/src/schema`: the database is what refuses the delete, and it is the only thing that
 * knows about a relationship added five minutes ago.
 *
 * ## It fails on the commit that adds the table
 *
 * Which is the whole point. A developer adding `booking_verifications` sees this go red beside
 * their own change, with the table named, rather than somebody meeting a truncated
 * `Failed query: DELETE FROM bookings` three weeks later.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb("the testbed's cleanup cascade", () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  beforeEach(() => harness.begin());
  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  it('covers every table that references something the reset deletes', async () => {
    const missing = await findUnhandledReferences(db);

    expect(
      missing.map((row) => `${row.child} → ${row.parent}`),
      'These reference a table `db:testbed` deletes and are not in its cascade, so the reset ' +
        'will stop on a foreign key. Add a DELETE in `build()` before the parent it points at, ' +
        'and add its name to `CASCADE_HANDLES`.',
    ).toStrictEqual([]);
  });

  /**
   * And the check is asking a real question.
   *
   * A `CASCADE_ROOTS` that had lost its entries would satisfy the assertion above while inspecting
   * nothing — the vacuous pass this suite's own history keeps producing. Every root must also be a
   * table the database actually has, or the catalogue query silently matches nothing.
   */
  it('names roots the database actually has', async () => {
    expect(CASCADE_ROOTS.length).toBeGreaterThanOrEqual(12);

    const known = await db.execute<{ table_name: string }>(sql`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`);

    const present = new Set(known.rows.map((row) => row.table_name));

    expect(CASCADE_ROOTS.filter((table) => !present.has(table))).toStrictEqual([]);
    expect([...CASCADE_HANDLES].filter((table) => !present.has(table))).toStrictEqual([]);
  });
});
