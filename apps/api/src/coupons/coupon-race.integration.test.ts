import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { inArray } from 'drizzle-orm';

import { createDatabase, schema, type Database } from '@safra/db';

import { CouponService } from './coupon.service.js';

/**
 * The last redemption of a campaign, contested.
 *
 * ## Why this file COMMITS
 *
 * `max_redemptions` is a race and not an exotic one: the last one of a hundred going to two people
 * at once is the ordinary shape of a campaign's final minute. Proving the lock works needs two
 * transactions genuinely in flight, and `createRollbackDatabase` pins ONE connection inside ONE
 * transaction — the "concurrent" calls would serialise and this would pass trivially, which is the
 * worst kind of green.
 *
 * The price is that everything here is permanent, so the fixtures are cleaned by id in `afterAll`.
 * Same reasoning, and the same trade, as `wallet-concurrency.integration.test.ts`.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('the last redemption of a coupon', () => {
  let db: Database;
  let coupons: CouponService;

  const madeCoupons: string[] = [];
  const madeProfiles: string[] = [];
  const madeBookings: string[] = [];

  let cityId = '';
  let partnerId = '';
  let usdId = '';

  beforeAll(async () => {
    /* Six, not one: a pool of one would serialise these into passing trivially. */
    db = createDatabase(DATABASE_URL as string, 6);
    coupons = new CouponService(db);

    const ref = await db.execute<{ city: string; partner: string; usd: string }>(sql`
      SELECT (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1)   AS city,
             (SELECT id FROM partners WHERE deleted_at IS NULL LIMIT 1) AS partner,
             (SELECT id FROM currencies WHERE code = 'USD')             AS usd
    `);

    const row = ref.rows[0];

    if (!row) throw new Error('No reference data.');

    cityId = row.city;
    partnerId = row.partner;
    usdId = row.usd;
  });

  afterAll(async () => {
    /*
      Cleaned by ID. `coupon_redemptions` is an ordinary table — unlike a wallet movement it is not
      append-only — so these can be removed rather than merely hidden, and a test that leaves
      campaign redemptions behind would distort the very counter it exists to test.
    */
    /*
      `inArray`, not `= ANY(${'${list}'}::uuid[])`.

      A JS array inside a `sql` template expands to a TUPLE, not a Postgres array, so the cast
      fails — a documented trap in this codebase and one that has cost a silent no-op delete before.
    */
    if (madeCoupons.length > 0) {
      await db.execute(
        sql`DELETE FROM coupon_redemptions WHERE ${inArray(schema.couponRedemptions.couponId, madeCoupons)}`,
      );
      /* The offer rows too — they reference the coupon and would block the delete below. */
      await db.execute(
        sql`DELETE FROM coupon_partners WHERE ${inArray(schema.couponPartners.couponId, madeCoupons)}`,
      );
      await db.execute(
        sql`DELETE FROM coupons WHERE ${inArray(schema.coupons.id, madeCoupons)}`,
      );
    }

    if (madeBookings.length > 0) {
      await db.execute(
        sql`DELETE FROM bookings WHERE ${inArray(schema.bookings.id, madeBookings)}`,
      );
    }

    if (madeProfiles.length > 0) {
      await db.execute(
        sql`UPDATE customer_profiles SET deleted_at = now()
            WHERE ${inArray(schema.customerProfiles.id, madeProfiles)}`,
      );
    }

    await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
  });

  /** A coupon with exactly `cap` redemptions left, and `n` customers about to want it. */
  async function campaign(cap: number): Promise<string> {
    const code = `RACE${Math.floor(Math.random() * 1e9)}`;

    const made = await db.execute<{ id: string }>(sql`
      INSERT INTO coupons
        (code, type, value_kind, value, starts_at, ends_at, max_redemptions,
         max_redemptions_per_customer, is_active)
      VALUES (${code}, 'campaign', 'percent', '10',
              now() - interval '1 day', now() + interval '30 days', ${cap}, 1, true)
      RETURNING id
    `);

    madeCoupons.push(made.rows[0]?.id ?? '');

    /*
      Accepted by the partner whose bookings these races redeem against. Since 2026-09-01 a coupon
      does nothing until its partner takes it up, and this file is about the LOCK — five customers
      arriving at once — not about the offer, so it starts where those cases begin.
    */
    await db.execute(sql`
      INSERT INTO coupon_partners (coupon_id, partner_id, status, decided_at)
      VALUES (${made.rows[0]?.id}::uuid, ${partnerId}::uuid, 'accepted', now())
    `);

    return code;
  }

  /** A customer and a booking for them to spend it on. */
  /** Each booking gets its own three-day window, because the unit refuses overlapping stays. */
  let slot = 0;

  async function customer(): Promise<{ profileId: string; bookingId: string }> {
    slot += 1;

    const made = await db.execute<{ profile: string; booking: string }>(sql`
      WITH cp AS (
        INSERT INTO customer_profiles (full_name, email, phone, is_guest)
        VALUES ('Coupon Race', 'race-' || gen_random_uuid() || '@safra.test',
                '+963900000113', false)
        RETURNING id
      ), un AS (
        SELECT u.id FROM units u
        JOIN properties p ON p.id = u.property_id
        WHERE p.partner_id = ${partnerId}::uuid AND u.deleted_at IS NULL
        LIMIT 1
      ), bk AS (
        INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                              check_in, check_out, guests_adults, status,
                              base_amount, customer_fee_value, customer_fee_amount,
                              partner_commission_rate, partner_commission_amount,
                              total_amount, partner_payable_amount, currency_id,
                              fx_rate_to_syp, total_syp, cancellation_policy_snapshot)
        SELECT cp.id, un.id, (SELECT property_id FROM units WHERE id = un.id),
               ${partnerId}::uuid, ${cityId}::uuid,
               current_date + (3000 + ${slot} * 4),
               current_date + (3002 + ${slot} * 4),
               2, 'pending_payment'::booking_status,
               '200.00', '9.00', '9.00', '0.0700', '14.00', '209.00', '186.00',
               ${usdId}::uuid, '13000.00000000', '2717000.00', '{"code":"flex"}'::jsonb
        FROM cp, un
        RETURNING id, customer_profile_id
      )
      SELECT bk.customer_profile_id AS profile, bk.id AS booking FROM bk
    `);

    const row = made.rows[0];

    if (!row) throw new Error('Could not make a customer with a booking.');

    madeProfiles.push(row.profile);
    madeBookings.push(row.booking);

    return { profileId: row.profile, bookingId: row.booking };
  }

  const context = (profileId: string) => ({
    baseAmount: '200.00',
    totalAmount: '209.00',
    currencyId: usdId,
    currencyCode: 'USD',
    currencyDecimals: 2,
    cityId,
    partnerId,
    customerProfileId: profileId,
  });

  /**
   * THE assertion: five customers, one redemption left, exactly one wins.
   *
   * ## What actually survives losing the lock, measured
   *
   * Removing `FOR UPDATE` does NOT break this case, and that is worth knowing rather than assuming:
   * `redeem()` also increments through `UPDATE … WHERE redemptions_count < max_redemptions`, and
   * that guard is atomic on its own. The global cap is protected twice.
   *
   * The per-customer limit is protected ONCE, by the lock — and the third case below is what fails
   * when it goes, with one customer redeeming twice. So that is the assertion pinning the lock, and
   * this one pins the conditional update. Neither substitutes for the other.
   */
  it('is won by exactly one of five customers arriving together', async () => {
    const code = await campaign(1);
    const people = await Promise.all([1, 2, 3, 4, 5].map(() => customer()));

    const outcomes = await Promise.allSettled(
      people.map((person) =>
        db.transaction(async (tx) =>
          coupons.redeem(
            tx as unknown as Database,
            code,
            context(person.profileId),
            person.bookingId,
          ),
        ),
      ),
    );

    const won = outcomes.filter((o) => o.status === 'fulfilled').length;

    expect(won, 'exactly one redemption, however many asked at once').toBe(1);

    /* And the counter agrees with the rows, which is what `redemptions_count` is a cache of. */
    const counted = await db.execute<{ counter: number; rows: string }>(sql`
      SELECT c.redemptions_count AS counter,
             (SELECT count(*)::text FROM coupon_redemptions r WHERE r.coupon_id = c.id) AS rows
      FROM coupons c WHERE c.code = ${code}
    `);

    expect(counted.rows[0]?.counter).toBe(1);
    expect(counted.rows[0]?.rows).toBe('1');
  });

  /** A cap of three, contested by five — three win, and the counter is not four. */
  it('hands out exactly the number budgeted', async () => {
    const code = await campaign(3);
    const people = await Promise.all([1, 2, 3, 4, 5].map(() => customer()));

    const outcomes = await Promise.allSettled(
      people.map((person) =>
        db.transaction(async (tx) =>
          coupons.redeem(
            tx as unknown as Database,
            code,
            context(person.profileId),
            person.bookingId,
          ),
        ),
      ),
    );

    expect(outcomes.filter((o) => o.status === 'fulfilled').length).toBe(3);

    const counted = await db.execute<{ counter: number }>(sql`
      SELECT redemptions_count AS counter FROM coupons WHERE code = ${code}
    `);

    expect(counted.rows[0]?.counter).toBe(3);
  });

  /**
   * And one customer cannot beat their own per-customer limit by asking twice at once.
   *
   * The cap here is generous — what stops the second is `max_redemptions_per_customer`, counted
   * under the same row lock.
   */
  it('holds the per-customer limit against one customer racing themselves', async () => {
    const code = await campaign(10);
    const person = await customer();
    const second = await customer();

    const outcomes = await Promise.allSettled([
      db.transaction(async (tx) =>
        coupons.redeem(
          tx as unknown as Database,
          code,
          context(person.profileId),
          person.bookingId,
        ),
      ),
      db.transaction(async (tx) =>
        coupons.redeem(
          tx as unknown as Database,
          code,
          context(person.profileId),
          second.bookingId,
        ),
      ),
    ]);

    expect(
      outcomes.filter((o) => o.status === 'fulfilled').length,
      'one customer, one redemption, however many requests',
    ).toBe(1);
  });
});
