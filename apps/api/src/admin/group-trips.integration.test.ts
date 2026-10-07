import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ERROR, PUBLIC_GROUP_TRIPS_LIMIT } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { ImageService } from '../storage/image.service.js';
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

  /*
    What reached storage, so «the object is written before the row points at it» can be asserted
    rather than assumed. The same fake `ad-creative.integration.test.ts` uses, for the same reason:
    the real `StorageService` talks to S3, and a test that needs a bucket is a test nobody runs.
  */
  const stored: { key: string; bytes: number }[] = [];
  const storage = {
    put: (key: string, body: Buffer) => {
      stored.push({ key, bytes: body.length });

      return Promise.resolve();
    },
    publicUrl: (key: string) => `https://media.test/${key}`,
  };

  const console_ = new GroupTripsService(
    db,
    new AuditService(db),
    new ImageService(storage as never),
  );
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

  /**
   * A real encode, not a stub.
   *
   * `ImageService.process` DECODES before it re-encodes — that is the whole point of the inspect
   * step — so a `Buffer.from('not an image')` would exercise the rejection path and prove nothing
   * about the success one. 1600x900 so the renderer produces all three widths and the test can
   * assert the set rather than a single number.
   */
  const photograph = (): Promise<Buffer> =>
    sharp({
      create: {
        width: 1600,
        height: 900,
        channels: 3,
        background: { r: 20, g: 30, b: 60 },
      },
    })
      .png()
      .toBuffer();

  /**
   * Announces a trip the way the product requires since 2026-09-29: with a photograph.
   *
   * A helper rather than two lines repeated in every case, because the two lines are ONE fact —
   * «publishing a trip means it has a cover» — and a case that spelt them out separately would
   * read as though the photograph were incidental to what it was testing. The cases that are
   * ABOUT the rule call `update` directly, so this cannot hide the thing they assert.
   */
  const publish = async (slug: string): Promise<void> => {
    await console_.setCover(admin(), slug, await photograph());
    await console_.update(admin(), slug, { status: 'published' });
  };

  it('is invisible to the public until it is published', async () => {
    await console_.create(admin(), draft('invisible-trip'));

    await expect(publicTrips.bySlug('invisible-trip')).rejects.toSatisfy(
      (error: unknown) => codeOf(error) === ERROR.GROUP_TRIP_NOT_FOUND,
    );
    expect((await publicTrips.list()).items).toHaveLength(0);

    await publish('invisible-trip');

    expect((await publicTrips.bySlug('invisible-trip')).slug).toBe('invisible-trip');
    expect((await publicTrips.list()).items).toHaveLength(1);
  });

  /*
    The opposite control. Without it «a draft is hidden» would pass just as happily if the public
    read returned nothing at all — which is what a broken join or a wrong predicate produces.
  */
  it('an archived trip leaves the public list again', async () => {
    await console_.create(admin(), draft('archivable'));
    await publish('archivable');
    expect((await publicTrips.list()).items).toHaveLength(1);

    await console_.update(admin(), 'archivable', { status: 'archived' });

    expect((await publicTrips.list()).items).toHaveLength(0);
  });

  /*
    A trip whose city is gone is not offered, by the list or by its own page. Deleting the city is
    refused while a live trip goes there, so this is the row that reached that state some other way
    (or before the refusal existed). Watched to fail against the read that joined any city.
  */
  it('leaves the public list when its city has been removed', async () => {
    await console_.create(admin(), draft('orphaned'));
    await publish('orphaned');
    expect((await publicTrips.list()).items).toHaveLength(1);

    await db.execute(sql`
      UPDATE cities SET deleted_at = now()
      WHERE id = (SELECT city_id FROM group_trips WHERE slug = 'orphaned')
    `);

    expect((await publicTrips.list()).items).toHaveLength(0);
    await expect(publicTrips.bySlug('orphaned')).rejects.toSatisfy(
      (error: unknown) => codeOf(error) === ERROR.GROUP_TRIP_NOT_FOUND,
    );
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
    await publish('published-once');

    await expect(console_.remove(admin(), 'published-once')).rejects.toThrow();

    await console_.create(admin(), draft('still-a-draft'));

    expect((await console_.remove(admin(), 'still-a-draft')).slug).toBe('still-a-draft');
  });

  it('stamps published_at once and keeps it across an archive', async () => {
    await console_.create(admin(), draft('stamped'));
    await publish('stamped');

    const first = await db.execute<{ at: string }>(
      sql`SELECT published_at::text AS at FROM group_trips WHERE slug = 'stamped'`,
    );

    await console_.update(admin(), 'stamped', { status: 'archived' });
    await publish('stamped');

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

  /*
    Upcoming trips soonest first, then PAST trips newest first (audit 2026-10-04).

    Past trips are kept as evidence that SAFRA runs them, so the recent ones matter most, and the
    cap above is applied to this order: sorted oldest first, sixty trips from years ago crowded out
    last month's.
  */
  it('lists upcoming trips soonest first and past trips newest first', async () => {
    await db.execute(sql`
      INSERT INTO group_trips (slug, city_id, title_ar, summary_ar, description_ar,
                               starts_on, ends_on, status)
      SELECT v.slug, c.id, 'رحلة', 'سطر.', 'وصف كافٍ.', v.starts::date, v.ends::date, 'published'
        FROM (VALUES ('past-old', '2020-01-01', '2020-01-05'),
                     ('past-recent', '2026-01-01', '2026-01-05'),
                     ('coming', '2030-01-01', '2030-01-05')) AS v(slug, starts, ends),
             cities c
       WHERE c.slug = ${citySlug}
    `);

    const order = (await publicTrips.list()).items.map((trip) => trip.slug);

    expect(order).toEqual(['coming', 'past-recent', 'past-old']);
  });

  /* The control for the cap: a small set comes back whole, so «at most N» is not «almost none». */
  it('shows every trip when there are few', async () => {
    await console_.create(admin(), draft('a-few-1'));
    await publish('a-few-1');
    await console_.create(admin(), draft('a-few-2'));
    await publish('a-few-2');

    expect((await publicTrips.list()).items).toHaveLength(2);
  });

  /* ── The cover photograph (Bashar, 2026-09-29) ──────────────────────────── */

  it('records the cover with the widths that were actually rendered', async () => {
    await console_.create(admin(), draft('with-cover'));

    const before = stored.length;
    const row = await console_.setCover(admin(), 'with-cover', await photograph());

    expect(row.cover, 'the trip should come back carrying its cover').not.toBeNull();
    expect(row.cover?.width).toBe(1600);
    expect(row.cover?.height).toBe(900);

    /*
      The widths are asserted as a SET against what the encoder produced, never a hard-coded list:
      `mediaUrl` picks the nearest of these, so a row claiming a width nobody rendered is a 404 in
      an `<img>` — the exact failure `variant_widths` exists to prevent.
    */
    expect([...(row.cover?.variantWidths ?? [])].sort((a, b) => a - b)).toEqual([
      400, 800, 1600,
    ]);

    /*
      The objects reach storage before the row points at them. Two formats per width.

      Sliced from `before` rather than read whole: `stored` is shared across the file and other
      cases upload photographs of their own, so `stored.every(...)` asserts something about THEIR
      keys too — which is how this read green until a helper started publishing with a cover.
    */
    const written = stored.slice(before);

    expect(written).toHaveLength(6);
    expect(written.every((one) => one.key.startsWith('group-trips/with-cover/'))).toBe(
      true,
    );
  });

  it('shows the cover to the public only once the trip is published', async () => {
    await console_.create(admin(), draft('cover-public'));
    await console_.setCover(admin(), 'cover-public', await photograph());

    /* A draft is invisible whole — cover included. */
    expect((await publicTrips.list()).items).toHaveLength(0);

    await console_.update(admin(), 'cover-public', { status: 'published' });

    const listed = (await publicTrips.list()).items[0];
    const detail = await publicTrips.bySlug('cover-public');

    /*
      BOTH read paths, because they are separate SELECTs. The list query and the detail query were
      written apart and the list one nearly shipped without the cover columns — a card with no
      photograph beside a page with one, which is the shape «every instance of the same shape»
      exists to catch.
    */
    expect(listed?.cover?.fileKey, 'the LIST must carry the cover').toBeTruthy();
    expect(detail.cover?.fileKey, 'the DETAIL must carry the cover').toBeTruthy();
    expect(detail.cover?.variantWidths).toContain(1600);
  });

  /* The opposite control: without it, «the cover appears» would pass if it never disappeared. */
  it('clears every cover column when the photograph is removed', async () => {
    await console_.create(admin(), draft('cover-gone'));
    await console_.setCover(admin(), 'cover-gone', await photograph());
    await console_.update(admin(), 'cover-gone', { coverAltAr: 'وصف' });

    const cleared = await console_.removeCover(admin(), 'cover-gone');

    expect(cleared.cover).toBeNull();

    /*
      Read from the COLUMNS rather than the mapper, because the mapper collapses the whole group to
      null the moment the key is gone — so it would report success over a row still carrying an alt
      text and a width. That row is what the CHECK constraint forbids, and this is the assertion
      that the delete writes all seven columns rather than one.
    */
    const raw = await db.execute<{
      k: string | null;
      w: number | null;
      h: number | null;
      a: string | null;
      widths: number[];
    }>(sql`
      SELECT cover_file_key AS k, cover_width AS w, cover_height AS h,
             cover_alt_ar AS a, cover_variant_widths AS widths
        FROM group_trips WHERE slug = 'cover-gone'
    `);

    expect(raw.rows[0]).toEqual({ k: null, w: null, h: null, a: null, widths: [] });
  });

  it('refuses to remove a cover that is not there', async () => {
    await console_.create(admin(), draft('no-cover'));

    await expect(console_.removeCover(admin(), 'no-cover')).rejects.toSatisfy(
      (error: unknown) => codeOf(error) === ERROR.IMAGE_NOT_FOUND,
    );
  });

  /**
   * Alt text travels on `update`, and ABSENT is not the same request as NULL.
   *
   * This is the defect the `optional()` contract helper carried until 2026-09-28: absent mapped to
   * null, so a PATCH that mentioned only the title wiped every other translated field. A cover
   * with alt text in three languages is exactly where that would be expensive and silent.
   */
  it('keeps an untouched alt text and clears an explicitly null one', async () => {
    await console_.create(admin(), draft('alt-merge'));
    await console_.setCover(admin(), 'alt-merge', await photograph());
    await console_.update(admin(), 'alt-merge', {
      coverAltAr: 'سوق قديم',
      coverAltEn: 'An old souq',
    });

    /* A save that mentions neither must leave both standing. */
    await console_.update(admin(), 'alt-merge', { titleAr: 'عنوان جديد' });

    const kept = await console_.bySlug('alt-merge');

    expect(kept.cover?.alt.ar).toBe('سوق قديم');
    expect(kept.cover?.alt.en).toBe('An old souq');

    /* An explicit null is «this picture is decorative», and must actually clear it. */
    await console_.update(admin(), 'alt-merge', { coverAltEn: null });

    const after = await console_.bySlug('alt-merge');

    expect(after.cover?.alt.ar, 'the Arabic alt was not mentioned').toBe('سوق قديم');
    expect(after.cover?.alt.en, 'the English alt was explicitly cleared').toBeNull();
  });

  /* ── A published trip always has a photograph (Bashar, 2026-09-29) ───────── */

  it('refuses to publish a trip that has no photograph', async () => {
    await console_.create(admin(), draft('needs-a-picture'));

    await expect(
      console_.update(admin(), 'needs-a-picture', { status: 'published' }),
    ).rejects.toSatisfy(
      (error: unknown) => codeOf(error) === ERROR.GROUP_TRIP_COVER_REQUIRED,
    );

    /*
      The control, and it is the half that matters: without it «refuses to publish» would pass just
      as happily if publishing were broken for every trip. Same input, one photograph added.
    */
    await console_.setCover(admin(), 'needs-a-picture', await photograph());

    expect(
      (await console_.update(admin(), 'needs-a-picture', { status: 'published' })).slug,
    ).toBe('needs-a-picture');
  });

  /* A draft is a work in progress and is held to nothing — `readiness.ts` says so in its own words. */
  it('lets a draft be saved and edited with no photograph', async () => {
    await console_.create(admin(), draft('still-drafting'));

    expect(
      (await console_.update(admin(), 'still-drafting', { titleAr: 'عنوان' })).slug,
    ).toBe('still-drafting');
  });

  /**
   * The back door.
   *
   * Guarding only the publish transition would let two legal steps reach the state one illegal step
   * cannot: publish WITH a photograph, then delete it. Mutation: drop the status check in
   * `removeCover` and this goes green while the public page renders a text-only trip.
   */
  it('refuses to remove the photograph of a published trip', async () => {
    await console_.create(admin(), draft('published-with-art'));
    await console_.setCover(admin(), 'published-with-art', await photograph());
    await console_.update(admin(), 'published-with-art', { status: 'published' });

    await expect(console_.removeCover(admin(), 'published-with-art')).rejects.toSatisfy(
      (error: unknown) => codeOf(error) === ERROR.GROUP_TRIP_COVER_REQUIRED,
    );

    /* Archived, it is in front of nobody — so the photograph may go. */
    await console_.update(admin(), 'published-with-art', { status: 'archived' });

    expect((await console_.removeCover(admin(), 'published-with-art')).cover).toBeNull();
  });

  /*
    Replacing is not removing. A published trip must always HAVE a photograph, not keep its first
    one for ever — and `setCover` overwrites without passing through the removal guard.
  */
  it('lets a published trip swap its photograph', async () => {
    await console_.create(admin(), draft('swap-art'));
    await console_.setCover(admin(), 'swap-art', await photograph());
    await console_.update(admin(), 'swap-art', { status: 'published' });

    const first = (await console_.bySlug('swap-art')).cover?.fileKey;
    const second = (await console_.setCover(admin(), 'swap-art', await photograph()))
      .cover?.fileKey;

    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
  });

  /*
    Rows that predate the column stay editable. The rule guards the DOOR, not the state: holding
    every published trip to it on every save would make an older announcement uneditable, which is
    a rule arriving as an obstruction. Written with raw SQL because the service cannot produce this
    row any more — which is the point.
  */
  it('still lets an older published trip without a photograph be edited', async () => {
    await db.execute(sql`
      INSERT INTO group_trips (slug, city_id, title_ar, summary_ar, description_ar,
                               starts_on, ends_on, status, published_at)
      SELECT 'legacy-trip', c.id, 'رحلة قديمة', 'سطر.', 'وصف كافٍ.',
             '2027-05-01', '2027-05-07', 'published', now()
        FROM cities c WHERE c.slug = ${citySlug}
    `);

    expect(
      (await console_.update(admin(), 'legacy-trip', { titleAr: 'رحلة محدّثة' })).slug,
    ).toBe('legacy-trip');
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
