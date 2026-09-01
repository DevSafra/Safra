import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import { PromotionsService } from './promotions.service.js';

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

    /* Three partners, one in each state — the smallest fixture that can tell them apart. */
    await db.execute(sql`
      INSERT INTO coupon_partners (coupon_id, partner_id, status, decided_at)
      SELECT ${couponId}::uuid, p.id,
             (ARRAY['pending','accepted','rejected'])[n]::coupon_partner_status,
             CASE WHEN n = 1 THEN NULL ELSE now() END
      FROM (
        SELECT id, row_number() OVER (ORDER BY reference) AS n
        FROM partners WHERE verification = 'approved' AND deleted_at IS NULL LIMIT 3
      ) p
    `);
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  it('counts each group over the whole coupon', async () => {
    const view = await promotions.couponParticipation(code, { page: 1, limit: 25 });

    expect(view.counts).toEqual({
      pending: { total: 1, capped: false },
      accepted: { total: 1, capped: false },
      rejected: { total: 1, capped: false },
    });
    expect(view.partners.items).toHaveLength(3);
  });

  it('narrows the rows by status while leaving the counts alone', async () => {
    const view = await promotions.couponParticipation(code, {
      page: 1,
      limit: 25,
      status: 'accepted',
    });

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
    const view = await promotions.couponParticipation(code, {
      page: 1,
      limit: 25,
      status: 'pending',
    });

    expect(view.partners.items[0]?.decidedAt).toBeNull();
  });

  it('finds a partner by name or reference', async () => {
    const all = await promotions.couponParticipation(code, { page: 1, limit: 25 });
    const one = all.partners.items[0];

    expect(one).toBeDefined();

    const found = await promotions.couponParticipation(code, {
      page: 1,
      limit: 25,
      q: one?.reference ?? '',
    });

    expect(found.partners.items).toHaveLength(1);
    expect(found.partners.items[0]?.reference).toBe(one?.reference);
  });

  it('refuses a coupon that does not exist', async () => {
    await expect(
      promotions.couponParticipation('NOSUCHCODE', { page: 1, limit: 25 }),
    ).rejects.toMatchObject({ response: { code: 'coupon.not_found' } });
  });
});
