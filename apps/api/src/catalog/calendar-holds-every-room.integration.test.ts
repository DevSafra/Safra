import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRollbackDatabase, type Database } from '@safra/db';

import { SettingsService } from '../settings/settings.service.js';
import { PropertyDetailService } from './property-detail.service.js';

/**
 * The property page's calendar counts every room a booking HOLDS, not only the one it names
 * (Bashar, 2026-10-04).
 *
 * A booking of three doubles is one row on `bookings`, naming one room, and three on
 * `booking_units`. The calendar read `bookings`, so on a night where every room was sold to such a
 * booking it showed the night open, while search and the room list, which read `booking_units`,
 * offered nothing. A guest picked the date and found no room on it.
 *
 * Asked twice around one booking that holds every room, so the calendar cannot pass by reading
 * nothing: OPEN before, BOOKED after.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

function isoDate(days: number): string {
  const at = new Date();
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/* Inside the calendar's sixty days. */
const STAY = { checkIn: isoDate(24), checkOut: isoDate(26) };

describeIfDb("the property page's calendar", () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  const settings = new SettingsService(db);
  const details = new PropertyDetailService(db, settings);

  beforeEach(async () => {
    await harness.begin();
  });
  afterEach(async () => {
    await harness.rollback();
  });
  afterAll(async () => {
    await harness.close();
  });

  const night = async (slug: string) =>
    (await details.bySlug(slug, STAY))?.calendar.find((day) => day.date === STAY.checkIn)
      ?.status;

  it('shows a night booked when one booking holds every room', async () => {
    /*
      A property with more than one room that is entirely free for the stay, so a single booking
      can hold all of it and the lead room alone cannot explain the answer.
    */
    const candidates = await db.execute<{ slug: string; rooms: number }>(sql`
      SELECT p.slug, COUNT(u.id)::int AS rooms
        FROM properties p JOIN units u ON u.property_id = p.id
       WHERE p.status = 'published' AND p.deleted_at IS NULL
         AND u.is_active AND u.deleted_at IS NULL
       GROUP BY p.id, p.slug
      HAVING COUNT(u.id) > 1
         AND NOT EXISTS (
           SELECT 1 FROM units x JOIN booking_units bu ON bu.unit_id = x.id
            WHERE x.property_id = p.id
              AND daterange(bu.check_in, bu.check_out, '[)')
                  && daterange(${STAY.checkIn}::date, ${STAY.checkOut}::date, '[)')
         )
         AND NOT EXISTS (
           SELECT 1 FROM units x JOIN availability_days ad ON ad.unit_id = x.id
            WHERE x.property_id = p.id AND ad.date = ${STAY.checkIn}::date
              AND ad.status <> 'available'
         )
       ORDER BY p.slug
       LIMIT 1
    `);
    const target = candidates.rows[0];
    expect(target, 'a free property with several rooms to hold').toBeDefined();
    const slug = target!.slug;

    expect(await night(slug), 'OPEN before the booking').toBe('available');

    /* One booking naming the first room, written the way every path writes one. */
    const [booking] = (
      await db.execute<{ id: string; lead: string }>(sql`
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
          ${STAY.checkIn}::date, ${STAY.checkOut}::date, 1, 'confirmed',
          100, 'flat', 0, 0, 0, 0, 100, 0, 100, u.currency_id, 1, 100,
          '{}'::jsonb, '{}'
        FROM units u JOIN properties p ON p.id = u.property_id
        WHERE p.slug = ${slug} AND u.is_active AND u.deleted_at IS NULL
        ORDER BY u.id
        LIMIT 1
        RETURNING id::text AS id, unit_id::text AS lead
      `)
    ).rows;

    /* ...and HOLDING every other room, as a booking of several rooms does. */
    const extra = await db.execute(sql`
      INSERT INTO booking_units (booking_id, unit_id, check_in, check_out, status, accommodation_amount)
      SELECT ${booking!.id}::uuid, u.id, ${STAY.checkIn}::date, ${STAY.checkOut}::date, 'confirmed', 0
        FROM units u JOIN properties p ON p.id = u.property_id
       WHERE p.slug = ${slug} AND u.is_active AND u.deleted_at IS NULL
         AND u.id <> ${booking!.lead}::uuid
    `);
    expect(extra.rowCount, 'the booking holds the other rooms too').toBe(
      target!.rooms - 1,
    );

    expect(await night(slug), 'BOOKED after: every room is held').toBe('booked');
  });
});
