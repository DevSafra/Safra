import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ERROR, normaliseCouponCode } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import { CouponService, type CouponContext } from './coupon.service.js';

/**
 * الكوبونات — what a code is worth against a stay, and when it is worth nothing.
 *
 * ## Why every rule gets its own case
 *
 * A coupon refusal is a sentence a customer reads at the moment they are trying to pay. «This
 * coupon starts on Sunday» and «you have already used this» are different problems with different
 * answers, and a service that collapsed them into one «invalid» would be telling somebody to give
 * up when the fix was to come back tomorrow. Each rule is asserted separately because each one
 * produces a different code.
 *
 * The single deliberate collapse is a code that does not EXIST, which answers exactly what one
 * outside its window answers. A distinguishable «no such coupon» turns the public preview endpoint
 * into an oracle for guessing live campaign codes.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('a coupon judged against a stay', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  const coupons = new CouponService(db);

  let cityId = '';
  let partnerId = '';
  let otherCityId = '';
  let otherPartnerId = '';
  let usdId = '';
  let profileId = '';

  beforeEach(async () => {
    await harness.begin();

    const seeded = await db.execute<{
      city: string;
      other_city: string;
      partner: string;
      other_partner: string;
      usd: string;
      profile: string;
    }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM currencies WHERE code = 'USD') AS usd,
               (SELECT id FROM partner_types LIMIT 1)          AS ptype
      ), c1 AS (
        SELECT id FROM cities WHERE deleted_at IS NULL ORDER BY id LIMIT 1
      ), c2 AS (
        SELECT id FROM cities WHERE deleted_at IS NULL AND id <> (SELECT id FROM c1)
        ORDER BY id LIMIT 1
      ), u1 AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('cpn-a-' || gen_random_uuid() || '@safra.test', '+963900000110', 'partner', 'active')
        RETURNING id
      ), u2 AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('cpn-b-' || gen_random_uuid() || '@safra.test', '+963900000111', 'partner', 'active')
        RETURNING id
      ), p1 AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT u1.id, ref.ptype, 'Coupon A', 'كوبون أ', (SELECT id FROM c1), 'x',
               '+963900000110', 'cpn-a-' || gen_random_uuid() || '@safra.test', 'approved'
        FROM u1, ref RETURNING id
      ), p2 AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT u2.id, ref.ptype, 'Coupon B', 'كوبون ب', (SELECT id FROM c1), 'x',
               '+963900000111', 'cpn-b-' || gen_random_uuid() || '@safra.test', 'approved'
        FROM u2, ref RETURNING id
      ), cp AS (
        INSERT INTO customer_profiles (full_name, email, phone, is_guest)
        VALUES ('نزيل الكوبون', 'cpn-c-' || gen_random_uuid() || '@safra.test',
                '+963900000112', false)
        RETURNING id
      )
      SELECT (SELECT id FROM c1) AS city, (SELECT id FROM c2) AS other_city,
             p1.id AS partner, p2.id AS other_partner, ref.usd, cp.id AS profile
      FROM p1, p2, ref, cp
    `);

    const row = seeded.rows[0];

    if (!row) throw new Error('Seed produced nothing.');

    cityId = row.city;
    otherCityId = row.other_city;
    partnerId = row.partner;
    otherPartnerId = row.other_partner;
    usdId = row.usd;
    profileId = row.profile;
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  /** A stay worth 200 base / 209 total, in USD, at the seeded city and partner. */
  const stay = (over: Partial<CouponContext> = {}): CouponContext => ({
    baseAmount: '200.00',
    totalAmount: '209.00',
    currencyId: usdId,
    currencyCode: 'USD',
    currencyDecimals: 2,
    cityId,
    partnerId,
    customerProfileId: profileId,
    ...over,
  });

  /** A coupon, with everything unset unless the case cares about it. */
  async function coupon(over: Record<string, unknown> = {}): Promise<string> {
    const code = normaliseCouponCode(`T${Math.floor(Math.random() * 1e9)}`);

    const values = {
      type: 'campaign',
      value_kind: 'percent',
      value: '10',
      currency_id: null,
      max_discount_amount: null,
      min_booking_amount: null,
      starts_offset_days: -1,
      ends_offset_days: 30,
      max_redemptions: null,
      max_redemptions_per_customer: 1,
      city_id: null,
      partner_id: null,
      is_active: true,
      accepted: true,
      ...over,
    };

    await db.execute(sql`
      INSERT INTO coupons
        (code, type, value_kind, value, currency_id, max_discount_amount, min_booking_amount,
         starts_at, ends_at, max_redemptions, max_redemptions_per_customer,
         city_id, partner_id, is_active)
      VALUES (
        ${code}, ${values.type}::coupon_type, ${values.value_kind}::coupon_value_kind,
        ${values.value}::numeric, ${values.currency_id}::uuid,
        ${values.max_discount_amount}::numeric, ${values.min_booking_amount}::numeric,
        now() + (${values.starts_offset_days} * interval '1 day'),
        now() + (${values.ends_offset_days} * interval '1 day'),
        ${values.max_redemptions}, ${values.max_redemptions_per_customer},
        ${values.city_id}::uuid, ${values.partner_id}::uuid, ${values.is_active}
      )
    `);

    /*
      ACCEPTED by the stay's partner, unless the case is about the acceptance itself.

      A coupon does nothing until the partner takes it up (Bashar, 2026-09-01), so every case in
      this file that is about some OTHER rule — the window, the caps, the scope — needs the offer
      already accepted or it would be refused for the wrong reason and prove nothing. The two
      cases that ARE about acceptance pass `accepted: false` and set up their own row.
    */
    if (values.accepted !== false) {
      await db.execute(sql`
        INSERT INTO coupon_partners (coupon_id, partner_id, status, decided_at)
        SELECT id, ${partnerId}::uuid, 'accepted', now() FROM coupons WHERE code = ${code}
      `);
    }

    return code;
  }

  const refusal = async (code: string, context = stay()): Promise<string> => {
    try {
      await coupons.preview(code, context);

      return '';
    } catch (error) {
      return (error as { response?: { code?: string } }).response?.code ?? 'unknown';
    }
  };

  /* ── What a coupon is worth ─────────────────────────────────────────────────────────────── */

  /**
   * A percentage comes off the STAY, not the total.
   *
   * SAFRA's service fee is its own charge rather than part of what is being discounted, and «10%
   * off» means off the room. 10% of 200 is 20 — not 20.90.
   */
  it('takes a percentage of the stay', async () => {
    const code = await coupon({ value_kind: 'percent', value: '10' });

    expect((await coupons.preview(code, stay())).discountAmount).toBe('20.000');
  });

  it('takes a fixed amount as given', async () => {
    const code = await coupon({
      value_kind: 'fixed',
      value: '35.00',
      currency_id: usdId,
    });

    expect((await coupons.preview(code, stay())).discountAmount).toBe('35.000');
  });

  /** The operator's own ceiling on a percentage — «20% off, up to 15». */
  it('honours the maximum discount', async () => {
    const code = await coupon({ value: '50', max_discount_amount: '15.00' });

    expect((await coupons.preview(code, stay())).discountAmount).toBe('15.000');
  });

  /**
   * And never more than the stay itself.
   *
   * A discount larger than the room is a booking that pays the partner out of nothing. The partner
   * is owed the full base whatever the coupon said.
   */
  it('never discounts more than the stay is worth', async () => {
    const code = await coupon({
      value_kind: 'fixed',
      value: '5000.00',
      currency_id: usdId,
    });

    expect((await coupons.preview(code, stay())).discountAmount).toBe('200.000');
  });

  /** A code is found however it was typed — from a poster, an email, or read out loud. */
  it('finds a coupon whatever case or spacing it was typed in', async () => {
    const code = await coupon();

    for (const typed of [
      code.toLowerCase(),
      ` ${code} `,
      `${code.slice(0, 3)}-${code.slice(3)}`,
    ]) {
      expect((await coupons.preview(typed, stay())).code, typed).toBe(code);
    }
  });

  /* ── When it is worth nothing ───────────────────────────────────────────────────────────── */

  /**
   * A code that does not exist answers what one outside its window answers.
   *
   * The public preview endpoint would otherwise sort real campaign codes from imaginary ones for
   * anybody willing to spend an afternoon on it.
   */
  it('does not reveal whether a code exists', async () => {
    const notStarted = await coupon({ starts_offset_days: 5, ends_offset_days: 40 });

    expect(await refusal('NOSUCHCODE')).toBe(ERROR.COUPON_INVALID);
    expect(await refusal(notStarted)).toBe(ERROR.COUPON_NOT_STARTED);
  });

  it('refuses one that has expired, or been switched off', async () => {
    expect(
      await refusal(await coupon({ starts_offset_days: -40, ends_offset_days: -1 })),
    ).toBe(ERROR.COUPON_EXPIRED);

    expect(await refusal(await coupon({ is_active: false }))).toBe(ERROR.COUPON_INACTIVE);
  });

  it('refuses one that is fully redeemed', async () => {
    const code = await coupon({ max_redemptions: 3 });

    await db.execute(sql`UPDATE coupons SET redemptions_count = 3 WHERE code = ${code}`);

    expect(await refusal(code)).toBe(ERROR.COUPON_EXHAUSTED);
  });

  it('refuses a stay below the minimum', async () => {
    const code = await coupon({ min_booking_amount: '500.00' });

    expect(await refusal(code)).toBe(ERROR.COUPON_MINIMUM_NOT_MET);
  });

  /**
   * Scope: a null column means everywhere, a value means only there.
   *
   * Both directions are asserted — the control matters, because a scope check that refused
   * everything would pass a test that only ever looked for a refusal.
   */
  it('applies a city or partner scope, and only where it is set', async () => {
    const cityScoped = await coupon({ city_id: cityId });

    expect((await coupons.preview(cityScoped, stay())).discountAmount).toBe('20.000');
    expect(await refusal(cityScoped, stay({ cityId: otherCityId }))).toBe(
      ERROR.COUPON_NOT_FOR_CITY,
    );

    const partnerScoped = await coupon({ partner_id: partnerId });

    expect((await coupons.preview(partnerScoped, stay())).discountAmount).toBe('20.000');
    expect(await refusal(partnerScoped, stay({ partnerId: otherPartnerId }))).toBe(
      ERROR.COUPON_NOT_FOR_PARTNER,
    );
  });

  /**
   * A fixed coupon must match the booking's currency.
   *
   * Converting a marketing discount through an FX rate at the moment of redemption would make «50
   * off» mean a different thing to two customers on the same day, and it would fail outright for a
   * currency with no rate configured.
   */
  it('refuses a fixed coupon in another currency', async () => {
    const eur = await db.execute<{ id: string }>(sql`
      SELECT id FROM currencies WHERE code = 'EUR'
    `);

    const code = await coupon({
      value_kind: 'fixed',
      value: '30.00',
      currency_id: eur.rows[0]?.id,
    });

    expect(await refusal(code)).toBe(ERROR.COUPON_CURRENCY_MISMATCH);
  });

  /**
   * A coupon does nothing until the partner has taken it up (Bashar, 2026-09-01).
   *
   * ## Why this is a refusal rather than a filter
   *
   * A partner who was offered and has not answered, and one who refused, get the SAME answer as a
   * partner the coupon was never scoped to. That is deliberate: a customer must not be able to
   * learn from a checkout page which partners declined a promotion.
   *
   * The accepted case is the opposite control. Without it a `judge` that refused every coupon
   * would pass both of the refusal cases below and prove nothing.
   */
  describe('the partner has to have accepted it', () => {
    it('refuses a coupon the partner has not answered', async () => {
      const code = await coupon({ accepted: false });

      await db.execute(sql`
        INSERT INTO coupon_partners (coupon_id, partner_id)
        SELECT id, ${partnerId}::uuid FROM coupons WHERE code = ${code}
      `);

      expect(await refusal(code)).toBe(ERROR.COUPON_NOT_FOR_PARTNER);
    });

    it('refuses a coupon the partner rejected', async () => {
      const code = await coupon({ accepted: false });

      await db.execute(sql`
        INSERT INTO coupon_partners (coupon_id, partner_id, status, decided_at)
        SELECT id, ${partnerId}::uuid, 'rejected', now() FROM coupons WHERE code = ${code}
      `);

      expect(await refusal(code)).toBe(ERROR.COUPON_NOT_FOR_PARTNER);
    });

    it('refuses a coupon the partner was never offered', async () => {
      const code = await coupon({ accepted: false });

      expect(await refusal(code)).toBe(ERROR.COUPON_NOT_FOR_PARTNER);
    });

    it('prices one the partner accepted', async () => {
      const code = await coupon();

      await expect(coupons.preview(code, stay())).resolves.toMatchObject({
        code,
      });
    });
  });
});
