import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { searchQuerySchema } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import type { AccessTokenClaims } from '../auth/token.service.js';
import type { AuditService } from '../common/audit/audit.service.js';
import { PropertyDetailService } from '../catalog/property-detail.service.js';
import { CalendarService } from '../partner/calendar.service.js';
import { SearchService } from '../search/search.service.js';
import { SettingsService } from '../settings/settings.service.js';

/**
 * A room under a dispute is TAKEN, on every screen that answers «is it free?» (Bashar, 2026-10-03).
 *
 * The exclusion constraint has held `disputed` rooms since 2026-08-25: a guest disputing the room
 * they are standing in keeps it. The property page, its month calendar, search and the partner
 * calendar were written before that and did not count it, so a disputed room was shown as free,
 * offered, and refused at the last step with `booking.dates_just_taken`. Found by
 * `e2e/multi-unit-journey.spec.ts` failing on the date windows where a dispute test had left one.
 *
 * Each reader is asked twice, around the same hold, so none can pass by finding nothing: FREE
 * before every room of the property is disputed, TAKEN after.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

function isoDate(days: number): string {
  const at = new Date();
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/* Inside the property page's sixty-day calendar, so that reader is asked too. */
const STAY = { checkIn: isoDate(21), checkOut: isoDate(23) };

/* A point nothing else occupies, so a box around it names the test property and nothing else. */
const ALONE = { latitude: '34.10000', longitude: '39.90000' };
const BOX = '34.09,39.89,34.11,39.91';

describeIfDb('a disputed booking holds its room', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  const settings = new SettingsService(db);
  const search = new SearchService(db, settings);
  const details = new PropertyDetailService(db, settings);
  const calendar = new CalendarService(db, {
    record: () => Promise.resolve(),
  } as unknown as AuditService);

  beforeEach(async () => {
    await harness.begin();
  });
  afterEach(async () => {
    await harness.rollback();
  });
  afterAll(async () => {
    await harness.close();
  });

  const query = (extra: Record<string, unknown> = {}) =>
    searchQuerySchema.parse({ ...STAY, adults: 1, ...extra });

  it('on the property page, its calendar, search and the partner calendar', async () => {
    /* A property search offers for the stay: whatever the seed holds, this one is bookable. */
    const offered = await search.search(query());
    const slug = offered.items[0]?.slug;
    expect(slug, 'search offers a property for the stay').toBeDefined();

    const [property] = (
      await db.execute<{ id: string; partner_id: string }>(sql`
        UPDATE properties SET latitude = ${ALONE.latitude}, longitude = ${ALONE.longitude}
         WHERE slug = ${slug}
        RETURNING id::text AS id, partner_id::text AS partner_id
      `)
    ).rows;
    expect(property).toBeDefined();

    const claims: AccessTokenClaims = {
      sub: '00000000-0000-7000-8000-000000000001',
      role: 'partner',
      permissions: ['calendar.manage_own'],
      locale: 'ar',
      partnerId: property!.partner_id,
    };

    const read = async () => {
      const found = await search.search(query({ bbox: BOX }));
      const page = await details.bySlug(slug!, STAY);
      const units = page?.units ?? [];
      const firstNight = page?.calendar.find((day) => day.date === STAY.checkIn);
      const nights = await Promise.all(
        units.map(
          async (unit) =>
            (
              await calendar.read(claims, String(unit.id), {
                from: STAY.checkIn,
                to: STAY.checkIn,
              })
            ).days[0]?.status,
        ),
      );
      return {
        inSearch: found.items.some((item) => item.slug === slug),
        unitsFree: units.filter((unit) => unit.available).length,
        unitCount: units.length,
        firstNight: firstNight?.status,
        partnerNights: nights,
      };
    };

    const before = await read();
    expect(before.inSearch, 'FREE before: search finds it in its box').toBe(true);
    expect(before.unitsFree, 'FREE before: the page offers a room').toBeGreaterThan(0);
    expect(before.firstNight, 'FREE before: the calendar shows the night open').toBe(
      'available',
    );

    /*
      Every room the stay could use, held the way the console and seed scripts write a booking: a
      plain INSERT, then the dispute. Rooms another booking already holds are left to it.
    */
    const held = await db.execute<{ id: string }>(sql`
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
        AND NOT EXISTS (
          SELECT 1 FROM booking_units bu
           WHERE bu.unit_id = u.id
             AND bu.status IN ('pending_payment', 'pending_confirmation', 'confirmed', 'checked_in', 'disputed')
             AND daterange(bu.check_in, bu.check_out, '[)')
                 && daterange(${STAY.checkIn}::date, ${STAY.checkOut}::date, '[)')
        )
      RETURNING id::text AS id
    `);
    expect(held.rows.length, 'at least one room was free to hold').toBeGreaterThan(0);

    const ids = held.rows.map((row) => row.id);
    await db.execute(sql`
      UPDATE bookings SET status = 'disputed'
       WHERE id IN (${sql.join(
         ids.map((id) => sql`${id}::uuid`),
         sql`, `,
       )})
    `);

    /*
      The readers ask `booking_units`. If the dispute had not reached it, the rooms would still read
      `confirmed`, which every reader already counted, and the assertions below would pass for a
      reason unrelated to `disputed`.
    */
    const statuses = await db.execute<{ status: string }>(sql`
      SELECT DISTINCT status::text AS status FROM booking_units
       WHERE booking_id IN (${sql.join(
         ids.map((id) => sql`${id}::uuid`),
         sql`, `,
       )})
    `);
    expect(statuses.rows.map((row) => row.status)).toEqual(['disputed']);

    const after = await read();
    expect(after.inSearch, 'TAKEN after: search no longer offers it').toBe(false);
    expect(after.unitsFree, 'TAKEN after: the page offers no room').toBe(0);
    expect(after.firstNight, 'TAKEN after: the calendar shows the night booked').toBe(
      'booked',
    );
    expect(after.partnerNights.length).toBe(after.unitCount);
    expect(
      after.partnerNights.every((status) => status === 'booked'),
      `TAKEN after: the partner sees every room booked, saw ${after.partnerNights.join(', ')}`,
    ).toBe(true);
  });
});
