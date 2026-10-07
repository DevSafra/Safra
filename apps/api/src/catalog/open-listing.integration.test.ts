import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ERROR } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import type { AccessTokenClaims } from '../auth/token.service.js';
import { BookingCreationService } from '../bookings/booking-creation.service.js';
import { PricingService } from '../bookings/pricing.service.js';
import { codeOf } from '../common/errors/app-error.js';
import { CouponService } from '../coupons/coupon.service.js';
import { FavouritesService } from '../favourites/favourites.service.js';
import { FxRateService } from '../fx/fx-rate.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { PropertyDetailService } from './property-detail.service.js';

const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/**
 * A CLOSED listing is closed at every door, not only in the search results (audit 2026-10-06).
 *
 * ## What this caught
 *
 * Closing a city, closing a country or suspending a partner took the listings out of search, and
 * nothing else. The property page still rendered, the quote still priced, the coupon preview still
 * answered, the booking was still created, and a listing the customer had saved stayed «available»
 * in المفضلة with a link straight to the checkout. Each door is driven here for each of the three
 * closures, because they were five doors with one mistake rather than one door.
 *
 * ## The control
 *
 * Every refusal is measured against the same listing OPEN, so a fixture that cannot be priced or
 * booked at all would fail the control rather than pass as a refusal. `createDraft` uses an arrival
 * in the past: the open listing then meets `booking.arrival_in_past`, the check after the one under
 * test, which makes «reached the next check» positive evidence rather than the absence of an error.
 *
 * The listing has a country, a city and a partner of its own, so closing them touches nothing
 * another suite is reading.
 */
