import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ERROR } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { PartnerCouponsService } from './partner-coupons.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * A partner deciding on a coupon SAFRA offered them (Bashar, 2026-09-01).
 *
 * ## What these cases guard
 *
 * That the decision happens ONCE. «Acceptance is permanent … the decision cannot be reversed» is
 * the sentence the portal shows before confirming, and a warning the server does not enforce is a
 * warning somebody can walk around by posting to the endpoint directly.
 *
 * The other half — that a coupon does nothing until it is accepted — lives in `coupon.service`,
 * because that is where a booking is priced.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('a partner’s coupon decisions', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  const service = new PartnerCouponsService(db, new AuditService(db));

  let partnerId = '';
  let userId = '';
  let code = '';

  const partner = (): AccessTokenClaims =>
    ({ sub: userId, role: 'partner', partnerId }) as unknown as AccessTokenClaims;

  beforeEach(async () => {
    await harness.begin();

    const found = await db.execute<{ id: string; user_id: string }>(sql`
      SELECT id::text, user_id::text FROM partners
      WHERE verification = 'approved' AND deleted_at IS NULL LIMIT 1
    `);

    partnerId = found.rows[0]?.id ?? '';
    userId = found.rows[0]?.user_id ?? '';
    code = `OFFER${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

    await db.execute(sql`
      WITH made AS (
        INSERT INTO coupons (code, type, value_kind, value, starts_at, ends_at)
        VALUES (${code}, 'seasonal', 'percent', 10,
                now() - interval '1 day', now() + interval '30 days')
        RETURNING id
      )
      INSERT INTO coupon_partners (coupon_id, partner_id)
      SELECT made.id, ${partnerId}::uuid FROM made
    `);
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  const statusOf = async (): Promise<string | undefined> =>
    (
      await db.execute<{ status: string }>(sql`
        SELECT cp.status::text AS status FROM coupon_partners cp
        JOIN coupons c ON c.id = cp.coupon_id
        WHERE c.code = ${code} AND cp.partner_id = ${partnerId}::uuid
      `)
    ).rows[0]?.status;

  it('offers the coupon as pending, and lists it for the partner', async () => {
    const listed = await service.list(partnerId);
    const mine = listed.find((one) => one.code === code);

    expect(mine?.status).toBe('pending');
    /* `money` is numeric(12,3) — the scale is the column's, not a rounding choice here. */
    expect(Number(mine?.value)).toBe(10);
    expect(mine?.expired).toBe(false);
  });

  it('records an acceptance', async () => {
    await expect(
      service.decide(partner(), partnerId, code, 'accepted'),
    ).resolves.toBeDefined();

    expect(await statusOf()).toBe('accepted');
  });

  it('records a rejection', async () => {
    await service.decide(partner(), partnerId, code, 'rejected');

    expect(await statusOf()).toBe('rejected');
  });

  /**
   * The rule the warning promises: accepting cannot be undone.
   *
   * Both directions are refused — an accepted coupon cannot be rejected, and a second acceptance
   * is refused too, because a repeat press must not rewrite `decided_at` and make the record say
   * the partner decided later than they did.
   */
  it('refuses to reverse an acceptance', async () => {
    await service.decide(partner(), partnerId, code, 'accepted');

    await expect(
      service.decide(partner(), partnerId, code, 'rejected'),
    ).rejects.toMatchObject({ response: { code: ERROR.COUPON_ALREADY_DECIDED } });

    await expect(
      service.decide(partner(), partnerId, code, 'accepted'),
    ).rejects.toMatchObject({ response: { code: ERROR.COUPON_ALREADY_DECIDED } });

    expect(await statusOf(), 'and the record is untouched').toBe('accepted');
  });

  it('refuses to reverse a rejection', async () => {
    await service.decide(partner(), partnerId, code, 'rejected');

    await expect(
      service.decide(partner(), partnerId, code, 'accepted'),
    ).rejects.toMatchObject({ response: { code: ERROR.COUPON_ALREADY_DECIDED } });
  });

  /** A coupon this partner was never offered is not theirs to answer. */
  it('refuses a coupon that was not offered to this partner', async () => {
    await db.execute(sql`
      DELETE FROM coupon_partners cp USING coupons c
      WHERE c.id = cp.coupon_id AND c.code = ${code}
    `);

    await expect(
      service.decide(partner(), partnerId, code, 'accepted'),
    ).rejects.toMatchObject({ response: { code: ERROR.COUPON_NOT_FOUND } });
  });

  it('writes an audit row naming the decision', async () => {
    await service.decide(partner(), partnerId, code, 'accepted');

    const logged = await db.execute<{ actor: string | null; after: unknown }>(sql`
      SELECT actor_user_id AS actor, after FROM audit_log
      WHERE action = 'coupon.partner_accepted' ORDER BY created_at DESC LIMIT 1
    `);

    expect(logged.rows[0]?.actor).toBe(userId);
    expect(JSON.stringify(logged.rows[0]?.after)).toContain(code);
  });
});
