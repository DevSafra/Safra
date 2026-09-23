import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { LandmarkService } from './landmark.service.js';

/**
 * Holds the landmark KINDS panel's «no pager» exemption to account.
 *
 * ## What is being excused
 *
 * §2 requires every list a person reads to be paginated. The kinds panel is not, on the same
 * grounds `geo-bounds.integration.test.ts` records for countries, currencies and cities: the
 * set is bounded by the BUSINESS rather than by usage, and three rows behind a pager is worse
 * than three rows. Eight kinds today.
 *
 * ## Why an exemption needs a test rather than a comment
 *
 * «An exemption list decays in the direction of hiding things»: the reason is written once and
 * the data grows underneath it. The day somebody adds a fiftieth kind the panel becomes a wall
 * nobody can read, and nothing anywhere would say so — the screen would simply get longer.
 *
 * So this asserts the exemption still describes something BOUNDED rather than merely something
 * convenient. If it fails, the panel needs a pager and this file names the work.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** What fits on one screen before a reader is scrolling to compare two rows. */
const FITS_ON_A_SCREEN = 25;

describeIfDb('the landmark kinds panel stays small enough to have no pager', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  const service = new LandmarkService(db, new AuditService(db));

  beforeEach(async () => {
    await harness.begin();
  });
  afterEach(async () => {
    await harness.rollback();
  });
  afterAll(async () => {
    await harness.close();
  });

  it('lists every kind on one screen', async () => {
    const kinds = await service.listKinds();

    expect(kinds.length).toBeGreaterThan(0);
    expect(
      kinds.length,
      `${kinds.length} landmark kinds no longer fit on a screen — the panel needs a pager, ` +
        'or the taxonomy needs a second look.',
    ).toBeLessThanOrEqual(FITS_ON_A_SCREEN);
  });

  /**
   * The control for the test above.
   *
   * «They fit» is worthless if the list is empty — a `listKinds` that returned nothing would
   * pass the bound and fail the product. This asserts the panel has something in it AND that
   * every row carries what the screen draws, so a column quietly returning null is caught here
   * rather than as a blank cell somebody notices later.
   */
  it('gives every kind the fields the panel renders', async () => {
    const kinds = await service.listKinds();

    for (const kind of kinds) {
      expect(
        kind.code,
        'a kind with no code cannot be edited or filtered on',
      ).toBeTruthy();
      expect(kind.nameAr, `${kind.code} has no Arabic name`).toBeTruthy();
      expect(Array.isArray(kind.iconPaths)).toBe(true);
      expect(typeof kind.landmarks).toBe('number');
    }
  });

  /**
   * The LANDMARKS themselves are paged, and this proves it rather than assuming it.
   *
   * They are the list the exemption does NOT cover: forty-one today across nine cities, and
   * growing with every city SAFRA opens. A page that quietly returned everything would look
   * identical on the dev database and fail at the first real market.
   */
  it('pages the landmark registry rather than returning everything', async () => {
    const total = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM landmarks WHERE deleted_at IS NULL`,
    );
    const rows = total.rows[0]?.n ?? 0;

    /* The fixture has to be able to show the defect: fewer rows than a page proves nothing. */
    expect(
      rows,
      'seed the landmarks — a page size cannot be tested against 2 rows',
    ).toBeGreaterThan(5);

    const firstPage = await service.list({ page: 1, size: 5 });
    expect(firstPage.items).toHaveLength(5);
    expect(firstPage.total).toBe(rows);

    const secondPage = await service.list({ page: 2, size: 5 });
    expect(secondPage.items).toHaveLength(5);

    /* Different rows, which is what «paged» means as opposed to «limited». */
    const first = firstPage.items.map((one) => one.slug);
    const second = secondPage.items.map((one) => one.slug);
    expect(second.filter((slug) => first.includes(slug))).toEqual([]);
  });

  /** A page past the end is an empty list, never an error — the reader TYPES a page number. */
  it('answers a page past the end with an empty list', async () => {
    const far = await service.list({ page: 900, size: 10 });

    expect(far.items).toEqual([]);
    expect(far.total).toBeGreaterThan(0);
  });
});
