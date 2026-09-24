import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import { RegistryService } from './registry.service.js';

/**
 * «على الخريطة» on العقارات — the filter staff need to chase the 97%.
 *
 * ## What is actually at risk here
 *
 * Not the predicate: `latitude IS NULL` is hard to get wrong. It is the COUNT. The registry prints
 * «٢٠١٧ نتيجة» above the table, and a filter applied to the list but not to the total produces a
 * page that says two thousand results over sixty-seven rows — which the standing rule calls worse
 * than showing no total at all. Both come from one `fromWhere`, and these prove it by comparing
 * the total against the filtered population rather than against a number somebody wrote down.
 *
 * ## And the other half
 *
 * A filter that returned nothing would pass «every row is unplaced» trivially. So each case also
 * asserts the complement: the two filters must partition the unfiltered registry exactly, with no
 * row belonging to both and none to neither.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('the listing registry, filtered by placement', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  const registry = new RegistryService(db);

  beforeEach(async () => {
    await harness.begin();
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  /** What the database says, independently of the service under test. */
  async function truth() {
    const rows = await db.execute<{ all: string; placed: string; unplaced: string }>(sql`
      SELECT count(*) AS all,
             count(*) FILTER (WHERE latitude IS NOT NULL AND longitude IS NOT NULL) AS placed,
             count(*) FILTER (WHERE latitude IS NULL OR longitude IS NULL) AS unplaced
      FROM properties WHERE deleted_at IS NULL
    `);

    const row = rows.rows[0];

    return {
      all: Number(row?.all ?? 0),
      placed: Number(row?.placed ?? 0),
      unplaced: Number(row?.unplaced ?? 0),
    };
  }

  it('has a fixture with some of each, or it proves nothing', async () => {
    const counts = await truth();

    expect(counts.placed, 'the registry must hold some placed listings').toBeGreaterThan(
      0,
    );
    expect(
      counts.unplaced,
      'the registry must hold some unplaced listings',
    ).toBeGreaterThan(0);
  });

  it('counts what it lists — the total follows the filter', async () => {
    const counts = await truth();

    const unfiltered = await registry.properties({ limit: 10, page: 1 });
    const unplaced = await registry.properties({ limit: 10, page: 1, placed: 'no' });
    const placed = await registry.properties({ limit: 10, page: 1, placed: 'yes' });

    expect(unfiltered.total).toBe(counts.all);
    expect(unplaced.total).toBe(counts.unplaced);
    expect(placed.total).toBe(counts.placed);
  });

  it('partitions the registry: every listing is in exactly one half', async () => {
    const unplaced = await registry.properties({ limit: 10, page: 1, placed: 'no' });
    const placed = await registry.properties({ limit: 10, page: 1, placed: 'yes' });
    const unfiltered = await registry.properties({ limit: 10, page: 1 });

    expect(unplaced.total + placed.total).toBe(unfiltered.total);
  });

  it('returns only unplaced rows for placed=no, and says so on each', async () => {
    const page = await registry.properties({ limit: 25, page: 1, placed: 'no' });

    expect(page.items.length).toBeGreaterThan(0);

    for (const item of page.items) {
      expect(item.hasLocation, `${item.reference} was listed as unplaced`).toBe(false);
    }
  });

  it('returns only placed rows for placed=yes, and says so on each', async () => {
    const page = await registry.properties({ limit: 25, page: 1, placed: 'yes' });

    expect(page.items.length).toBeGreaterThan(0);

    for (const item of page.items) {
      expect(item.hasLocation, `${item.reference} was listed as placed`).toBe(true);
    }
  });

  /**
   * Half a pair is not a location, on this screen as much as at submission.
   *
   * A listing carrying a latitude and no longitude cannot be drawn, so it belongs in «غير محدَّد»
   * — and a filter written as `latitude IS NULL` alone would file it under «محدَّد» and hide it
   * from the very list somebody is working through.
   */
  it.each([
    ['latitude only', sql`longitude = NULL`],
    ['longitude only', sql`latitude = NULL`],
  ])('files a listing with %s under unplaced', async (_name, half) => {
    const [victim] = await db
      .execute<{ reference: string }>(
        sql`SELECT reference FROM properties
            WHERE deleted_at IS NULL AND latitude IS NOT NULL AND longitude IS NOT NULL
            ORDER BY id LIMIT 1`,
      )
      .then((r) => r.rows);

    expect(victim, 'the fixture must hold a placed listing to break').toBeDefined();

    await db.execute(
      sql`UPDATE properties SET ${half} WHERE reference = ${victim!.reference}`,
    );

    /*
      Searched BY REFERENCE rather than paged through. The registry holds 2,700 listings and the
      victim is not reliably on page one of anything — an assertion that merely checked «the
      unplaced list is non-empty» passed against two mutations that lost this row entirely, which
      is how this test came to be written this way.
    */
    const asPlaced = await registry.properties({
      limit: 25,
      page: 1,
      placed: 'yes',
      q: victim!.reference,
    });
    const asUnplaced = await registry.properties({
      limit: 25,
      page: 1,
      placed: 'no',
      q: victim!.reference,
    });

    /* It must leave one side AND arrive on the other. Half of that is not a partition. */
    expect(
      asPlaced.items.map((one) => one.reference),
      'a half-placed listing must not be listed as placed',
    ).not.toContain(victim!.reference);

    const found = asUnplaced.items.find((one) => one.reference === victim!.reference);

    expect(found, 'a half-placed listing must appear among the unplaced').toBeDefined();
    expect(found!.hasLocation, 'and must report itself as not on the map').toBe(false);
  });
});
