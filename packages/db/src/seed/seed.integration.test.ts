import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '../index.js';
import { seed } from './seed.js';

/**
 * The reference seed runs on every deploy, and every table it fills is edited from the console.
 *
 * ## The defect (go-live audit, 2026-10-06)
 *
 * Each row was an upsert on its natural key, so the deploy after an operator corrected a city's
 * description, moved a landmark, tuned a cancellation policy or renamed an amenity wrote the seed's
 * version back over it. The console showed the edit as saved; the next release quietly undid it.
 *
 * ## How
 *
 * Inside the rollback harness: change one field of a seeded row in each table the seed writes, run
 * the seed, read the field back. A retired row is checked separately, because a lookup that only
 * sees live rows would "miss" it and insert a second one. The control is a seeded row whose key
 * no longer exists, which the seed must still insert, or a seed that wrote nothing at all would
 * pass every other assertion here.
 *
 * Needs a database the seed has already run against (every developer's, and CI's after
 * `pnpm db:seed`).
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const EDITED = 'عدّله فريق التشغيل';

/** One field per table, as the console would change it. Each `read` returns the field as text. */
const EDITS = [
  {
    table: 'currencies',
    edit: sql`UPDATE currencies SET name_ar = ${EDITED} WHERE code = 'USD'`,
    read: sql`SELECT name_ar AS v FROM currencies WHERE code = 'USD'`,
  },
  {
    table: 'countries',
    edit: sql`UPDATE countries SET name_ar = ${EDITED} WHERE code = 'SY'`,
    read: sql`SELECT name_ar AS v FROM countries WHERE code = 'SY'`,
  },
  {
    table: 'cities',
    edit: sql`UPDATE cities SET description_ar = ${EDITED} WHERE slug = 'damascus'`,
    read: sql`SELECT description_ar AS v FROM cities WHERE slug = 'damascus'`,
  },
  {
    table: 'landmark_kinds',
    edit: sql`UPDATE landmark_kinds SET name_ar = ${EDITED} WHERE code = 'airport'`,
    read: sql`SELECT name_ar AS v FROM landmark_kinds WHERE code = 'airport'`,
  },
  {
    table: 'landmarks',
    edit: sql`UPDATE landmarks SET name_ar = ${EDITED} WHERE slug = 'damascus-city-centre'`,
    read: sql`SELECT name_ar AS v FROM landmarks WHERE slug = 'damascus-city-centre'`,
  },
  {
    table: 'property_types',
    edit: sql`UPDATE property_types SET name_ar = ${EDITED} WHERE code = 'hotel'`,
    read: sql`SELECT name_ar AS v FROM property_types WHERE code = 'hotel'`,
  },
  {
    table: 'amenities',
    edit: sql`UPDATE amenities SET name_ar = ${EDITED} WHERE code = 'wifi'`,
    read: sql`SELECT name_ar AS v FROM amenities WHERE code = 'wifi'`,
  },
  {
    table: 'cancellation_policies',
    edit: sql`UPDATE cancellation_policies SET min_refund_percent = 73 WHERE code = 'moderate'`,
    read: sql`SELECT min_refund_percent::text AS v FROM cancellation_policies WHERE code = 'moderate'`,
    expected: '73',
  },
  {
    table: 'partner_types',
    edit: sql`UPDATE partner_types SET name_ar = ${EDITED} WHERE code = 'accommodation'`,
    read: sql`SELECT name_ar AS v FROM partner_types WHERE code = 'accommodation'`,
  },
];

describeIfDb('the reference seed on a database that already has it', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  beforeEach(() => harness.begin());
  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  const value = async (
    read: (typeof EDITS)[number]['read'],
  ): Promise<string | undefined> => {
    const rows = await db.execute<{ v: string | null }>(read);
    return rows.rows[0]?.v ?? undefined;
  };

  it.each(EDITS.map((one) => [one.table, one] as const))(
    'leaves an edit to %s in place',
    async (_table, { edit, read, expected }) => {
      await db.execute(edit);

      await seed(db);

      expect(await value(read)).toBe(expected ?? EDITED);
    },
  );

  /**
   * `cities` has a partial unique index, so ON CONFLICT cannot see a retired city: a lookup over
   * live rows alone would seed Damascus again beside its own archived row.
   */
  it('does not reinstate or duplicate a city staff retired', async () => {
    await db.execute(sql`UPDATE cities SET deleted_at = now() WHERE slug = 'damascus'`);

    await seed(db);

    const rows = await db.execute<{ live: number; total: number }>(sql`
      SELECT count(*) FILTER (WHERE deleted_at IS NULL)::int AS live, count(*)::int AS total
      FROM cities WHERE slug = 'damascus'
    `);
    expect(rows.rows[0]).toEqual({ live: 0, total: 1 });
  });

  it('does not reinstate an amenity staff retired', async () => {
    await db.execute(sql`UPDATE amenities SET deleted_at = now() WHERE code = 'wifi'`);

    await seed(db);

    const rows = await db.execute<{ live: number }>(sql`
      SELECT count(*) FILTER (WHERE deleted_at IS NULL)::int AS live FROM amenities WHERE code = 'wifi'
    `);
    expect(rows.rows[0]?.live).toBe(0);
  });

  /** The control: a seeded key that is genuinely missing is still inserted. */
  it('inserts a seeded row whose key is missing', async () => {
    await db.execute(
      sql`UPDATE amenities SET code = 'wifi_renamed_by_test' WHERE code = 'wifi'`,
    );

    await seed(db);

    const rows = await db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM amenities WHERE code = 'wifi'
    `);
    expect(rows.rows[0]?.n).toBe(1);
  });
});
