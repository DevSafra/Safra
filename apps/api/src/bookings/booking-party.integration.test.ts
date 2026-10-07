import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ERROR } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import { BookingCreationService } from './booking-creation.service.js';
import { CouponService } from '../coupons/coupon.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { codeOf } from '../common/errors/app-error.js';

const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/**
 * The server holds the party to what the rooms sleep, whatever the checkout sent (audit
 * 2026-10-06).
 *
 * The checkout page now clamps `?adults=`, but a tampered request never passes through the page, so
 * this is the control that matters. It had no test of its own.
 *
 * ## The control
 *
 * Each stay is 100 nights, past `search.max_nights`. A party that fits therefore meets
 * `booking.stay_too_long`, the check AFTER capacity, which makes «fits» positive evidence rather
 * than the absence of a refusal.
 */
describeIfDb('the party on a booking', () => {
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

    unitId = await unitSleeping(db, 4);
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  const attempt = (party: { adults: number; children?: number; infants?: number }) =>
    service
      .createDraft(
        {
          unitId,
          checkIn: '2031-01-01',
          checkOut: '2031-04-11',
          ...party,
          guest: {
            fullName: 'Party Test',
            email: `party-${Math.random().toString(36).slice(2, 10)}@safra.test`,
            phone: '+963900000166',
          },
        },
        undefined,
        { ipAddress: '127.0.0.1', userAgent: 'test' },
      )
      .catch((error: unknown) => codeOf(error) ?? String(error));

  it.each([
    ['exactly the beds', { adults: 4 }],
    ['adults and children together filling the beds', { adults: 2, children: 2 }],
    ['infants beyond the beds, who do not take one', { adults: 4, infants: 2 }],
  ])('lets %s through to the next check', async (_label, party) => {
    expect(await attempt(party)).toBe(ERROR.BOOKING_STAY_TOO_LONG);
  });

  it.each([
    ['more adults than beds', { adults: 5 }],
    ['adults and children together past the beds', { adults: 3, children: 2 }],
  ])('refuses %s', async (_label, party) => {
    expect(await attempt(party)).toBe(ERROR.UNIT_GUEST_LIMIT);
  });
});

/** A published unit that sleeps `beds`, in a city of its own. */
async function unitSleeping(db: Database, beds: number): Promise<string> {
  const tag = `party-${Math.random().toString(36).slice(2, 10)}`;

  const made = await db.execute<{ id: string }>(sql`
    WITH ref AS (
      SELECT (SELECT id FROM countries WHERE deleted_at IS NULL AND is_active LIMIT 1) AS country_id,
             (SELECT id FROM currencies WHERE code = 'USD')                          AS currency_id,
             (SELECT id FROM property_types LIMIT 1)                                 AS type_id,
             (SELECT id FROM partner_types LIMIT 1)                                  AS partner_type_id,
             (SELECT id FROM cancellation_policies LIMIT 1)                          AS policy_id
    ), ci AS (
      INSERT INTO cities (country_id, slug, name_ar, name_en, name_de, timezone)
      SELECT ref.country_id, ${tag}, 'مدينة', 'City', 'Stadt', 'Asia/Damascus' FROM ref
      RETURNING id
    ), pu AS (
      INSERT INTO users (email, phone, role, status)
      VALUES (${tag} || '-p@safra.test', '+963900000167', 'partner', 'active')
      RETURNING id
    ), pa AS (
      INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                            address, phone, email, verification)
      SELECT pu.id, ref.partner_type_id, 'Party Test', 'ضيوف', ci.id, 'x',
             '+963900000167', ${tag} || '-pa@safra.test', 'approved'
      FROM pu, ci, ref RETURNING id
    ), pr AS (
      INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                              slug, name_ar, name_en, name_de, address, status)
      SELECT pa.id, ci.id, ref.type_id, ref.policy_id, ${tag}, ${tag}, 'Party', 'Party',
             'x', 'published'
      FROM pa, ci, ref RETURNING id
    )
    INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price,
                       currency_id, is_active)
    SELECT pr.id, 'وحدة', 'Unit', 'Einheit', ${beds}, '100.00', ref.currency_id, true
    FROM pr, ref
    RETURNING id::text AS id
  `);

  const id = made.rows[0]?.id;

  if (!id) throw new Error('Could not create the unit this suite books against.');

  return id;
}
