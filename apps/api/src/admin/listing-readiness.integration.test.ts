import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  LISTING_READINESS_CHECKS,
  LISTING_READINESS_STATUSES,
  type ListingReadinessCheck,
} from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import { RegistryService } from './registry.service.js';

/**
 * العقارات, filtered by what a listing is operationally MISSING.
 *
 * ## What is actually at risk
 *
 * Not the predicates — `latitude IS NULL` is hard to get wrong. Two other things are:
 *
 * 1. **The COUNT.** The registry prints «٢٠١٧ نتيجة» above the table, and a filter applied to the
 *    list but not to the total produces a page claiming two thousand results over sixty-seven
 *    rows — which the standing rule on tables calls worse than showing no total at all.
 * 2. **Agreement between the filter and the row.** The filter is SQL in the WHERE; `gaps` on each
 *    row comes from `listingGaps` in TypeScript. They are two expressions of one rule and nothing
 *    but a test makes them say the same thing — a listing returned by `gap=unit` whose own row
 *    does not report `unit` is the defect, and it is invisible to every type.
 *
 * ## Written over the CHECKS, not over four hand-copied cases
 *
 * `LISTING_READINESS_CHECKS` drives the loop, so a fifth check added to the contract is covered
 * the day it is added rather than the day somebody remembers to add a case here.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('the listing registry, filtered by what is missing', () => {
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

  /**
   * What the database says, computed independently of the service under test.
   *
   * Every gap figure is restricted to `LISTING_READINESS_STATUSES`, because readiness describes a
   * LIVE listing — a draft's gaps belong to whoever is still writing it. `all` is deliberately NOT
   * restricted: the unfiltered registry shows every status, and a test that narrowed both would
   * stop noticing if the filter leaked into the unfiltered view.
   */
  async function truth() {
    const live = sql`p.status IN (${sql.join(
      LISTING_READINESS_STATUSES.map((status) => sql`${status}`),
      sql`, `,
    )})`;

    const rows = await db.execute<Record<ListingReadinessCheck | 'all' | 'any', string>>(
      sql`
        SELECT count(*) AS all,
               count(*) FILTER (
                 WHERE ${live}
                   AND NOT EXISTS (SELECT 1 FROM units u
                                   WHERE u.property_id = p.id AND u.deleted_at IS NULL)
               ) AS unit,
               count(*) FILTER (
                 WHERE ${live} AND (p.latitude IS NULL OR p.longitude IS NULL)
               ) AS location,
               count(*) FILTER (
                 WHERE ${live}
                   AND NOT EXISTS (SELECT 1 FROM property_images i
                                   WHERE i.property_id = p.id AND i.deleted_at IS NULL
                                     AND i.status = 'ready')
               ) AS photograph,
               count(*) FILTER (
                 WHERE ${live}
                   AND (p.description_ar IS NULL OR btrim(p.description_ar) = '')
               ) AS description,
               count(*) FILTER (
                 WHERE ${live} AND (
                      NOT EXISTS (SELECT 1 FROM units u
                                  WHERE u.property_id = p.id AND u.deleted_at IS NULL)
                   OR p.latitude IS NULL OR p.longitude IS NULL
                   OR NOT EXISTS (SELECT 1 FROM property_images i
                                  WHERE i.property_id = p.id AND i.deleted_at IS NULL
                                    AND i.status = 'ready')
                   OR p.description_ar IS NULL OR btrim(p.description_ar) = ''
                 )
               ) AS any
        FROM properties p
        WHERE p.deleted_at IS NULL
      `,
    );

    const row = rows.rows[0];

    return {
      all: Number(row?.all ?? 0),
      unit: Number(row?.unit ?? 0),
      location: Number(row?.location ?? 0),
      photograph: Number(row?.photograph ?? 0),
      description: Number(row?.description ?? 0),
      any: Number(row?.any ?? 0),
    };
  }

  it('has a fixture carrying every gap, or it proves nothing', async () => {
    const counts = await truth();

    for (const check of LISTING_READINESS_CHECKS) {
      expect(
        counts[check],
        `the registry must hold a listing missing ${check}`,
      ).toBeGreaterThan(0);
    }
    expect(counts.all).toBeGreaterThan(0);
  });

  it.each(LISTING_READINESS_CHECKS)(
    'counts what it lists when filtering by %s',
    async (check) => {
      const counts = await truth();
      const page = await registry.properties({ limit: 10, page: 1, gap: check });

      expect(page.total, `the total for gap=${check}`).toBe(counts[check]);
    },
  );

  it.each(LISTING_READINESS_CHECKS)(
    'returns only listings that report %s themselves',
    async (check) => {
      const page = await registry.properties({ limit: 50, page: 1, gap: check });

      expect(page.items.length).toBeGreaterThan(0);

      for (const item of page.items) {
        expect(
          item.gaps,
          `${item.reference} was returned by gap=${check} but reports ${JSON.stringify(item.gaps)}`,
        ).toContain(check);
      }
    },
  );

  /**
   * `any` is the union, and it must not be the sum.
   *
   * A listing missing three things is ONE incomplete listing. Adding the four counts would
   * over-report it three times over, which is the arithmetic a «total incomplete» figure invites.
   */
  it('counts a listing with several gaps exactly once under gap=any', async () => {
    const counts = await truth();
    const any = await registry.properties({ limit: 10, page: 1, gap: 'any' });
    const unfiltered = await registry.properties({ limit: 10, page: 1 });

    const sum = LISTING_READINESS_CHECKS.reduce(
      (total, check) => total + counts[check],
      0,
    );

    /*
      The EXACT union, computed independently. «less than the sum and more than zero» was the first
      assertion here and it was too weak to notice `gap=any` collapsing to a single check — it
      passed against a mutation that dropped three quarters of the filter.
    */
    expect(any.total, 'gap=any must be the exact union').toBe(counts.any);
    expect(any.total).toBeLessThanOrEqual(unfiltered.total);
    expect(any.total, 'gap=any must be a union, not a sum').toBeLessThan(sum);
    expect(any.total).toBeGreaterThan(0);
  });

  it('every listing under gap=any reports at least one gap', async () => {
    const page = await registry.properties({ limit: 50, page: 1, gap: 'any' });

    for (const item of page.items) {
      expect(
        item.gaps.length,
        `${item.reference} was listed as incomplete`,
      ).toBeGreaterThan(0);
    }
  });

  it('leaves the registry unfiltered when no gap is asked for', async () => {
    const counts = await truth();
    const unfiltered = await registry.properties({ limit: 10, page: 1 });

    expect(unfiltered.total).toBe(counts.all);
  });

  /**
   * A DRAFT reports nothing, however incomplete it is.
   *
   * Readiness describes a live listing. The registry showed «لا يظهر في البحث» against every draft
   * for a day — trivially true, and it told an operator nothing while making the column look like
   * a catastrophe. Found by looking at the screen rather than by a test, which is why there is
   * now one.
   */
  it('reports no gaps for a listing no guest can reach', async () => {
    const [draft] = await db
      .execute<{ reference: string }>(
        sql`SELECT reference FROM properties
            WHERE deleted_at IS NULL AND status = 'draft'
              AND (latitude IS NULL OR longitude IS NULL)
            ORDER BY id LIMIT 1`,
      )
      .then((r) => r.rows);

    expect(draft, 'the fixture must hold an incomplete draft').toBeDefined();

    const page = await registry.properties({ limit: 25, page: 1, q: draft!.reference });
    const found = page.items.find((one) => one.reference === draft!.reference);

    expect(
      found,
      'the draft must still be LISTED — it is only its gaps that are silent',
    ).toBeDefined();
    expect(found!.gaps, 'a draft must report no gaps').toEqual([]);
  });

  it('excludes drafts from every gap filter', async () => {
    for (const check of LISTING_READINESS_CHECKS) {
      const page = await registry.properties({ limit: 50, page: 1, gap: check });

      for (const item of page.items) {
        expect(
          LISTING_READINESS_STATUSES as readonly string[],
          `${item.reference} is ${item.status} and was returned by gap=${check}`,
        ).toContain(item.status);
      }
    }
  });

  /**
   * A photograph still processing is not a photograph.
   *
   * `imageIsPublished` restricts to `status = 'ready'` and this proves the readiness model honours
   * it. It PLANTS the state rather than looking for one: every one of the fixture's 517 images is
   * `ready`, so a mutation that dropped the status check was behaviourally identical and no
   * assertion could have caught it. A test whose fixture cannot reach the field it protects
   * reports coverage it does not have.
   */
  it('does not count a photograph that has not finished processing', async () => {
    const [victim] = await db
      .execute<{ reference: string }>(
        /* A LIVE listing: readiness says nothing about a draft, so a draft victim proves nothing. */
        sql`SELECT p.reference
            FROM properties p
            WHERE p.deleted_at IS NULL
              AND p.status IN ('published', 'pending_review')
              AND (SELECT count(*) FROM property_images i
                   WHERE i.property_id = p.id AND i.deleted_at IS NULL) = 1
            ORDER BY p.id LIMIT 1`,
      )
      .then((r) => r.rows);

    expect(
      victim,
      'the fixture must hold a listing with exactly one image',
    ).toBeDefined();

    /* Before: it has a picture, so it carries no photograph gap. */
    const before = await registry.properties({
      limit: 25,
      page: 1,
      q: victim!.reference,
    });

    expect(
      before.items.find((one) => one.reference === victim!.reference)?.gaps,
      'the control: with a ready image it must NOT report the photograph gap',
    ).not.toContain('photograph');

    await db.execute(sql`
      UPDATE property_images SET status = 'processing'
      WHERE property_id = (SELECT id FROM properties WHERE reference = ${victim!.reference})
    `);

    const after = await registry.properties({
      limit: 25,
      page: 1,
      gap: 'photograph',
      q: victim!.reference,
    });
    const found = after.items.find((one) => one.reference === victim!.reference);

    expect(
      found,
      'a listing whose only image is processing has no photograph',
    ).toBeDefined();
    expect(found!.gaps).toContain('photograph');
  });

  /**
   * Half a pair is not a location, here as much as at submission.
   *
   * Searched BY REFERENCE rather than paged through: the registry holds 2,700 listings and the
   * victim is not reliably on page one. An assertion that merely checked «the list is non-empty»
   * passed against two mutations that lost this row entirely.
   */
  it.each([
    ['latitude only', sql`longitude = NULL`],
    ['longitude only', sql`latitude = NULL`],
  ])('files a listing with %s under the location gap', async (_name, half) => {
    const [victim] = await db
      .execute<{ reference: string }>(
        /* LIVE, for the same reason the photograph case is. */
        sql`SELECT reference FROM properties
            WHERE deleted_at IS NULL AND latitude IS NOT NULL AND longitude IS NOT NULL
              AND status IN ('published', 'pending_review')
            ORDER BY id LIMIT 1`,
      )
      .then((r) => r.rows);

    expect(victim, 'the fixture must hold a placed listing to break').toBeDefined();

    await db.execute(
      sql`UPDATE properties SET ${half} WHERE reference = ${victim!.reference}`,
    );

    const page = await registry.properties({
      limit: 25,
      page: 1,
      gap: 'location',
      q: victim!.reference,
    });
    const found = page.items.find((one) => one.reference === victim!.reference);

    expect(
      found,
      'a half-placed listing must appear under the location gap',
    ).toBeDefined();
    expect(found!.gaps).toContain('location');
    expect(found!.hasLocation, 'and must report itself as not on the map').toBe(false);
  });
});
