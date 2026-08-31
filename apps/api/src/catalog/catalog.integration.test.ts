import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ERROR } from '@safra/contracts';
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
        /*
          A ROW, with its own names — not a bare code resolved against a catalogue in the web app.
          Each name is asserted separately rather than by shape alone: a category whose Arabic
          name arrived empty would render a blank chip, and `toBeTruthy` on the object would not
          notice. The brace check stays because the aggregate is still jsonb: a literal that
          reached the driver unparsed would arrive as one string wearing its braces.
        */
        expect(typeof category.code).toBe('string');
        expect(category.code).not.toMatch(/[{}]/);
        expect(category.nameAr.length, `${category.code} nameAr`).toBeGreaterThan(0);
        expect(category.nameEn.length, `${category.code} nameEn`).toBeGreaterThan(0);
        expect(category.nameDe.length, `${category.code} nameDe`).toBeGreaterThan(0);
      }
    }
  });

  /**
   * The whole reason الفئات became a table: a category staff ADD must reach the public site.
   *
   * The read was `cities.categories`, a frozen `city_category[]`, so a category created on the
   * console had no enum member and could never appear here — the screen wrote rows the rest of
   * the platform could not see. This inserts one the enum does not contain and asserts it
   * arrives, which is the only version of this assertion the old read could not have passed.
   */
  it('carries a category the enum never had', async () => {
    await db.execute(sql`
      INSERT INTO city_categories (code, name_ar, name_en, name_de, sort_order)
      VALUES ('riverside', 'نهرية', 'Riverside', 'Am Fluss', 99)
    `);

    await db.execute(sql`
      INSERT INTO city_category_links (city_id, category_id)
      SELECT c.id, cc.id
      FROM cities c, city_categories cc
      WHERE cc.code = 'riverside' AND c.is_active AND c.deleted_at IS NULL
      LIMIT 1
    `);

    const cities = await catalog.cities();
    const codes = cities.flatMap((city) => city.categories.map((one) => one.code));

    expect(codes).toContain('riverside');
  });

  /**
   * Otherwise the assertion above passes over nine empty arrays and proves nothing — which is the
   * state the web app was already in, and the state that looked fine.
   */
  it('finds at least one city that actually carries a category', async () => {
    const cities = await catalog.cities();

    expect(cities.some((city) => city.categories.length > 0)).toBe(true);
  });

  /**
   * Closing a market actually closes it — Bashar, 2026-08-31.
   *
   * «When I deactivate a country, its cities will be still activated.» The grid joined `countries`
   * for the code and never looked at its flag, so every city of a closed country stayed in the
   * destinations grid and in the search selector. The confirmation the console shows when closing
   * one NAMES how many cities it affects, which was a promise this read did not keep.
   *
   * Derived, not cascaded: the city keeps its own `is_active`, so re-opening the country restores
   * exactly what was there rather than switching on cities somebody closed deliberately. The last
   * assertion is what holds that — without it a cascade would pass every other case here.
   */
  it('drops the cities of a closed country, and brings back exactly what was there', async () => {
    const before = await catalog.cities();

    expect(before.length, 'the seeded cities must exist').toBeGreaterThan(0);

    const country = before[0]?.countryCode ?? '';
    const theirs = before.filter((one) => one.countryCode === country).map((c) => c.slug);

    expect(theirs.length, 'the first country must have cities').toBeGreaterThan(0);

    /* One of its cities is closed on its own, so re-opening must NOT switch it back on. */
    const closedAlready = theirs[0] ?? '';

    await db.execute(sql`
      UPDATE cities SET is_active = false WHERE slug = ${closedAlready}
    `);
    await db.execute(sql`UPDATE countries SET is_active = false WHERE code = ${country}`);

    const during = await catalog.cities();

    for (const slug of theirs) {
      expect(
        during.map((one) => one.slug),
        `${slug} while the market is closed`,
      ).not.toContain(slug);
    }

    await db.execute(sql`UPDATE countries SET is_active = true WHERE code = ${country}`);

    const after = (await catalog.cities()).map((one) => one.slug);

    for (const slug of theirs) {
      if (slug === closedAlready) continue;
      expect(after, `${slug} comes back`).toContain(slug);
    }

    expect(after, 'a city closed on its own stays closed').not.toContain(closedAlready);
  });

  /**
   * A withdrawn city's PAGE is gone too, not merely unlisted.
   *
   * §5.4's page is indexed, so «somebody holding the URL» includes every search engine that ever
   * crawled it. A market taken off the grid that still answers 200 on its own page is still open
   * to the visitors who matter.
   */
  it('refuses the page of a city that has been withdrawn', async () => {
    const [live] = await catalog.cities();

    expect(live, 'a live city is needed').toBeDefined();

    /* The opposite control: it resolves while the city is open. */
    await expect(catalog.city(live?.slug ?? '')).resolves.toBeTruthy();

    await db.execute(sql`UPDATE cities SET is_active = false WHERE slug = ${live?.slug}`);

    await expect(catalog.city(live?.slug ?? '')).rejects.toMatchObject({
      response: { code: ERROR.GEO_CITY_NOT_FOUND },
    });
  });

  it('refuses the page of a city whose country is closed', async () => {
    const [live] = await catalog.cities();

    await db.execute(sql`
      UPDATE countries SET is_active = false
      WHERE code = ${live?.countryCode ?? ''}
    `);

    await expect(catalog.city(live?.slug ?? '')).rejects.toMatchObject({
      response: { code: ERROR.GEO_CITY_NOT_FOUND },
    });
  });

  /** A destination card shows this count, so a string would render `NaN` cities. */
  it('counts published properties as a number', async () => {
    const cities = await catalog.cities();

    for (const city of cities) {
      expect(Number.isInteger(city.propertyCount), `${city.slug} count`).toBe(true);
    }
  });
});
