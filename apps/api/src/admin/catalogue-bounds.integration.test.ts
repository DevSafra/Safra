import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

/**
 * كتالوج المنصّة renders five tables unpaginated, and this is what keeps that honest.
 *
 * ## The exception, and why these five qualify
 *
 * «Every table is paginated» has one documented exception: reference data bounded by the BUSINESS
 * rather than by usage, where the screen exists to show the COMPLETE set. `geo-bounds` holds the
 * geography screen to that. These five make the same claim and, until now, nothing held them to it:
 *
 * - **amenities, cancellation policies, partner types** — the screen's own docblock says «if any of
 *   them outgrows a screen it belongs in that test», meaning `geo-bounds`. None of them was ever
 *   added to it. The sentence described an intention nobody had implemented.
 * - **the two FAQs** (2026-09-28) — added with the same claim in the same shape. An operator reads
 *   an FAQ top to bottom; past a screenful it has stopped being frequently-asked, which is the
 *   business bound doing the work.
 *
 * ## Why a test rather than a comment
 *
 * Bashar, 2026-09-28: *"I do not want unsupported exceptions in the codebase."* A comment saying
 * «these stay small» is a hope, and `.claude/CLAUDE.md` is explicit that an exception without a
 * test that holds it to account is how a rule decays. The alarm is the point: at row 200 the suite
 * fails and names the work, instead of an operator meeting a screen that scrolls for ever.
 *
 * The thresholds are deliberately generous. They are not «how many we expect», they are «past here
 * this is no longer a reference list and needs paging like every other table».
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** Past these, كتالوج المنصّة needs the same paging every other registry has. */
const BOUNDS = {
  /** Ticked on a listing form and grouped in the search sidebar; past 60 the sidebar needs sections. */
  amenities: 60,
  /** A refund ladder per policy. A business does not operate twenty of these. */
  cancellation_policies: 20,
  partner_types: 20,
  /**
   * Asked of EVERY partner about EVERY listing, so this one has a second cost the others do not:
   * each question is a box on the partner's form. Forty is already a form nobody finishes.
   */
  property_faq_questions: 40,
  /** Rendered in full on every property page — see the public cap in `@safra/contracts`. */
  general_faq_entries: 40,
} as const;

describeIfDb('كتالوج المنصّة stays a reference list', () => {
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
          `Give it a page size and a TablePagination like every other registry — see ` +
          `apps/admin/src/app/catalogue/page.tsx and the rule in .claude/CLAUDE.md.`,
      ).toBeLessThan(bound);
    });
  }

  /*
    The control. Every assertion above passes trivially against a table that does not exist, or a
    name this map spelled wrong — `count(*)` over nothing is zero and zero is less than any bound.
    This proves the queries reach real tables, which is the difference between the exception being
    held to account and merely appearing to be.
  */
  it('is counting tables that actually exist', async () => {
    const names = Object.keys(BOUNDS);

    const result = await db.execute<{ table_name: string }>(sql`
      SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY(${sql.raw(
         `ARRAY[${names.map((n) => `'${n}'`).join(',')}]`,
       )})
    `);

    expect(result.rows.map((r) => r.table_name).sort()).toEqual([...names].sort());
  });
});
