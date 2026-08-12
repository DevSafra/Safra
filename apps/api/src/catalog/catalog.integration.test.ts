import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import { CatalogService } from './catalog.service.js';

/**
 * The public catalogue, against a real PostgreSQL.
 *
 * ## The bug this exists to catch, and why nothing caught it
 *
 * `cities.categories` is an array of a Postgres ENUM. node-postgres parses arrays only for element
 * types it has a built-in parser for, so selected bare through `db.execute` the column arrives as
 * the LITERAL string `'{historic}'` — while the call's own type generic declares `string[]`. A
 * generic on `db.execute` is an assertion, not a check, so TypeScript was satisfied and every unit
 * test passed.
 *
 * The consumer then swallowed it. `apps/web/src/lib/catalog.ts` validates the response and returns
 * an empty list rather than throwing, which is right for a reference endpoint that blipped and
 * exactly wrong here: the public home page rendered its destinations grid and its city selector
 * EMPTY, permanently, and the only visible symptom was a link crawl covering less of the site than
 * it should. It was found by `e2e/public-routes.spec.ts` and only after a rebuild replaced a
 * long-running stale API process.
 *
 * So this asserts the RUNTIME SHAPE of what the driver hands back, which is the one thing the type
 * system cannot see and the one thing that was wrong.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('CatalogService', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  const catalog = new CatalogService(db);

  /* Read-only, but the harness hands out its connection only inside a transaction. */
  beforeEach(async () => {
    await harness.begin();
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('hands every city its categories as an ARRAY, not as a Postgres literal', async () => {
    const cities = await catalog.cities();

    expect(cities.length, 'the seeded reference cities must exist').toBeGreaterThan(0);

    for (const city of cities) {
      expect(Array.isArray(city.categories), `${city.slug} categories`).toBe(true);

      for (const category of city.categories) {
        expect(typeof category).toBe('string');
        /* The literal would arrive as one string still wearing its braces. */
        expect(category).not.toMatch(/[{}]/);
      }
    }
  });

  /**
   * Otherwise the assertion above passes over nine empty arrays and proves nothing — which is the
   * state the web app was already in, and the state that looked fine.
   */
  it('finds at least one city that actually carries a category', async () => {
    const cities = await catalog.cities();

    expect(cities.some((city) => city.categories.length > 0)).toBe(true);
  });

  /** A destination card shows this count, so a string would render `NaN` cities. */
  it('counts published properties as a number', async () => {
    const cities = await catalog.cities();

    for (const city of cities) {
      expect(Number.isInteger(city.propertyCount), `${city.slug} count`).toBe(true);
    }
  });
});
