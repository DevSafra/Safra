import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ERROR } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import { LedgerService } from '../ledger/ledger.service.js';
import { PricingService } from '../bookings/pricing.service.js';
import { SettingsService } from '../settings/settings.service.js';
import type { FxRateService } from '../fx/fx-rate.service.js';

/**
 * A coupon from the stay it discounts to the books that record it.
 *
 * ## What this holds that the unit tests cannot
 *
 * `coupon.integration.test.ts` proves every rule in isolation. This proves the two things that only
 * appear when the pieces are joined:
 *
 * 1. **The partner is owed the same** whatever the customer paid. A discount is SAFRA's, and a
 *    pricing engine that quietly took it out of `partner_payable_amount` would be taking the
 *    partner's money — silently, because every total would still look consistent.
 * 2. **The capture group balances.** It balances on `total = fee + commission + payable`, and a
 *    discount makes the customer pay less while the credits stay the same. Without the
 *    `coupon_discount` leg the deferred constraint trigger refuses the whole capture — which is the
 *    right failure, and the reason that leg exists.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('a booking discounted by a coupon', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  const fx = {
    rateToSyp: () => Promise.resolve('13000.00000000'),
    decimalsOf: () => Promise.resolve(2),
  } as unknown as FxRateService;

  const pricing = new PricingService(db, new SettingsService(db), fx);
  const ledger = new LedgerService(db);

  let unitId = '';

  beforeEach(async () => {
    await harness.begin();

    const made = await db.execute<{ unit: string }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1) AS city_id,
               (SELECT id FROM currencies WHERE code = 'USD')           AS currency_id,
               (SELECT id FROM property_types LIMIT 1)                  AS type_id,
               (SELECT id FROM partner_types LIMIT 1)                   AS partner_type_id,
               (SELECT id FROM cancellation_policies LIMIT 1)           AS policy_id
      ), pu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('cb-' || gen_random_uuid() || '@safra.test', '+963900000120', 'partner', 'active')
        RETURNING id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT pu.id, ref.partner_type_id, 'Coupon Booking', 'كوبون', ref.city_id, 'x',
               '+963900000120', 'cb-' || gen_random_uuid() || '@safra.test', 'approved'
        FROM pu, ref RETURNING id
      ), pr AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, address, status)
        SELECT pa.id, ref.city_id, ref.type_id, ref.policy_id,
               'coupon-booking-' || gen_random_uuid(), 'عقار', 'Prop', 'Prop', 'x', 'published'
        FROM pa, ref RETURNING id
      )
      INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price,
                         currency_id, is_active)
      SELECT pr.id, 'وحدة', 'Unit', 'Einheit', 4, '100.00', ref.currency_id, true
      FROM pr, ref
      RETURNING id AS unit
    `);

    unitId = made.rows[0]?.unit ?? '';
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  const dates = { checkIn: '', checkOut: '' };

  beforeEach(() => {
    /* Far out, so nothing else in the suite has taken these nights on this fresh unit. */
    const start = new Date(Date.now() + 900 * 86_400_000);
    const end = new Date(start.getTime() + 2 * 86_400_000);

    dates.checkIn = start.toISOString().slice(0, 10);
    dates.checkOut = end.toISOString().slice(0, 10);
  });

  /**
   * The partner is owed the same, discounted or not.
   *
   * Watched to fail by deriving `payableMinor` from the discounted total instead of the base: the
   * partner then silently funds every campaign SAFRA runs.
   */
  it('takes the discount from the customer and not from the partner', async () => {
    const full = await pricing.quote({ unitId, ...dates });
    const discounted = await pricing.quote({ unitId, ...dates, discountAmount: '25.00' });

    expect(Number(discounted.totalAmount)).toBe(Number(full.totalAmount) - 25);
    /*
      At the CURRENCY's scale, which is what `PriceBreakdown` formats to — `CouponService` quantises
      to `MONEY_SCALE` and spells the same amount `25.000`. Compared by value for that reason.
    */
    expect(Number(discounted.discountAmount)).toBe(25);

    expect(
      discounted.partnerPayableAmount,
      'the partner is owed what the stay is worth, whatever SAFRA discounted',
    ).toBe(full.partnerPayableAmount);

    expect(discounted.partnerCommissionAmount).toBe(full.partnerCommissionAmount);
    expect(discounted.customerFeeAmount).toBe(full.customerFeeAmount);
  });

  /** A discount can never exceed what is being paid — pricing refuses an invented figure. */
  it('refuses a discount larger than the booking', async () => {
    const full = await pricing.quote({ unitId, ...dates });

    await expect(
      pricing.quote({
        unitId,
        ...dates,
        discountAmount: String(Number(full.totalAmount) + 1),
      }),
    ).rejects.toMatchObject({ response: { code: ERROR.VALIDATION_AMOUNT_POSITIVE } });
  });

  /**
   * THE assertion: the capture group balances with a discount in it.
   *
   * The trigger is deferred, so an unbalanced group is refused at COMMIT rather than on insert —
   * which is why this posts inside a transaction that is then flushed. Watched to fail by removing
   * the `coupon_discount` leg: the group is short by exactly the discount and the whole capture is
   * rejected.
   */
  it('posts a capture that balances, with the discount as its own leg', async () => {
    const priced = await pricing.quote({ unitId, ...dates, discountAmount: '25.00' });

    const booking = await db.execute<{
      id: string;
      profile: string;
      partner: string;
    }>(sql`
      WITH cp AS (
        INSERT INTO customer_profiles (full_name, email, phone, is_guest)
        VALUES ('نزيل', 'cbk-' || gen_random_uuid() || '@safra.test', '+963900000121', false)
        RETURNING id
      )
      INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                            check_in, check_out, guests_adults, status,
                            base_amount, customer_fee_value, customer_fee_amount,
                            partner_commission_rate, partner_commission_amount,
                            total_amount, discount_amount, partner_payable_amount, currency_id,
                            fx_rate_to_syp, total_syp, cancellation_policy_snapshot)
      SELECT cp.id, u.id, u.property_id, p.partner_id, p.city_id,
             ${dates.checkIn}::date, ${dates.checkOut}::date, 2, 'pending_confirmation'::booking_status,
             ${priced.baseAmount}::numeric, ${priced.customerFeeValue}::numeric,
             ${priced.customerFeeAmount}::numeric,
             ${priced.partnerCommissionRate}::numeric, ${priced.partnerCommissionAmount}::numeric,
             ${priced.totalAmount}::numeric, ${priced.discountAmount}::numeric,
             ${priced.partnerPayableAmount}::numeric, ${priced.currencyId}::uuid,
             ${priced.fxRateToSyp}::numeric, ${priced.totalSyp}::numeric,
             '{"code":"flex"}'::jsonb
      FROM units u JOIN properties p ON p.id = u.property_id, cp
      WHERE u.id = ${unitId}
      RETURNING id, customer_profile_id AS profile, partner_id AS partner
    `);

    const row = booking.rows[0];

    if (!row) throw new Error('Seed produced no booking.');

    const payment = await db.execute<{ id: string }>(sql`
      INSERT INTO payments (booking_id, provider, method, amount, currency_id, status)
      VALUES (${row.id}::uuid, 'manual_transfer', 'bank_transfer',
              ${priced.totalAmount}::numeric, ${priced.currencyId}::uuid, 'captured')
      RETURNING id
    `);

    const { entryGroupId } = await ledger.postBookingPayment(
      db,
      {
        id: row.id,
        partnerId: row.partner,
        customerProfileId: row.profile,
        currencyId: priced.currencyId,
        fxRateToSyp: priced.fxRateToSyp,
        totalAmount: priced.totalAmount,
        customerFeeAmount: priced.customerFeeAmount,
        partnerCommissionAmount: priced.partnerCommissionAmount,
        partnerPayableAmount: priced.partnerPayableAmount,
        discountAmount: priced.discountAmount,
        reference: 'BKG-COUPON-TEST',
      },
      payment.rows[0]?.id ?? '',
    );

    const legs = await db.execute<{
      account: string;
      direction: string;
      amount: string;
    }>(sql`
      SELECT account::text, direction::text, amount::text FROM ledger_entries
      WHERE entry_group_id = ${entryGroupId}::uuid ORDER BY account::text
    `);

    const accounts = legs.rows.map((leg) => `${leg.account}:${leg.direction}`);

    expect(accounts, 'the discount is a debit beside the money that arrived').toContain(
      'coupon_discount:debit',
    );

    /* Debits equal credits — what the deferred trigger checks, asserted where it can be read. */
    /*
      Summed in MINOR UNITS, not as floats.

      `reduce` over `Number(...)` produced 8.88e-15 for a group that balances exactly — money
      arithmetic in IEEE-754, in the test for a ledger whose whole point is that money is never a
      float. Integers, and the assertion means what it says.
    */
    const net = legs.rows.reduce(
      (sum, leg) =>
        sum +
        (leg.direction === 'debit' ? 1n : -1n) *
          BigInt(Math.round(Number(leg.amount) * 1000)),
      0n,
    );

    expect(net, 'the capture group balances').toBe(0n);

    /* And the discount leg is exactly the discount, not a plug figure that happens to balance. */
    const discountLeg = legs.rows.find((leg) => leg.account === 'coupon_discount');

    expect(Number(discountLeg?.amount)).toBe(25);
  });
});
