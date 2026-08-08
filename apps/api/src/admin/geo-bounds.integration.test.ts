import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

/**
 * The geography screen's three tables are the one documented exception to "every table is
 * paginated" — and this is what keeps the exception honest.
 *
 * ## Why they are not paginated
 *
 * `countries`, `currencies` and `cities` are REFERENCE data, and the screen exists to show the
 * complete set: an operator about to add a city needs to see which cities already exist, and an
 * operator setting a price needs the whole currency list. Three rows behind a pager is worse than
 * three rows, and the "next page" link would never appear.
 *
 * They are also bounded by the business rather than by usage. SAFRA operates in Syria, Jordan and
 * Lebanon; the roadmap is a handful of countries and tens of cities. That is a different shape from
 * bookings, which grow with every customer.
 *
 * ## Why a test rather than a comment
 *
 * A comment saying "these stay small" is a hope. This is the alarm: if the assumption stops
 * holding, the suite fails and names the work. A pager that never appears teaches nobody anything,
 * whereas a failing test at row 200 is actionable — and the failure message says what to do.
 *
 * The thresholds are deliberately generous. They are not "how many we expect", they are "past here
 * the screen is no longer a reference list and needs paging like every other table".
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** Past these, the geography screen needs the same paging every other table has. */
const BOUNDS = {
  countries: 40,
  currencies: 40,
  /** Cities are the one that actually grows — the product's expansion story is more cities. */
  cities: 150,
} as const;

describeIfDb('the geography screen stays a reference list', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  /* Every row this suite writes is discarded when the test that wrote it ends. */
  let db: Database;

  beforeEach(async () => {
    await harness.begin();

    db = harness.db;
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  for (const [table, bound] of Object.entries(BOUNDS)) {
    it(`${table} is still small enough to render unpaginated (< ${bound})`, async () => {
      const result = await db.execute<{ n: string }>(
        sql`SELECT count(*)::text AS n FROM ${sql.raw(table)} WHERE deleted_at IS NULL`,
      );

      const count = Number(result.rows[0]?.n ?? 0);

      expect(
        count,
        `${table} now holds ${count} rows, past the ${bound} this screen was designed around. ` +
          `Give it a cursor, a page size and a Pager like every other registry — see ` +
          `apps/admin/src/app/geo/page.tsx and the rule in .claude/CLAUDE.md.`,
      ).toBeLessThan(bound);
    });
  }
});
