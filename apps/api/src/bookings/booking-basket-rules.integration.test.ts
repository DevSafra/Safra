import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ERROR } from '@safra/contracts';
import {
  createRollbackDatabase,
  ensureRetiredCurrencies,
  type Database,
} from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { codeOf } from '../common/errors/app-error.js';
import { CouponService } from '../coupons/coupon.service.js';
import type { FxRateService } from '../fx/fx-rate.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { BookingAccessService } from './booking-access.service.js';
import { BookingCreationService } from './booking-creation.service.js';
import { PricingService } from './pricing.service.js';

/**
 * A basket of room types obeys every rule its rooms carry, and is charged for what it holds.
 *
 * ## Three defects, one shape
 *
 * A basket («مزدوجة × 2، جناح × 1») was judged by its LEAD line and assumed to be like it:
 *
 *  - its currency, FX snapshot and commission cap came from the first row, so a basket mixing a
 *    USD room and a EUR room summed two currencies into one figure;
 *  - `min_nights`, `max_nights` and the arrival-day minimum were checked for the lead unit only,
 *    so a suite that takes three nights could ride along on a one-night stay;
 *  - a line naming the same room twice, or two rooms of one interchangeable type, was PRICED per
 *    line and ALLOCATED from one pool, so the guest paid for rooms the booking did not hold.
 *
 * Every fixture is this file's own, inside the rollback: a property with exactly the rooms each
 * rule needs, so nothing here depends on what a developer database happens to contain.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('a basket of room types', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  const fx = {
    rateToSyp: () => Promise.resolve('13000.00000000'),
    decimalsOf: () => Promise.resolve(2),
  } as unknown as FxRateService;

  const settings = new SettingsService(db);
  const service = new BookingCreationService(
    db,
    new PricingService(db, settings, fx),
    settings,
    new AuditService(db),
    new BookingAccessService(db),
    new CouponService(db),
  );

  /** The rooms, by what each one is for. */
  let rooms = {
    double: '',
    doubleTwin: '',
    suite: '',
    euro: '',
    strictArrival: '',
  };

  /* Far enough out that the same-day cutoff and every live booking are irrelevant. */
  const CHECK_IN = dayFromNow(1500);
  const stay = (nights: number) => ({
    checkIn: CHECK_IN,
    checkOut: dayFromNow(1500 + nights),
  });

  const guest = {
    fullName: 'ضيف السلة',
    email: 'basket@example.test',
    phone: '+963900000141',
  };

  beforeEach(async () => {
    await harness.begin();
    await ensureRetiredCurrencies(db);
    rooms = await aProperty();
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  const create = (
    lead: string,
    additionalLines: { unitId: string; rooms: number }[],
    nights = 2,
    leadRooms = 1,
  ) =>
    service.createDraft(
      {
        unitId: lead,
        rooms: leadRooms,
        additionalLines,
        ...stay(nights),
        adults: 2,
        guest,
      },
      undefined,
      {},
    );

  const quote = (lines: { unitId: string; rooms: number }[], nights = 2) =>
    service.quote({ unitId: lines[0]!.unitId, lines, ...stay(nights) });

  const refusalOf = (attempt: Promise<unknown>) =>
    attempt.then(
      () => undefined,
      (error: unknown) => codeOf(error),
    );

  /* ── 5. One currency per basket ────────────────────────────────────────────────────────── */

  it('refuses to quote a basket whose rooms are priced in two currencies', async () => {
    expect(
      await refusalOf(
        quote([
          { unitId: rooms.double, rooms: 1 },
          { unitId: rooms.euro, rooms: 1 },
        ]),
      ),
    ).toBe(ERROR.BOOKING_BASKET_MIXED_CURRENCY);
  });

  it('refuses to book one', async () => {
    expect(
      await refusalOf(create(rooms.double, [{ unitId: rooms.euro, rooms: 1 }])),
    ).toBe(ERROR.BOOKING_BASKET_MIXED_CURRENCY);
  });

  /* ── 6. Every room's own stay rules ────────────────────────────────────────────────────── */

  it('applies an extra room’s minimum stay, on the quote and on the booking', async () => {
    const lines = [
      { unitId: rooms.double, rooms: 1 },
      { unitId: rooms.suite, rooms: 1 },
    ];

    expect(await refusalOf(quote(lines))).toBe(ERROR.UNIT_MIN_NIGHTS);
    expect(
      await refusalOf(create(rooms.double, [{ unitId: rooms.suite, rooms: 1 }])),
    ).toBe(ERROR.UNIT_MIN_NIGHTS);
  });

  it('applies an extra room’s maximum stay', async () => {
    expect(
      await refusalOf(create(rooms.double, [{ unitId: rooms.suite, rooms: 1 }], 6)),
    ).toBe(ERROR.UNIT_MAX_NIGHTS);
  });

  it('applies an extra room’s arrival-day minimum', async () => {
    const lines = [
      { unitId: rooms.double, rooms: 1 },
      { unitId: rooms.strictArrival, rooms: 1 },
    ];

    expect(await refusalOf(quote(lines))).toBe(ERROR.BOOKING_ARRIVAL_MINIMUM_NIGHTS);
    expect(
      await refusalOf(create(rooms.double, [{ unitId: rooms.strictArrival, rooms: 1 }])),
    ).toBe(ERROR.BOOKING_ARRIVAL_MINIMUM_NIGHTS);
  });

  /** The control: a stay every room accepts is booked, both rooms held. */
  it('books a basket whose every room accepts the stay', async () => {
    const created = await create(rooms.double, [{ unitId: rooms.suite, rooms: 1 }], 3);

    expect(await heldFor(created.reference)).toStrictEqual({
      held: 2,
      rooms: 2,
      matches: true,
    });
  });

  /* ── 7. Charged equals held ────────────────────────────────────────────────────────────── */

  /**
   * The same room named twice is ONE line of two. Watched to fail against the old code: two rooms
   * were charged and one was held, because the second line re-allocated the first line's room.
   */
  it('merges a room named twice into one line, and holds every room it charges', async () => {
    const created = await create(rooms.double, [{ unitId: rooms.double, rooms: 1 }]);

    expect(await heldFor(created.reference)).toStrictEqual({
      held: 2,
      rooms: 2,
      matches: true,
    });
  });

  it('refuses two lines of one interchangeable room type', async () => {
    expect(
      await refusalOf(create(rooms.double, [{ unitId: rooms.doubleTwin, rooms: 2 }])),
    ).toBe(ERROR.BOOKING_BASKET_DUPLICATE_TYPE);
  });

  /** How many rooms the booking holds, what it says it holds, and whether the money agrees. */
  async function heldFor(reference: string) {
    const rows = await db.execute<{ held: number; rooms: number; matches: boolean }>(sql`
      SELECT (SELECT count(*)::int FROM booking_units bu WHERE bu.booking_id = b.id) AS held,
             b.rooms,
             (SELECT sum(bu.accommodation_amount) FROM booking_units bu
               WHERE bu.booking_id = b.id) = b.base_amount AS matches
      FROM bookings b WHERE b.reference = ${reference}
    `);

    return rows.rows[0];
  }

  function dayFromNow(days: number): string {
    const day = new Date();

    day.setUTCDate(day.getUTCDate() + days);

    return day.toISOString().slice(0, 10);
  }

  /** One published property holding each room a rule above needs. */
  async function aProperty(): Promise<typeof rooms> {
    const made = await db.execute<{
      double: string;
      double_twin: string;
      suite: string;
      euro: string;
      strict_arrival: string;
    }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1) AS city_id,
               (SELECT id FROM currencies WHERE code = 'USD')           AS usd_id,
               (SELECT id FROM currencies WHERE code = 'EUR')           AS eur_id,
               (SELECT id FROM property_types LIMIT 1)                  AS type_id,
               (SELECT id FROM partner_types LIMIT 1)                   AS partner_type_id,
               (SELECT id FROM cancellation_policies LIMIT 1)           AS policy_id
      ), pu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('bsk-' || gen_random_uuid() || '@safra.test', '+963900000140', 'partner', 'active')
        RETURNING id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT pu.id, ref.partner_type_id, 'Basket', 'سلة', ref.city_id, 'x',
               '+963900000140', 'bsk-' || gen_random_uuid() || '@safra.test', 'approved'
        FROM pu, ref RETURNING id
      ), pr AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, address, status)
        SELECT pa.id, ref.city_id, ref.type_id, ref.policy_id,
               'basket-' || gen_random_uuid(), 'فندق السلة', 'Basket', 'Basket', 'x', 'published'
        FROM pa, ref RETURNING id
      ), un AS (
        INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price,
                           currency_id, room_type_code, unit_label, min_nights, max_nights)
        SELECT pr.id, v.name, v.name, v.name, 2, v.price::numeric,
               CASE WHEN v.euro THEN ref.eur_id ELSE ref.usd_id END,
               v.type_code, v.label, v.min_nights, v.max_nights
        FROM pr, ref, (VALUES
          ('مزدوجة',  '100.00', false, 'dbl', 'A', 1, NULL::int),
          ('مزدوجة',  '100.00', false, 'dbl', 'B', 1, NULL::int),
          ('مزدوجة',  '100.00', false, 'dbl', 'C', 1, NULL::int),
          ('جناح',    '200.00', false, 'ste', 'S', 3, 5),
          ('يورو',    '100.00', true,  'eur', 'E', 1, NULL::int),
          ('وصول',    '120.00', false, 'arr', 'R', 1, NULL::int)
        ) AS v(name, price, euro, type_code, label, min_nights, max_nights)
        RETURNING id, room_type_code, unit_label
      ), arrival AS (
        INSERT INTO availability_days (unit_id, date, status, min_nights)
        SELECT id, ${CHECK_IN}::date, 'available', 4 FROM un WHERE room_type_code = 'arr'
        RETURNING unit_id
      )
      SELECT (SELECT id FROM un WHERE unit_label = 'A') AS double,
             (SELECT id FROM un WHERE unit_label = 'B') AS double_twin,
             (SELECT id FROM un WHERE unit_label = 'S') AS suite,
             (SELECT id FROM un WHERE unit_label = 'E') AS euro,
             (SELECT unit_id FROM arrival)              AS strict_arrival
    `);

    const row = made.rows[0];

    if (!row) throw new Error('Fixture produced no row.');

    return {
      double: row.double,
      doubleTwin: row.double_twin,
      suite: row.suite,
      euro: row.euro,
      strictArrival: row.strict_arrival,
    };
  }
});
