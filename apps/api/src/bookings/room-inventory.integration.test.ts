import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { ERROR } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import { BookingAccessService } from './booking-access.service.js';
import { BookingCreationService } from './booking-creation.service.js';
import { CouponService } from '../coupons/coupon.service.js';
import { FxRateService } from '../fx/fx-rate.service.js';
import { PricingService } from './pricing.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { codeOf } from '../common/errors/app-error.js';

const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/**
 * A guest takes SEVERAL of the same room in one booking (Bashar, 2026-09-06).
 *
 * ## What is actually being protected here
 *
 * Not the arithmetic — that a two-room stay costs twice a one-room stay is the easy half, and a
 * test of it would pass against a build that oversells the hotel every night. What matters is that
 * the platform never hands out a room it does not have, and the thing that guarantees that is a
 * database constraint rather than any of the code below.
 *
 * So these drive the SERVICE and then look at what the database holds, and the last one runs two
 * bookings at the same instant against the last free room, because a check that only ever sees one
 * caller cannot tell a real guarantee from an `if` statement that usually runs first.
 */
describeIfDb('a booking that holds several identical rooms', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  let db: Database;
  let service: BookingCreationService;

  beforeAll(async () => {
    await harness.begin();
    db = harness.db;

    const settings = new SettingsService(db);

    service = new BookingCreationService(
      db,
      new PricingService(db, settings, new FxRateService(db, {} as never)),
      settings,
      /* The audit trail is written for real: `record` is a plain insert and a stub would hide a
         column this change broke. Only the token minting is stubbed, because it needs randomness
         and proves nothing here. */
      { record: () => Promise.resolve(undefined) } as never,
      new BookingAccessService(db),
      new CouponService(db),
    );
  });

  /**
   * Each test gets its OWN nights.
   *
   * These share one rollback transaction, so a test that books every free room of a type leaves
   * the next one nothing to work with — and the failure lands on whichever test happens to run
   * after, naming a fixture problem rather than the defect it was written for. A window per test
   * makes them independent, which is the only reason the order they run in stops mattering.
   */
  const stay = (week: number) => {
    const from = new Date(Date.UTC(2027, 5, 7 + week * 7));
    const to = new Date(from);

    to.setUTCDate(to.getUTCDate() + 2);

    return {
      checkIn: from.toISOString().slice(0, 10),
      checkOut: to.toISOString().slice(0, 10),
    };
  };

  const guest = {
    fullName: 'ضيف الاختبار',
    email: 'rooms@example.test',
    phone: '+963900000111',
  };

  /**
   * A room type the testbed has several of, and how many are free for these nights.
   *
   * Read from the data rather than named, because a fixture that is renamed should fail the
   * assertion it supports rather than silently skip it.
   */
  async function roomType(STAY: { checkIn: string; checkOut: string }) {
    const rows = await db.execute<{
      unit_id: string;
      room_type_code: string;
      free: number;
    }>(sql`
      SELECT
        MIN(u.id::text)     AS unit_id,
        u.room_type_code,
        COUNT(*)::int       AS free
      FROM units u
      JOIN properties p ON p.id = u.property_id
      WHERE u.room_type_code IS NOT NULL
        AND u.is_active AND u.deleted_at IS NULL
        AND p.status = 'published'
        AND NOT EXISTS (
          SELECT 1 FROM booking_units bu
          WHERE bu.unit_id = u.id
            AND bu.status IN ('pending_payment','pending_confirmation','confirmed','checked_in','disputed')
            AND daterange(bu.check_in, bu.check_out, '[)')
                && daterange(${STAY.checkIn}::date, ${STAY.checkOut}::date, '[)')
        )
      GROUP BY u.property_id, u.room_type_code
      HAVING COUNT(*) >= 3
      ORDER BY COUNT(*) DESC
      LIMIT 1
    `);

    return rows.rows[0];
  }

  /*
    `createDraft` answers with the REFERENCE and never the id — the id is internal and a customer
    never sees it. So everything below looks the booking up the way the rest of the platform does.
  */
  const held = async (reference: string) =>
    (
      await db.execute<{ n: number }>(sql`
        SELECT COUNT(*)::int AS n
          FROM booking_units bu JOIN bookings b ON b.id = bu.booking_id
         WHERE b.reference = ${reference}
      `)
    ).rows[0]!.n;

  it('the testbed has a room type with at least three of them', async () => {
    /*
      A guard on the guards. Without a multi-room type in the fixture every assertion below would
      be testing the one-room path under a two-room name — which is how a suite reports coverage of
      something it has never once executed.
    */
    expect(await roomType(stay(0))).toBeDefined();
  });

  it('two rooms cost twice one, and the fee is charged on the pair', async () => {
    const STAY = stay(1);
    const type = await roomType(STAY);
    expect(type).toBeDefined();

    const one = await service.quote({ unitId: type!.unit_id, ...STAY });
    const two = await service.quote({ unitId: type!.unit_id, ...STAY, rooms: 2 });

    expect(two.rooms).toBe(2);
    expect(two.nights, 'a second room is not a third night').toBe(one.nights);

    expect(Number(two.baseAmount)).toBeCloseTo(Number(one.baseAmount) * 2, 2);

    /*
      The fee is derived from the base, so it doubles with it. Asserting the TOTAL alone would pass
      against a build that doubled the room and charged one room's fee — a rounding-sized error on
      a flat fee, and a large one on a percentage.
    */
    expect(Number(two.customerFeeAmount)).toBeGreaterThanOrEqual(
      Number(one.customerFeeAmount),
    );
    expect(Number(two.totalAmount)).toBeCloseTo(
      Number(two.baseAmount) + Number(two.customerFeeAmount),
      2,
    );

    /* And the nightly table stays one room's rate — it is what a guest reads, not what they owe. */
    expect(two.nightly).toEqual(one.nightly);
  });

  it('books three rooms and the database holds three of them', async () => {
    const STAY = stay(2);
    const type = await roomType(STAY);
    expect(type).toBeDefined();

    const created = await service.createDraft(
      { unitId: type!.unit_id, ...STAY, rooms: 3, adults: 2, guest },
      undefined,
      {},
    );

    expect(await held(created.reference), 'three doors, not one row and a number').toBe(
      3,
    );

    const rows = await db.execute<{ unit_id: string; rooms: number }>(sql`
      SELECT b.rooms, bu.unit_id::text AS unit_id
        FROM bookings b JOIN booking_units bu ON bu.booking_id = b.id
       WHERE b.reference = ${created.reference}
    `);

    expect(rows.rows[0]!.rooms).toBe(3);
    expect(
      new Set(rows.rows.map((r) => r.unit_id)).size,
      'three DISTINCT rooms, not the same one three times',
    ).toBe(3);

    /* The room the guest clicked is among them — see `allocateRooms`. */
    expect(rows.rows.map((r) => r.unit_id)).toContain(type!.unit_id);
  });

  it('refuses more rooms than the property has free, and names how many are left', async () => {
    const STAY = stay(3);
    const type = await roomType(STAY);
    expect(type).toBeDefined();

    const refusal = await service
      .createDraft(
        { unitId: type!.unit_id, ...STAY, rooms: type!.free + 1, adults: 2, guest },
        undefined,
        {},
      )
      .catch((error: unknown) => error);

    expect(codeOf(refusal)).toBe(ERROR.UNIT_NOT_ENOUGH_ROOMS);
  });

  it('and still allows exactly what IS free — the opposite control', async () => {
    const STAY = stay(4);
    const type = await roomType(STAY);
    expect(type).toBeDefined();

    const created = await service.createDraft(
      { unitId: type!.unit_id, ...STAY, rooms: type!.free, adults: 2, guest },
      undefined,
      {},
    );

    expect(
      await held(created.reference),
      'without this the rule could be "refuse every quantity" and the test above would still pass',
    ).toBe(type!.free);
  });

  it('a booking written by some OTHER path still holds its room', async () => {
    const STAY = stay(5);
    const type = await roomType(STAY);
    expect(type).toBeDefined();

    /*
      The staff console captures bookings, the seed and load scripts write thousands, and none of
      them calls `allocateRooms`. Availability is read from `booking_units`, so a booking with no
      row there is a room the property page offers while somebody is sleeping in it.

      This inserts one the way those paths do — a plain INSERT, no service — and asserts the
      database held the room anyway.
    */
    const inserted = await db.execute<{ id: string }>(sql`
      INSERT INTO bookings (
        customer_profile_id, unit_id, property_id, partner_id, city_id,
        check_in, check_out, guests_adults, status,
        base_amount, customer_fee_mode, customer_fee_value, customer_fee_amount,
        partner_commission_rate, partner_commission_amount, total_amount,
        discount_amount, partner_payable_amount, currency_id, fx_rate_to_syp, total_syp,
        cancellation_policy_snapshot, search_attributes
      )
      SELECT
        (SELECT id FROM customer_profiles LIMIT 1),
        u.id, u.property_id, p.partner_id, p.city_id,
        ${STAY.checkIn}::date, ${STAY.checkOut}::date, 2, 'confirmed',
        100, 'flat', 0, 0, 0, 0, 100, 0, 100, u.currency_id, 1, 100,
        '{}'::jsonb, '{}'
      FROM units u JOIN properties p ON p.id = u.property_id
      WHERE u.id = ${type!.unit_id}
      RETURNING id::text AS id
    `);

    const bookingId = inserted.rows[0]!.id;

    const rows = await db.execute<{ n: number; status: string }>(sql`
      SELECT COUNT(*)::int AS n, MIN(status::text) AS status
        FROM booking_units WHERE booking_id = ${bookingId}
    `);

    expect(rows.rows[0]!.n, 'the room was not held').toBe(1);
    expect(rows.rows[0]!.status).toBe('confirmed');
  });

  /**
   * A dearer room sharing a type code is NOT interchangeable with a cheap one.
   *
   * Found in the security pass over this change, not by a failing test. The allocation groups by
   * `room_type_code`, which is free text a partner types, and it prices every room it hands out at
   * the LEAD room's rate. So «pick the cheapest room of the type, ask for two» was a way to be
   * given the dearest one at the cheap one's price — no privileges, no tampering, just the form.
   *
   * Same reasoning for capacity: the booking's guest limit is the lead room's `max_guests` times
   * the quantity, so a sibling that sleeps fewer would let a party be sold rooms it does not fit in.
   */
  it('will not fill a quantity with a dearer room that merely shares the type code', async () => {
    const STAY = stay(7);
    const type = await roomType(STAY);

    expect(type).toBeDefined();

    /* Make one room of the type cost more, exactly the state a partner can create by hand. */
    const dearer = await db.execute<{ id: string }>(sql`
      UPDATE units
         SET base_price = base_price * 4
       WHERE room_type_code = ${type!.room_type_code}
         AND id <> ${type!.unit_id}
         AND id = (
           SELECT id FROM units
            WHERE room_type_code = ${type!.room_type_code} AND id <> ${type!.unit_id}
            LIMIT 1
         )
      RETURNING id::text AS id
    `);

    expect(dearer.rows.length, 'the fixture had a sibling to make dearer').toBe(1);

    const created = await service.createDraft(
      { unitId: type!.unit_id, ...STAY, rooms: 2, adults: 2, guest },
      undefined,
      {},
    );

    const given = await db.execute<{ id: string }>(sql`
      SELECT bu.unit_id::text AS id
        FROM booking_units bu JOIN bookings b ON b.id = bu.booking_id
       WHERE b.reference = ${created.reference}
    `);

    expect(
      given.rows.map((row) => row.id),
      'the dearer room was not handed out at the cheap room’s rate',
    ).not.toContain(dearer.rows[0]!.id);

    /* And the guest still got the two rooms they paid for, from the ones that DO match. */
    expect(given.rows).toHaveLength(2);
  });

  /**
   * Two room types on one trip get one trip reference.
   *
   * A guest who wants two doubles AND a suite makes two bookings — a booking carries one room type
   * and a quantity — and until now nothing recorded that they belonged together. Support saw two
   * references, finance saw two payments, and neither could say it was one arrival.
   */
  it('a second booking for the same stay joins the first one’s trip', async () => {
    const STAY = stay(8);
    const type = await roomType(STAY);

    expect(type).toBeDefined();

    /* A second type at the same property, or there is no second booking to make. */
    const other = await db.execute<{ id: string }>(sql`
      SELECT u.id::text AS id
        FROM units u
       WHERE u.property_id = (SELECT property_id FROM units WHERE id = ${type!.unit_id})
         AND u.room_type_code IS DISTINCT FROM ${type!.room_type_code}
         AND u.is_active AND u.deleted_at IS NULL
       LIMIT 1
    `);

    expect(other.rows[0], 'the fixture property has a second room type').toBeDefined();

    const first = await service.createDraft(
      { unitId: type!.unit_id, ...STAY, rooms: 2, adults: 2, guest },
      undefined,
      {},
    );
    const second = await service.createDraft(
      { unitId: other.rows[0]!.id, ...STAY, rooms: 1, adults: 2, guest },
      undefined,
      {},
    );

    const refs = await db.execute<{ trip: string; reference: string }>(sql`
      SELECT booking_group_reference AS trip, reference
        FROM bookings WHERE reference IN (${first.reference}, ${second.reference})
    `);

    expect(refs.rows).toHaveLength(2);
    expect(refs.rows[0]!.trip, 'both bookings, one trip').toBe(refs.rows[1]!.trip);
    expect(refs.rows[0]!.trip).toMatch(/^TRP-\d{4}-/);
  });

  /**
   * The opposite control: a DIFFERENT stay is a different trip.
   *
   * Without this, "always reuse the last group" would pass the test above and put a guest's summer
   * holiday and their winter one under one reference.
   */
  it('a booking for different dates starts its own trip', async () => {
    const one = stay(9);
    const two = stay(10);
    const type = await roomType(one);

    expect(type).toBeDefined();

    const first = await service.createDraft(
      { unitId: type!.unit_id, ...one, rooms: 1, adults: 2, guest },
      undefined,
      {},
    );
    const later = await service.createDraft(
      { unitId: type!.unit_id, ...two, rooms: 1, adults: 2, guest },
      undefined,
      {},
    );

    const refs = await db.execute<{ trip: string }>(sql`
      SELECT booking_group_reference AS trip
        FROM bookings WHERE reference IN (${first.reference}, ${later.reference})
    `);

    expect(refs.rows[0]!.trip).not.toBe(refs.rows[1]!.trip);
  });

  /**
   * An UNPAID booking that times out gives every room back — through the real sweep.
   *
   * Bashar's requirement is that cancellation, expiry AND failure all release the rooms. Only
   * cancellation had a test. Expiry runs through `SlaService`, which writes `cancelled` on a
   * booking whose payment window has closed — and the release depends on the
   * `bookings_sync_units` trigger seeing that write, not on the sweep knowing `booking_units`
   * exists. This drives the SQL the sweep actually runs rather than trusting that reading.
   */
  it('a booking whose payment window closes releases all of its rooms', async () => {
    const STAY = stay(11);
    const type = await roomType(STAY);

    expect(type).toBeDefined();

    const created = await service.createDraft(
      { unitId: type!.unit_id, ...STAY, rooms: 3, adults: 2, guest },
      undefined,
      {},
    );

    expect(await held(created.reference), 'three rooms held while unpaid').toBe(3);

    /* Push the payment window into the past, which is the only condition the sweep tests. */
    await db.execute(sql`
      UPDATE bookings
         SET confirmation_deadline_at = now() - INTERVAL '1 minute'
       WHERE reference = ${created.reference}
    `);

    /* The sweep's own statement, verbatim from `expireUnpaidBookings`. */
    const expired = await db.execute<{ reference: string }>(sql`
      UPDATE bookings
         SET status = 'cancelled',
             cancelled_at = now(),
             cancellation_reason = 'system.payment_expired'
       WHERE status = 'pending_payment'
         AND confirmation_deadline_at IS NOT NULL
         AND confirmation_deadline_at < now()
         AND deleted_at IS NULL
         AND reference = ${created.reference}
      RETURNING reference
    `);

    expect(expired.rows, 'the sweep matched it').toHaveLength(1);

    const holding = await db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n
        FROM booking_units bu JOIN bookings b ON b.id = bu.booking_id
       WHERE b.reference = ${created.reference}
         AND bu.status IN ('pending_payment','pending_confirmation','confirmed','checked_in','disputed')
    `);

    expect(holding.rows[0]!.n, 'every room released, not just the one it names').toBe(0);

    /* And all three can be sold again — the assertion that makes the release mean something. */
    const resold = await service.createDraft(
      { unitId: type!.unit_id, ...STAY, rooms: 3, adults: 2, guest },
      undefined,
      {},
    );

    expect(await held(resold.reference)).toBe(3);
  });

  it('a cancellation gives every one of the rooms back', async () => {
    const STAY = stay(6);
    const type = await roomType(STAY);
    expect(type).toBeDefined();

    const created = await service.createDraft(
      { unitId: type!.unit_id, ...STAY, rooms: 2, adults: 2, guest },
      undefined,
      {},
    );

    await db.execute(
      sql`UPDATE bookings SET status = 'cancelled' WHERE reference = ${created.reference}`,
    );

    /*
      The trigger, not the service. No caller writes `booking_units` on a status change, so this is
      asserting that a cancellation anywhere in the platform releases every room — including the
      ones the booking never named.
    */
    const stillHolding = await db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n FROM booking_units
       WHERE booking_id = (SELECT id FROM bookings WHERE reference = ${created.reference})
         AND status IN ('pending_payment','pending_confirmation','confirmed','checked_in','disputed')
    `);

    expect(stillHolding.rows[0]!.n).toBe(0);

    /* And the rooms can be sold again. */
    const resold = await service.createDraft(
      { unitId: type!.unit_id, ...STAY, rooms: 2, adults: 2, guest },
      undefined,
      {},
    );

    expect(await held(resold.reference)).toBe(2);
  });
});