describeIfDb('a closed listing at every door that leads to a booking', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  let db: Database;
  let creation: BookingCreationService;
  let details: PropertyDetailService;
  let favourites: FavouritesService;
  let listing: Listing;

  beforeEach(async () => {
    await harness.begin();
    db = harness.db;

    const settings = new SettingsService(db);

    creation = new BookingCreationService(
      db,
      new PricingService(db, settings, new FxRateService(db, {} as never)),
      settings,
      {} as never,
      {} as never,
      new CouponService(db),
    );
    details = new PropertyDetailService(db, settings);
    favourites = new FavouritesService(db);
    listing = await openListingFixture(db);
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  const FUTURE = { checkIn: '2031-03-10', checkOut: '2031-03-12' };

  const customer = (): AccessTokenClaims => ({
    sub: listing.userId,
    role: 'customer',
    permissions: [],
    locale: 'ar',
    customerProfileId: listing.profileId,
  });

  const CLOSURES = {
    'its city is closed': (db: Database, l: Listing) =>
      db.execute(sql`UPDATE cities SET is_active = false WHERE id = ${l.cityId}::uuid`),
    'its country is closed': (db: Database, l: Listing) =>
      db.execute(
        sql`UPDATE countries SET is_active = false WHERE id = ${l.countryId}::uuid`,
      ),
    'its partner is suspended': (db: Database, l: Listing) =>
      db.execute(
        sql`UPDATE partners SET suspended_at = now() WHERE id = ${l.partnerId}::uuid`,
      ),
  } as const;

  const closures = Object.keys(CLOSURES) as (keyof typeof CLOSURES)[];

  /** Every door, answering with the code it gives (or `open` when it went ahead). */
  async function doors() {
    const outcome = (promise: Promise<unknown>) =>
      promise.then(
        () => 'open' as const,
        (error: unknown) => codeOf(error) ?? String(error),
      );

    return {
      page: await outcome(details.bySlug(listing.slug, FUTURE)),
      quote: await outcome(creation.quote({ unitId: listing.unitId, ...FUTURE })),
      coupon: await outcome(
        creation.previewCoupon({
          code: 'NO-SUCH-CODE',
          unitId: listing.unitId,
          ...FUTURE,
        }),
      ),
      booking: await outcome(
        creation.createDraft(
          {
            unitId: listing.unitId,
            checkIn: '2020-01-01',
            checkOut: '2020-01-03',
            adults: 2,
            guest: {
              fullName: 'Closed Market',
              email: `closed-${Math.random().toString(36).slice(2, 10)}@safra.test`,
              phone: '+963900000177',
            },
          },
          undefined,
          { ipAddress: '127.0.0.1', userAgent: 'test' },
        ),
      ),
      save: await outcome(favourites.save(customer(), listing.slug)),
    };
  }

  it('lets every door through while the listing is open', async () => {
    expect(await doors()).toStrictEqual({
      page: 'open',
      quote: 'open',
      /* Priced, then refused for the CODE, which only happens once the stay was found. */
      coupon: ERROR.COUPON_INVALID,
      booking: ERROR.BOOKING_ARRIVAL_IN_PAST,
      save: 'open',
    });
  });

  it.each(closures)('refuses at every door when %s, as not found', async (closure) => {
    await CLOSURES[closure](db, listing);

    /* Each door's own «not found», the one it gives a unit id that names nothing at all. */
    expect(await doors()).toStrictEqual({
      page: ERROR.PROPERTY_NOT_FOUND,
      quote: ERROR.UNIT_NOT_FOUND_OR_RANGE_EMPTY,
      coupon: ERROR.UNIT_NOT_FOUND_OR_RANGE_EMPTY,
      booking: ERROR.UNIT_NOT_FOUND,
      save: ERROR.PROPERTY_NOT_FOUND,
    });
  });

  /**
   * A basket cannot carry a closed listing in on another line either.
   *
   * The lead line is checked by the booking's own lookup; every line is checked by pricing. A
   * basket whose lead is fine and whose second line is not must still refuse.
   */
  it('refuses a basket whose OTHER line is a room that was withdrawn', async () => {
    const second = await db.execute<{ id: string }>(sql`
      INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price,
                         currency_id, is_active)
      SELECT u.property_id, 'جناح', 'Suite', 'Suite', 2, '150.00', u.currency_id, false
      FROM units u WHERE u.id = ${listing.unitId}::uuid
      RETURNING id::text AS id
    `);

    await expect(
      creation
        .quote({
          unitId: listing.unitId,
          ...FUTURE,
          lines: [
            { unitId: listing.unitId, rooms: 1 },
            { unitId: second.rows[0]!.id, rooms: 1 },
          ],
        })
        .catch((error: unknown) => codeOf(error)),
    ).resolves.toBe(ERROR.UNIT_NOT_FOUND);
  });

  it.each(closures)(
    'shows a saved listing as unavailable in المفضلة when %s',
    async (closure) => {
      await favourites.save(customer(), listing.slug);

      const before = await favourites.list(customer(), { limit: 20 });

      /* The opposite control: the same row reads as available while nothing is closed. */
      expect(before.items.map((item) => item.isAvailable)).toStrictEqual([true]);

      await CLOSURES[closure](db, listing);

      const after = await favourites.list(customer(), { limit: 20 });

      expect(after.items.map((item) => [item.slug, item.isAvailable])).toStrictEqual([
        [listing.slug, false],
      ]);
    },
  );
});

interface Listing {
  countryId: string;
  cityId: string;
  partnerId: string;
  unitId: string;
  slug: string;
  userId: string;
  profileId: string;
}

/** A published listing with a country, city and partner of its own, plus a customer to save it. */
async function openListingFixture(db: Database): Promise<Listing> {
  const tag = `open-${Math.random().toString(36).slice(2, 10)}`;

  /* A code no real country uses, so closing it reaches nothing outside this transaction. */
  const code = await db.execute<{ code: string }>(sql`
    SELECT c AS code
    FROM (SELECT chr(81) || chr(65 + g) AS c FROM generate_series(0, 25) g) s
    WHERE c NOT IN (SELECT code FROM countries)
    ORDER BY random()
    LIMIT 1
  `);

  const made = await db.execute<Omit<Listing, 'slug'>>(sql`
    WITH ref AS (
      SELECT (SELECT id FROM currencies WHERE code = 'USD')     AS currency_id,
             (SELECT id FROM property_types LIMIT 1)            AS type_id,
             (SELECT id FROM partner_types LIMIT 1)             AS partner_type_id,
             (SELECT id FROM cancellation_policies LIMIT 1)     AS policy_id
    ), co AS (
      INSERT INTO countries (code, name_ar, name_en, name_de, display_currency_id, is_active)
      SELECT ${code.rows[0]!.code}, 'بلد', 'Country', 'Land', ref.currency_id, true FROM ref
      RETURNING id
    ), ci AS (
      INSERT INTO cities (country_id, slug, name_ar, name_en, name_de, timezone)
      SELECT co.id, ${tag}, 'مدينة', 'City', 'Stadt', 'Asia/Damascus' FROM co
      RETURNING id
    ), pu AS (
      INSERT INTO users (email, phone, role, status)
      VALUES (${tag} || '-p@safra.test', '+963900000178', 'partner', 'active')
      RETURNING id
    ), pa AS (
      INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                            address, phone, email, verification)
      SELECT pu.id, ref.partner_type_id, 'Open Listing', 'مفتوح', ci.id, 'x',
             '+963900000178', ${tag} || '-pa@safra.test', 'approved'
      FROM pu, ci, ref RETURNING id
    ), pr AS (
      INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                              slug, name_ar, name_en, name_de, address, status)
      SELECT pa.id, ci.id, ref.type_id, ref.policy_id, ${tag}, ${tag}, 'Open', 'Offen',
             'x', 'published'
      FROM pa, ci, ref RETURNING id
    ), un AS (
      INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price,
                         currency_id, is_active)
      SELECT pr.id, 'وحدة', 'Unit', 'Einheit', 4, '100.00', ref.currency_id, true
      FROM pr, ref
      RETURNING id
    ), cu AS (
      INSERT INTO users (email, role) VALUES (${tag} || '-c@safra.test', 'customer')
      RETURNING id
    ), cp AS (
      INSERT INTO customer_profiles (user_id, full_name, email, phone, is_guest)
      SELECT cu.id, 'زبون', ${tag} || '-c@safra.test', '+963900000179', false FROM cu
      RETURNING id
    )
    SELECT co.id::text AS "countryId", ci.id::text AS "cityId", pa.id::text AS "partnerId",
           un.id::text AS "unitId", cu.id::text AS "userId", cp.id::text AS "profileId"
    FROM co, ci, pa, un, cu, cp
  `);

  const row = made.rows[0];

  if (!row) throw new Error('Could not create the listing this suite closes.');

  return { ...row, slug: tag };
}
