import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ERROR, PUBLIC_GROUP_TRIPS_LIMIT } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { GroupTripsService } from './group-trips.service.js';
import { PublicGroupTripsService } from '../catalog/group-trips.service.js';
import { codeOf } from '../common/errors/app-error.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * جروبات — what a trip refuses, and what a visitor is allowed to see.
 *
 * ## The two halves are tested together on purpose
 *
 * A group trip's whole authorization story is «staff write it, the public reads only what is
 * published». Testing the console service alone would prove the writes work and say nothing about
 * the thing that matters, which is that a DRAFT is invisible. Both services are constructed here so
 * one case can write with the first and read with the second.
 *
 * Each case below was watched to fail against the defect it describes; the mutations are named.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('group trips', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  const console_ = new GroupTripsService(db, new AuditService(db));
  const publicTrips = new PublicGroupTripsService(db);

  let citySlug = '';
  let currencyCode = '';
  let actorId = '';

  /*
    A REAL staff row, because `audit_log.actor_user_id` is a foreign key. A made-up UUID makes
    every write fail on the audit insert rather than on the rule under test — which is a fixture
    that cannot reach what it is protecting.
  */
  const admin = (): AccessTokenClaims => ({
    sub: actorId,
    role: 'super_admin',
    permissions: [],
    locale: 'ar',
    totpEnabled: true,
  });

  beforeEach(async () => {
    await harness.begin();

    const refs = await db.execute<{ city: string; currency: string }>(sql`
      SELECT (SELECT slug FROM cities WHERE deleted_at IS NULL LIMIT 1) AS city,
             (SELECT code FROM currencies WHERE deleted_at IS NULL LIMIT 1) AS currency
    `);

    citySlug = refs.rows[0]?.city ?? '';
    currencyCode = refs.rows[0]?.currency ?? '';

    const staff = await db.execute<{ id: string }>(sql`
      INSERT INTO users (email, phone, role, status, preferred_locale)
      VALUES ('trip-test-' || gen_random_uuid() || '@safra.test', '+963900000000',
              'super_admin', 'active', 'ar')
      RETURNING id
    `);

    actorId = staff.rows[0]?.id ?? '';

    /* A fixture that cannot reach the rule reports coverage it does not have. */
    if (!citySlug || !currencyCode || !actorId)
      throw new Error('the trip fixture found no city, currency or actor');

    /*
      Trips are PLATFORM-wide, so whatever the development database already holds would count
      toward the public list. Cleared inside the transaction, which the rollback undoes.
    */
    await db.execute(sql`DELETE FROM group_trips`);
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  const draft = (slug: string, over: Record<string, unknown> = {}) => ({
    slug,
    citySlug,
    titleAr: 'رحلة تجريبية',
    titleEn: null,
    titleDe: null,
    summaryAr: 'سطر تعريفي.',
    summaryEn: null,
    summaryDe: null,
    descriptionAr: 'وصف كافٍ للرحلة التجريبية.',
    descriptionEn: null,
    descriptionDe: null,
    startsOn: '2027-05-01',
    endsOn: '2027-05-07',
    priceFrom: null,
    currencyCode: null,
    seats: null,
    ...over,
  });

  it('is invisible to the public until it is published', async () => {
    await console_.create(admin(), draft('invisible-trip'));

    await expect(publicTrips.bySlug('invisible-trip')).rejects.toSatisfy(
      (error: unknown) => codeOf(error) === ERROR.GROUP_TRIP_NOT_FOUND,
    );
    expect((await publicTrips.list()).items).toHaveLength(0);

    await console_.update(admin(), 'invisible-trip', { status: 'published' });

    expect((await publicTrips.bySlug('invisible-trip')).slug).toBe('invisible-trip');
    expect((await publicTrips.list()).items).toHaveLength(1);
  });

  /*
    The opposite control. Without it «a draft is hidden» would pass just as happily if the public
    read returned nothing at all — which is what a broken join or a wrong predicate produces.
  */
  it('an archived trip leaves the public list again', async () => {
    await console_.create(admin(), draft('archivable'));
    await console_.update(admin(), 'archivable', { status: 'published' });
    expect((await publicTrips.list()).items).toHaveLength(1);

    await console_.update(admin(), 'archivable', { status: 'archived' });

    expect((await publicTrips.list()).items).toHaveLength(0);
  });

  it('refuses a slug that is already taken', async () => {
    await console_.create(admin(), draft('taken-slug'));

    await expect(console_.create(admin(), draft('taken-slug'))).rejects.toSatisfy(
      (error: unknown) => codeOf(error) === ERROR.GROUP_TRIP_SLUG_TAKEN,
    );
  });

  it('refuses a price without its currency', async () => {
    await expect(
      console_.create(admin(), draft('priced', { priceFrom: '450' })),
    ).rejects.toThrow();
  });

  /*
    The merge case, which the schema cannot see: moving `startsOn` past an UNTOUCHED `endsOn`
    carries only one date, so the contract's refine passes it and only the service can refuse.
    Mutation: delete the `endsOn < startsOn` check in `update` and this goes red as a 500.
  */
  it('refuses an update that moves the start past an untouched end', async () => {
    await console_.create(admin(), draft('date-merge'));

    await expect(
      console_.update(admin(), 'date-merge', { startsOn: '2027-06-01' }),
    ).rejects.toSatisfy(
      (error: unknown) => codeOf(error) === ERROR.GROUP_TRIP_DATES_ORDER,
    );
  });

  it('refuses to delete a trip that was ever published, and allows a draft', async () => {
    await console_.create(admin(), draft('published-once'));
    await console_.update(admin(), 'published-once', { status: 'published' });

    await expect(console_.remove(admin(), 'published-once')).rejects.toThrow();

    await console_.create(admin(), draft('still-a-draft'));

    expect((await console_.remove(admin(), 'still-a-draft')).slug).toBe('still-a-draft');
  });

  it('stamps published_at once and keeps it across an archive', async () => {
    await console_.create(admin(), draft('stamped'));
    await console_.update(admin(), 'stamped', { status: 'published' });

    const first = await db.execute<{ at: string }>(
      sql`SELECT published_at::text AS at FROM group_trips WHERE slug = 'stamped'`,
    );

    await console_.update(admin(), 'stamped', { status: 'archived' });
    await console_.update(admin(), 'stamped', { status: 'published' });

    const again = await db.execute<{ at: string }>(
      sql`SELECT published_at::text AS at FROM group_trips WHERE slug = 'stamped'`,
    );

    expect(again.rows[0]?.at).toBe(first.rows[0]?.at);
  });

  it(`shows at most ${PUBLIC_GROUP_TRIPS_LIMIT} trips publicly`, async () => {
    await db.execute(sql`
      INSERT INTO group_trips (slug, city_id, title_ar, summary_ar, description_ar,
                               starts_on, ends_on, status)
      SELECT 'bulk-' || i, c.id, 'رحلة ' || i, 'سطر.', 'وصف كافٍ.',
             '2027-05-01', '2027-05-07', 'published'
        FROM generate_series(1, ${PUBLIC_GROUP_TRIPS_LIMIT + 8}) AS i,
             cities c
       WHERE c.slug = ${citySlug}
    `);

    expect((await publicTrips.list()).items).toHaveLength(PUBLIC_GROUP_TRIPS_LIMIT);
  });

  /* The control for the cap: a small set comes back whole, so «at most N» is not «almost none». */
  it('shows every trip when there are few', async () => {
    await console_.create(admin(), draft('a-few-1'));
    await console_.update(admin(), 'a-few-1', { status: 'published' });
    await console_.create(admin(), draft('a-few-2'));
    await console_.update(admin(), 'a-few-2', { status: 'published' });

    expect((await publicTrips.list()).items).toHaveLength(2);
  });

  it('keeps a price and its currency together through an update', async () => {
    await console_.create(
      admin(),
      draft('priced-ok', { priceFrom: '450', currencyCode }),
    );

    /* Clearing only the price would leave a currency with nothing to qualify. */
    await expect(
      console_.update(admin(), 'priced-ok', { priceFrom: null }),
    ).rejects.toSatisfy(
      (error: unknown) => codeOf(error) === ERROR.GROUP_TRIP_PRICE_NEEDS_CURRENCY,
    );

    /* Clearing BOTH is «السعر عند الطلب», which is legitimate. */
    const cleared = await console_.update(admin(), 'priced-ok', {
      priceFrom: null,
      currencyCode: null,
    });

    expect(cleared.slug).toBe('priced-ok');
  });
});
