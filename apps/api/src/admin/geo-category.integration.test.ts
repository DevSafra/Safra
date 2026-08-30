import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { ERROR } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { GeoCategoryService } from './geo-category.service.js';
import { GeoWriteService } from './geo-write.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * الفئات — city categories, managed rather than deployed.
 *
 * ## The gap (Bashar, 2026-08-30)
 *
 * `city_category` was a `pgEnum` with four members, so adding «ريفية» or renaming «ساحلية» was a
 * migration, a deployment and a release. Every other reference set here is already a table for
 * exactly that reason — `amenities` says it outright — and city categories were the one that was
 * not.
 *
 * ## What each case guards
 *
 * That a category is REACHABLE once added — a page that creates rows nothing can select is worse
 * than no page — and that retiring one leaves the cities filed under it intact.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('managing city categories', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  const service = new GeoCategoryService(db, new AuditService(db));
  const cities = new GeoWriteService(db, new AuditService(db));

  let staffId = '';
  let suffix = '';

  const staff = (): AccessTokenClaims =>
    ({
      sub: staffId,
      role: 'super_admin',
      permissions: ['geo.manage'],
    }) as unknown as AccessTokenClaims;

  beforeEach(async () => {
    await harness.begin();

    const made = await db.execute<{ id: string }>(sql`
      INSERT INTO users (email, phone, role, status)
      VALUES ('cat-' || gen_random_uuid() || '@safra.test', '+963900000190',
              'super_admin', 'active')
      RETURNING id::text
    `);

    staffId = made.rows[0]?.id ?? '';
    suffix = Math.random().toString(36).slice(2, 6);
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  it('lists the seeded categories with how many cities carry each', async () => {
    const listed = await service.list();
    const coastal = listed.find((one) => one.code === 'coastal');

    expect(coastal?.nameAr).toBe('ساحلية');
    /* Counted from the JOIN, which is the authority for what a city is filed under. */
    expect(coastal?.cities).toBeGreaterThan(0);
  });

  /**
   * The whole point: a category added here can be put on a city.
   *
   * It has no `city_category` enum member and never will — a Postgres enum cannot gain one from a
   * request — so it exists in `city_category_links` alone. A page that created rows nothing could
   * select would be a screen that changes nothing, which is worse than not having it.
   */
  it('adds a category a city can then be filed under', async () => {
    const code = `rural-${suffix}`;

    await expect(
      service.create(staff(), {
        code,
        nameAr: 'ريفية',
        nameEn: 'Rural',
        nameDe: 'Ländlich',
      }),
    ).resolves.toEqual({ code });

    const slug = `village-${suffix}`;

    await cities.createCity(staff(), {
      countryCode: 'SY',
      slug,
      nameAr: 'قرية',
      nameEn: 'Village',
      nameDe: 'Dorf',
      timezone: 'Asia/Damascus',
      categories: [code, 'coastal'],
    });

    const linked = await db.execute<{ codes: string[] }>(sql`
      SELECT array_agg(cc.code ORDER BY cc.code) AS codes
      FROM city_category_links l
      JOIN city_categories cc ON cc.id = l.category_id
      JOIN cities c ON c.id = l.city_id
      WHERE c.slug = ${slug}
    `);

    expect(linked.rows[0]?.codes).toEqual([code, 'coastal'].sort());

    /* And the count on the categories screen sees it. */
    const listed = await service.list();

    expect(listed.find((one) => one.code === code)?.cities).toBe(1);
  });

  /**
   * The legacy array holds only what the ENUM knows.
   *
   * `cities.categories` is still read by the customer city page, the home page's strip and
   * `catalog.service`, and a Postgres enum cannot gain a member from a request. A new category
   * therefore lives in the join alone, and writing it into the array would throw. This asserts the
   * asymmetry is deliberate rather than accidental.
   */
  it('keeps a new category out of the legacy enum array', async () => {
    const code = `steppe-${suffix}`;

    await service.create(staff(), {
      code,
      nameAr: 'سهلية',
      nameEn: 'Steppe',
      nameDe: 'Steppe',
    });

    const slug = `plain-${suffix}`;

    await cities.createCity(staff(), {
      countryCode: 'SY',
      slug,
      nameAr: 'سهل',
      nameEn: 'Plain',
      nameDe: 'Ebene',
      timezone: 'Asia/Damascus',
      categories: [code, 'desert'],
    });

    const row = await db.execute<{ arr: string[] }>(sql`
      SELECT (SELECT array_agg(x) FROM unnest(categories::text[]) AS x) AS arr
      FROM cities WHERE slug = ${slug}
    `);

    expect(row.rows[0]?.arr, 'only the enum member reaches the array').toEqual([
      'desert',
    ]);
  });

  it('renames a category without touching what it is not asked to', async () => {
    await service.update(staff(), 'coastal', { nameAr: 'على البحر' });

    const listed = await service.list();
    const coastal = listed.find((one) => one.code === 'coastal');

    expect(coastal?.nameAr).toBe('على البحر');
    /* Everything absent from the payload is left exactly as it was — `coalesce`, not a rewrite. */
    expect(coastal?.nameEn).toBe('Coastal');
    expect(coastal?.isActive).toBe(true);
  });

  /**
   * Retiring one takes it out of the pickers and leaves the cities alone.
   *
   * Deleting would orphan the links and make the customer city page print a code where a word
   * belongs, so there is no delete. The audit row records how many cities that was, because a flag
   * alone cannot answer «what did that change» afterwards.
   */
  it('retires a category, keeping the cities filed under it', async () => {
    const before = await db.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n FROM city_category_links l
      JOIN city_categories cc ON cc.id = l.category_id
      WHERE cc.code = 'historic'
    `);

    await service.update(staff(), 'historic', { isActive: false });

    const after = await db.execute<{ n: string; active: boolean }>(sql`
      SELECT (SELECT count(*)::text FROM city_category_links l
              JOIN city_categories cc ON cc.id = l.category_id
              WHERE cc.code = 'historic') AS n,
             (SELECT is_active FROM city_categories WHERE code = 'historic') AS active
    `);

    expect(after.rows[0]?.active).toBe(false);
    expect(after.rows[0]?.n, 'the cities keep their link').toBe(before.rows[0]?.n);

    const logged = await db.execute<{ after: unknown }>(sql`
      SELECT after FROM audit_log
      WHERE action = 'city_category.updated' ORDER BY created_at DESC LIMIT 1
    `);

    expect(JSON.stringify(logged.rows[0]?.after)).toContain('"isActive":false');
    expect(JSON.stringify(logged.rows[0]?.after)).toContain(
      `"cities":${Number(before.rows[0]?.n ?? 0)}`,
    );
  });

  it('refuses a duplicate code, and a category that does not exist', async () => {
    await expect(
      service.create(staff(), {
        code: 'coastal',
        nameAr: 'مكررة',
        nameEn: 'Dup',
        nameDe: 'Dup',
      }),
    ).rejects.toMatchObject({ response: { code: ERROR.GEO_CODE_TAKEN } });

    await expect(
      service.update(staff(), 'no-such-category', { nameAr: 'x' }),
    ).rejects.toMatchObject({ response: { code: ERROR.GEO_CATEGORY_NOT_FOUND } });
  });

  /** Appending, so adding one cannot silently reorder the customer home page's strip. */
  it('appends a new category rather than taking somebody else’s place', async () => {
    const before = await service.list();
    const code = `last-${suffix}`;

    await service.create(staff(), {
      code,
      nameAr: 'أخيرة',
      nameEn: 'Last',
      nameDe: 'Letzte',
    });

    const after = await service.list();

    expect(after[after.length - 1]?.code).toBe(code);
    /* And nothing above it moved. */
    expect(after.slice(0, before.length).map((one) => one.code)).toEqual(
      before.map((one) => one.code),
    );
  });
});
