import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import type { AccessTokenClaims } from '../auth/token.service.js';
import { PromotionsService } from './promotions.service.js';

/** A member with no city restriction: every partner on the coupon is theirs to read. */
const UNSCOPED_STAFF = {
  sub: '00000000-0000-0000-0000-000000000000',
  role: 'operations_manager',
  permissions: [],
  locale: 'ar',
} as unknown as AccessTokenClaims;

/**
 * Coupon adoption, as the console reads it (Bashar, 2026-09-01).
 *
 * ## What is asserted
 *
 * That the three counts describe the COUPON and the rows describe the FILTER. They are different
 * questions — «how is adoption going» and «who do I chase» — and a count that narrowed with the
 * filter would answer the first with the answer to the second, which is the defect worth a test.
 *
 * ## What is NOT asserted here, and why
 *
 * The capped branch. Each group stops counting at `COUNT_CAP` (10,000) and reports `capped`, and a
 * fixture that reached it would need more than ten thousand partners on ONE coupon against 2,672
 * eligible partners in the database — the composite key is (coupon_id, partner_id), so the group
 * cannot be padded without inventing partners. The rendering half of that rule is held by
 * `group-count.test.ts`; the SQL half is reasoned, not tested, and this note is the honest record
 * of it rather than a silence that reads as coverage.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('one coupon’s adoption', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  const promotions = new PromotionsService(db);

  let code = '';

  beforeEach(async () => {
    await harness.begin();

    code = `ADOPT${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

    const made = await db.execute<{ id: string }>(sql`
      INSERT INTO coupons (code, type, value_kind, value, starts_at, ends_at)
      VALUES (${code}, 'seasonal', 'percent', 10,
              now() - interval '1 day', now() + interval '30 days')
      RETURNING id::text
    `);

    const couponId = made.rows[0]?.id ?? '';

    /*
      Three partners, one in each state — the smallest fixture that can tell them apart — and each
      in a DIFFERENT city, so a city-scoped reader has something to be kept from. Three from one
      city made the scope test pass against an unscoped read.

      PLACED in three cities rather than found in them (2026-10-06): a fresh database (CI's) has
      approved partners in only two, so the third row never existed and «rejected» counted 0. The
      move is inside this test's transaction and rolls back with it.
    */
    await db.execute(sql`
      WITH p AS (
        SELECT id, row_number() OVER (ORDER BY reference) AS n FROM partners
         WHERE verification = 'approved' AND deleted_at IS NULL ORDER BY reference LIMIT 3
      ), c AS (
        SELECT id, row_number() OVER (ORDER BY slug) AS n FROM cities
         WHERE deleted_at IS NULL ORDER BY slug LIMIT 3
      )
      UPDATE partners SET city_id = c.id FROM p JOIN c USING (n) WHERE partners.id = p.id
    `);
    await db.execute(sql`
      INSERT INTO coupon_partners (coupon_id, partner_id, status, decided_at)
      SELECT ${couponId}::uuid, p.id,
             (ARRAY['pending','accepted','rejected'])[n]::coupon_partner_status,
             CASE WHEN n = 1 THEN NULL ELSE now() END
      FROM (
        SELECT id, row_number() OVER (ORDER BY reference) AS n
        FROM (
          SELECT DISTINCT ON (city_id) id, reference
          FROM partners WHERE verification = 'approved' AND deleted_at IS NULL
          ORDER BY city_id, reference
        ) one_per_city
        LIMIT 3
      ) p
    `);
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  it('counts each group over the whole coupon', async () => {
    const view = await promotions.couponParticipation(
      code,
      { page: 1, limit: 25 },
      UNSCOPED_STAFF,
    );

    expect(view.counts).toEqual({
      pending: { total: 1, capped: false },
      accepted: { total: 1, capped: false },
      rejected: { total: 1, capped: false },
    });
    expect(view.partners.items).toHaveLength(3);
  });

  it('narrows the rows by status while leaving the counts alone', async () => {
    const view = await promotions.couponParticipation(
      code,
      {
        page: 1,
        limit: 25,
        status: 'accepted',
      },
      UNSCOPED_STAFF,
    );

    expect(view.partners.items).toHaveLength(1);
    expect(view.partners.items[0]?.status).toBe('accepted');
    /* The whole point: the totals still describe the coupon, not this filter. */
    expect(view.counts).toEqual({
      pending: { total: 1, capped: false },
      accepted: { total: 1, capped: false },
      rejected: { total: 1, capped: false },
    });
  });

  it('reports no answer as a null timestamp rather than a date', async () => {
    const view = await promotions.couponParticipation(
      code,
      {
        page: 1,
        limit: 25,
        status: 'pending',
      },
      UNSCOPED_STAFF,
    );

    expect(view.partners.items[0]?.decidedAt).toBeNull();
  });

  it('finds a partner by name or reference', async () => {
    const all = await promotions.couponParticipation(
      code,
      { page: 1, limit: 25 },
      UNSCOPED_STAFF,
    );
    const one = all.partners.items[0];

    expect(one).toBeDefined();

    const found = await promotions.couponParticipation(
      code,
      {
        page: 1,
        limit: 25,
        q: one?.reference ?? '',
      },
      UNSCOPED_STAFF,
    );

    expect(found.partners.items).toHaveLength(1);
    expect(found.partners.items[0]?.reference).toBe(one?.reference);
  });

  /*
    The coupon is global; its partners are a directory. Watched to fail against the unscoped read:
    a member scoped to one city was handed every partner on the coupon, in every city.
  */
  it('shows a city-scoped member only the partners in their own cities', async () => {
    const everyone = await promotions.couponParticipation(
      code,
      { page: 1, limit: 25 },
      UNSCOPED_STAFF,
    );
    const cities = await db.execute<{ reference: string; city_id: string }>(sql`
      SELECT p.reference, p.city_id::text AS city_id FROM partners p
      WHERE p.reference IN ${everyone.partners.items.map((row) => row.reference)}
    `);
    const mine = cities.rows[0]?.city_id ?? '';
    const expected = cities.rows
      .filter((row) => row.city_id === mine)
      .map((row) => row.reference);

    const scoped = await promotions.couponParticipation(
      code,
      { page: 1, limit: 25 },
      {
        ...UNSCOPED_STAFF,
        scope: { kind: 'cities', cityIds: [mine], outside: 'none' },
      },
    );

    expect(scoped.partners.items.map((row) => row.reference).sort()).toEqual(
      expected.sort(),
    );
    expect(scoped.partners.total).toBe(expected.length);

    const tallied =
      scoped.counts.pending.total +
      scoped.counts.accepted.total +
      scoped.counts.rejected.total;

    expect(tallied).toBe(expected.length);
  });

  it('shows a member scoped to a city with none of its partners nobody', async () => {
    const elsewhere = await db.execute<{ id: string }>(sql`
      SELECT c.id::text AS id FROM cities c
      WHERE NOT EXISTS (
        SELECT 1 FROM coupon_partners cpn JOIN partners p ON p.id = cpn.partner_id
        JOIN coupons k ON k.id = cpn.coupon_id
        WHERE k.code = ${code} AND p.city_id = c.id
      )
      LIMIT 1
    `);

    const scoped = await promotions.couponParticipation(
      code,
      { page: 1, limit: 25 },
      {
        ...UNSCOPED_STAFF,
        scope: {
          kind: 'cities',
          cityIds: [elsewhere.rows[0]?.id ?? ''],
          outside: 'none',
        },
      },
    );

    expect(scoped.partners.items).toEqual([]);
    expect(scoped.counts.accepted.total + scoped.counts.pending.total).toBe(0);
  });

  it('refuses a coupon that does not exist', async () => {
    await expect(
      promotions.couponParticipation(
        'NOSUCHCODE',
        { page: 1, limit: 25 },
        UNSCOPED_STAFF,
      ),
    ).rejects.toMatchObject({ response: { code: 'coupon.not_found' } });
  });
});
