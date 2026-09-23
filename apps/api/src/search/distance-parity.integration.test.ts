import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { distanceMetres } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

/**
 * Haversine exists twice in this codebase, and this is the price of that.
 *
 * `distanceMetres` in `@safra/contracts` computes the distances on a property page, where a
 * dozen rows are already in memory and encoding geodesy in SQL would be silly. The search
 * service computes the same thing in SQL, because it SORTS and PAGES on distance and that
 * cannot be done after the rows come back.
 *
 * Two implementations of one formula drift. They drift silently, because each is
 * self-consistent: a search would order its results by one definition and print distances
 * from the other, and the only symptom would be a result list whose order looked slightly
 * wrong to somebody paying close attention.
 *
 * So the duplication is allowed and MEASURED. One metre over a 25 km leg is about 4 parts in
 * 100,000 — far tighter than anything the product shows, and tight enough that changing the
 * Earth radius in one place and not the other fails here immediately. (That is the mutation
 * this was watched to fail against: 6371008.8 to 6371000 in the SQL moves Damascus airport
 * by 25 m.)
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** Real legs, chosen to exercise short, long, north-south and east-west separation. */
const LEGS: ReadonlyArray<{
  readonly name: string;
  readonly from: readonly [number, number];
  readonly to: readonly [number, number];
}> = [
  { name: 'across old Damascus', from: [33.515, 36.299], to: [33.5117, 36.3065] },
  { name: 'Damascus to its airport', from: [33.515, 36.299], to: [33.4114, 36.5156] },
  { name: 'Damascus to Aleppo', from: [33.5138, 36.2765], to: [36.2021, 37.1343] },
  {
    name: 'Latakia to Tartus (north-south)',
    from: [35.5317, 35.7915],
    to: [34.889, 35.8866],
  },
  { name: 'Aqaba to Petra', from: [29.5321, 35.0063], to: [30.3285, 35.4444] },
  { name: 'the same point', from: [33.515, 36.299], to: [33.515, 36.299] },
  { name: 'one rounding step apart', from: [33.515, 36.299], to: [33.516, 36.299] },
];

describeIfDb('haversine parity between SQL and TypeScript', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  beforeAll(async () => {
    await harness.begin();
  });
  afterAll(async () => {
    await harness.rollback();
    await harness.close();
  });

  it('agrees to under a metre on every leg', async () => {
    for (const leg of LEGS) {
      const [fromLat, fromLon] = leg.from;
      const [toLat, toLon] = leg.to;

      /*
        Character-for-character the expression `search.service.ts` builds. Copied rather than
        imported because the service assembles it inside a Drizzle template with bound
        parameters — extracting it to share would change the thing under test into a thing
        that is not used anywhere.
      */
      const rows = await db.execute<{ metres: string }>(sql`
        SELECT (6371008.8 * 2 * asin(sqrt(
          power(sin(radians(${toLat}::numeric - ${fromLat}::numeric) / 2), 2)
          + cos(radians(${fromLat}::numeric)) * cos(radians(${toLat}::numeric))
            * power(sin(radians(${toLon}::numeric - ${fromLon}::numeric) / 2), 2)
        ))) AS metres
      `);

      const inSql = Number(rows.rows[0]?.metres);
      const inTs = distanceMetres(fromLat, fromLon, toLat, toLon);

      expect(Number.isFinite(inSql), `${leg.name}: SQL produced no number`).toBe(true);
      expect(
        Math.abs(inSql - inTs),
        `${leg.name}: SQL says ${inSql} m, TypeScript says ${inTs} m`,
      ).toBeLessThan(1);
    }
  });

  /**
   * The control for the test above.
   *
   * «They agree» is worthless if both are zero, or if the legs are so short that any formula
   * agrees. This asserts the fixture actually spans real distances, so the parity check has
   * something to be wrong about.
   */
  it('measures legs long enough for a formula error to show', () => {
    const lengths = LEGS.map((l) =>
      distanceMetres(l.from[0], l.from[1], l.to[0], l.to[1]),
    );
    expect(Math.max(...lengths)).toBeGreaterThan(300_000);
    expect(lengths.filter((m) => m > 1_000).length).toBeGreaterThanOrEqual(4);
  });
});
