import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';
import { ERROR } from '@safra/contracts';

import { BookingCreationService } from './booking-creation.service.js';
import { CouponService } from '../coupons/coupon.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { codeOf } from '../common/errors/app-error.js';

/**
 * Emergency Mode's «إيقاف الحجوزات» at the one place a booking is created (EC-009).
 *
 * REGRESSION (2026-10-06): the console stored `stopBookings` and showed it armed, and
 * `createDraft` never read it, so customers went on paying for stays in a city the platform had
 * declared closed.
 *
 * ## How a refusal is told apart from a booking going ahead
 *
 * The service is built with the same three stubs `booking-arrival` uses, and every request asks for
 * an arrival in the PAST. The past-arrival refusal is the check right after this one, so without an
 * emergency the answer is `booking.arrival_in_past`, and with one it is
 * `booking.emergency_stopped`. That makes the control (a lifted declaration, another city, a
 * declaration with only other levers pulled) say something positive rather than merely «not
 * refused by us».
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('booking under Emergency Mode', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  let db: Database;
  let service: BookingCreationService;
  let unitId = '';

  beforeEach(async () => {
    await harness.begin();
    db = harness.db;

    service = new BookingCreationService(
      db,
      {} as never,
      new SettingsService(db),
      {} as never,
      {} as never,
      new CouponService(db),
    );

    unitId = await publishedUnit(db);
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  const attempt = () =>
    service
      .createDraft(
        {
          unitId,
          checkIn: '2020-01-01',
          checkOut: '2020-01-03',
          adults: 2,
          guest: {
            fullName: 'Emergency Test',
            email: `emergency-${Math.random().toString(36).slice(2, 10)}@safra.test`,
            phone: '+963900000123',
          },
        },
        undefined,
        { ipAddress: '127.0.0.1', userAgent: 'test' },
      )
      .catch((error: unknown) => error);

  async function declare(
    scope: 'city' | 'country' | 'elsewhere',
    flags: { stopBookings: boolean; waiveFines?: boolean; suspendSla?: boolean },
    options: { lifted?: boolean } = {},
  ) {
    await db.execute(sql`
      WITH actor AS (
        INSERT INTO users (email, role, status)
        VALUES ('em-stop-' || gen_random_uuid() || '@safra.test', 'super_admin', 'active')
        RETURNING id
      ), target AS (
        SELECT CASE ${scope}
                 WHEN 'city' THEN ci.id
                 WHEN 'country' THEN ci.country_id
                 ELSE (SELECT o.id FROM cities o WHERE o.id <> ci.id LIMIT 1)
               END AS id
        FROM units u
        JOIN properties p ON p.id = u.property_id
        JOIN cities ci    ON ci.id = p.city_id
        WHERE u.id = ${unitId}
      )
      INSERT INTO emergency_modes
        (scope, scope_id, flags, activated_by_user_id, reason, deactivated_at)
      SELECT ${scope === 'country' ? 'country' : 'city'}, target.id,
             ${JSON.stringify({
               broadcast: false,
               waiveFines: false,
               suspendSla: false,
               ...flags,
             })}::jsonb,
             actor.id, 'عاصفة تغلق المدينة', ${options.lifted ? sql`now()` : sql`NULL`}
      FROM actor, target
    `);
  }

  /** The control every refusal below is measured against. */
  it('reaches the next check when nothing is declared', async () => {
    expect(codeOf(await attempt())).toBe(ERROR.BOOKING_ARRIVAL_IN_PAST);
  });

  it.each(['city', 'country'] as const)(
    'refuses a booking in the declared %s, with a code',
    async (scope) => {
      await declare(scope, { stopBookings: true });

      expect(codeOf(await attempt())).toBe(ERROR.BOOKING_EMERGENCY_STOPPED);
    },
  );

  it.each([
    ['a lifted declaration', 'city', { stopBookings: true }, true],
    ['a declaration on another city', 'elsewhere', { stopBookings: true }, false],
    [
      'a declaration that pulls only the other levers',
      'city',
      { stopBookings: false, waiveFines: true, suspendSla: true },
      false,
    ],
  ] as const)('lets %s through', async (_, scope, flags, lifted) => {
    await declare(scope, flags, { lifted });

    expect(codeOf(await attempt())).toBe(ERROR.BOOKING_ARRIVAL_IN_PAST);
  });
});

/** A published unit in a city of its own, so a declaration here touches nothing else. */
async function publishedUnit(db: Database): Promise<string> {
  const tag = `emg-${Math.random().toString(36).slice(2, 10)}`;

  const made = await db.execute<{ id: string }>(sql`
    WITH ref AS (
      SELECT (SELECT id FROM countries WHERE deleted_at IS NULL LIMIT 1)  AS country_id,
             (SELECT id FROM currencies WHERE code = 'USD')               AS currency_id,
             (SELECT id FROM property_types LIMIT 1)                      AS type_id,
             (SELECT id FROM partner_types LIMIT 1)                       AS partner_type_id,
             (SELECT id FROM cancellation_policies LIMIT 1)               AS policy_id
    ), ci AS (
      INSERT INTO cities (country_id, slug, name_ar, name_en, name_de, timezone)
      SELECT ref.country_id, ${tag}, 'مدينة', 'City', 'Stadt', 'Asia/Damascus' FROM ref
      RETURNING id
    ), pu AS (
      INSERT INTO users (email, phone, role, status)
      VALUES (${tag} || '-p@safra.test', '+963900000189', 'partner', 'active')
      RETURNING id
    ), pa AS (
      INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                            address, phone, email, verification)
      SELECT pu.id, ref.partner_type_id, 'Emergency Test', 'طوارئ', ci.id, 'x',
             '+963900000189', ${tag} || '-pa@safra.test', 'approved'
      FROM pu, ci, ref RETURNING id
    ), pr AS (
      INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                              slug, name_ar, name_en, name_de, address, status)
      SELECT pa.id, ci.id, ref.type_id, ref.policy_id, ${tag}, ${tag}, 'Emergency', 'Emergency',
             'x', 'published'
      FROM pa, ci, ref RETURNING id
    )
    INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price,
                       currency_id, is_active)
    SELECT pr.id, 'وحدة', 'Unit', 'Einheit', 4, '100.00', ref.currency_id, true
    FROM pr, ref
    RETURNING id
  `);

  const id = made.rows[0]?.id;

  if (!id) throw new Error('Could not create the unit this suite books against.');

  return id;
}
