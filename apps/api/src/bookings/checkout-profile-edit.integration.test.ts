import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import { BookingAccessService } from './booking-access.service.js';
import { BookingCreationService } from './booking-creation.service.js';
import { CouponService } from '../coupons/coupon.service.js';
import { FxRateService } from '../fx/fx-rate.service.js';
import { PricingService } from './pricing.service.js';
import { SettingsService } from '../settings/settings.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/**
 * What the checkout form collects from a SIGNED-IN customer is used (Bashar, 2026-09-07).
 *
 * «I do not want checkout fields that collect information and then ignore it… If the customer is
 * allowed to update those details during checkout, then the booking, communications and related
 * workflows should use the updated values consistently.»
 *
 * It ignored them. `resolveCustomerProfile` returned `claims.customerProfileId` before reading one
 * field, so a guest correcting the number they travel on typed it into nothing.
 *
 * These drive the service and then read the row every downstream workflow reads — the confirmation,
 * the voucher, the arrivals list and support all join `customer_profiles` on the booking's
 * `customer_profile_id`, so proving the edit landed THERE is proving it reached all of them.
 */
describeIfDb('a signed-in customer edits their details at checkout', () => {
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
      { record: () => Promise.resolve(undefined) } as never,
      new BookingAccessService(db),
      new CouponService(db),
    );
  });

  /** Its own nights per test, so one booking never starves the next of a free room. */
  const stay = (week: number) => {
    const from = new Date(Date.UTC(2027, 8, 6 + week * 7));
    const to = new Date(from);

    to.setUTCDate(to.getUTCDate() + 2);

    return {
      checkIn: from.toISOString().slice(0, 10),
      checkOut: to.toISOString().slice(0, 10),
    };
  };

  /** A bookable unit for those nights, read from the data rather than named. */
  async function freeUnit(STAY: { checkIn: string; checkOut: string }) {
    const rows = await db.execute<{ unit_id: string }>(sql`
      SELECT u.id::text AS unit_id
        FROM units u
        JOIN properties p ON p.id = u.property_id
       WHERE u.is_active AND u.deleted_at IS NULL
         AND p.status = 'published'
         AND NOT EXISTS (
           SELECT 1 FROM booking_units bu
            WHERE bu.unit_id = u.id
              AND bu.status IN ('pending_payment','pending_confirmation','confirmed','checked_in','disputed')
              AND daterange(bu.check_in, bu.check_out, '[)')
                  && daterange(${STAY.checkIn}::date, ${STAY.checkOut}::date, '[)')
         )
       ORDER BY u.id
       LIMIT 1
    `);

    return rows.rows[0]!.unit_id;
  }

  /**
   * An account of this session's own — a `users` row and the profile hanging off it.
   *
   * Its own rather than a testbed customer's, because these tests CHANGE the name and phone on the
   * row they read back, and a test that edits somebody else's fixture is a test the next one
   * inherits. The timeline event also carries `claims.sub` as its actor, so the user row has to be
   * real: a made-up id fails the foreign key rather than the assertion.
   */
  async function account(suffix: string) {
    const created = await db.execute<{ user_id: string; id: string }>(sql`
      WITH u AS (
        INSERT INTO users (email, phone, role, status, preferred_locale)
        VALUES (${`edit-${suffix}@example.test`}, ${'+963900000900'}, 'customer', 'active', 'ar')
        RETURNING id
      )
      INSERT INTO customer_profiles (user_id, full_name, email, phone, is_guest)
      SELECT u.id, ${'الاسم القديم'}, ${`edit-${suffix}@example.test`}, ${'+963900000900'}, false
      FROM u
      RETURNING user_id::text AS user_id, id::text AS id
    `);

    return created.rows[0]!;
  }

  const claimsFor = (who: { user_id: string; id: string }) =>
    ({
      sub: who.user_id,
      role: 'customer',
      permissions: [],
      locale: 'ar',
      customerProfileId: who.id,
    }) as unknown as AccessTokenClaims;

  const read = async (id: string) =>
    (
      await db.execute<{ full_name: string; email: string; phone: string }>(sql`
        SELECT full_name, email, phone FROM customer_profiles WHERE id = ${id}
      `)
    ).rows[0]!;

  it('a changed name and phone reach the profile the booking resolves', async () => {
    const STAY = stay(0);
    const who = await account('changed');

    const created = await service.createDraft(
      {
        unitId: await freeUnit(STAY),
        ...STAY,
        adults: 2,
        guest: {
          fullName: 'الاسم الجديد',
          email: 'edit-changed@example.test',
          phone: '+963911111222',
        },
      },
      claimsFor(who),
      {},
    );

    const after = await read(who.id);

    expect(after.full_name, 'the typed name was discarded').toBe('الاسم الجديد');
    expect(after.phone, 'the typed number was discarded').toBe('+963911111222');

    /* And the booking hangs off that same row — otherwise the edit landed somewhere nobody reads. */
    const owner = await db.execute<{ id: string }>(sql`
      SELECT customer_profile_id::text AS id FROM bookings WHERE reference = ${created.reference}
    `);

    expect(owner.rows[0]!.id).toBe(who.id);
  });

  it('a submitted email never moves the sign-in address', async () => {
    /*
      The form shows the email and does not offer to change it — but a disabled control is a
      COURTESY and the endpoint is the control, so this posts a different address the way somebody
      editing the DOM would. Changing it here would move an account behind a booking button with
      nothing verifying the new address belongs to them.
    */
    const STAY = stay(1);
    const who = await account('identity');

    await service.createDraft(
      {
        unitId: await freeUnit(STAY),
        ...STAY,
        adults: 2,
        guest: {
          fullName: 'اسم آخر',
          email: 'attacker@example.test',
          phone: '+963911111333',
        },
      },
      claimsFor(who),
      {},
    );

    expect((await read(who.id)).email).toBe('edit-identity@example.test');
  });

  it('an empty field does not erase what is already on record', async () => {
    const STAY = stay(2);
    const who = await account('blank');

    await service.createDraft(
      {
        unitId: await freeUnit(STAY),
        ...STAY,
        adults: 2,
        guest: { fullName: '', email: 'edit-blank@example.test', phone: '' },
      },
      claimsFor(who),
      {},
    );

    const after = await read(who.id);

    expect(after.full_name).toBe('الاسم القديم');
    expect(after.phone).toBe('+963900000900');
  });
});
