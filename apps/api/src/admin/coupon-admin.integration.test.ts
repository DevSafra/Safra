import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { CouponAdminService } from './coupon-admin.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * Creating a coupon from the console, against a real PostgreSQL.
 *
 * Nothing exercised this path until 2026-10-07, when a browser spec that makes its own offer met a
 * 500: an empty «per customer» box sent no `maxRedemptionsPerCustomer`, the service bound it as
 * NULL, and NULL overrides the column's DEFAULT 1 and breaks its NOT NULL. So every coupon created
 * in the console without that box filled failed, and no test had ever created one.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('creating a coupon', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  let db: Database;
  let service: CouponAdminService;
  let staff: AccessTokenClaims;
  let partnerReference = '';
  let partnerId = '';

  const code = () => `NEW${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const day = (offset: number) =>
    new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

  beforeEach(async () => {
    await harness.begin();
    db = harness.db;
    service = new CouponAdminService(db, new AuditService(db));

    const actor = await db.execute<{ id: string }>(sql`
      SELECT id::text FROM users WHERE role = 'super_admin' AND deleted_at IS NULL LIMIT 1
    `);
    const partner = await db.execute<{ id: string; reference: string }>(sql`
      SELECT id::text, reference FROM partners
      WHERE verification = 'approved' AND deleted_at IS NULL LIMIT 1
    `);

    staff = {
      sub: actor.rows[0]?.id ?? '',
      role: 'super_admin',
      permissions: [],
      locale: 'ar',
    } as unknown as AccessTokenClaims;
    partnerId = partner.rows[0]?.id ?? '';
    partnerReference = partner.rows[0]?.reference ?? '';
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  const perCustomerOf = async (couponCode: string) =>
    (
      await db.execute<{ n: number }>(sql`
        SELECT max_redemptions_per_customer AS n FROM coupons WHERE code = ${couponCode}
      `)
    ).rows[0]?.n;

  it('takes an absent per-customer limit as one, the contract’s word for it', async () => {
    const created = await service.create(staff, {
      code: code(),
      type: 'campaign',
      valueKind: 'percent',
      value: '10',
      startsOn: day(0),
      endsOn: day(30),
    });

    expect(await perCustomerOf(created.code)).toBe(1);
  });

  it('keeps a per-customer limit that was given', async () => {
    const created = await service.create(staff, {
      code: code(),
      type: 'campaign',
      valueKind: 'percent',
      value: '10',
      startsOn: day(0),
      endsOn: day(30),
      maxRedemptionsPerCustomer: 3,
    });

    expect(await perCustomerOf(created.code)).toBe(3);
  });

  it('offers a partner-scoped coupon to that partner alone, as pending', async () => {
    const created = await service.create(staff, {
      code: code(),
      type: 'campaign',
      valueKind: 'percent',
      value: '10',
      startsOn: day(0),
      endsOn: day(30),
      partnerReference,
    });

    const offers = await db.execute<{ partner_id: string; status: string }>(sql`
      SELECT cp.partner_id::text, cp.status::text AS status
      FROM coupon_partners cp JOIN coupons c ON c.id = cp.coupon_id
      WHERE c.code = ${created.code}
    `);

    expect(offers.rows).toStrictEqual([{ partner_id: partnerId, status: 'pending' }]);
  });
});
