import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { createRollbackDatabase, type Database } from '@safra/db';

import { FavouritesService } from './favourites.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * المفضلة against a real PostgreSQL (handoff §6).
 *
 * The behaviour worth proving is all in SQL: an upsert that revives a soft-deleted row rather than
 * inserting a second one, a soft delete that leaves the row behind, a slug that only resolves for a
 * PUBLISHED listing, and a keyset page. A mock would assert that the service called a method.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const USER_ID = '99990000-0000-0000-0000-00000000ab01';
const PROFILE_ID = '99990000-0000-0000-0000-00000000ab02';
const OTHER_PROFILE_ID = '99990000-0000-0000-0000-00000000ab03';
const OTHER_USER_ID = '99990000-0000-0000-0000-00000000ab04';
const PARTNER_USER_ID = '99990000-0000-0000-0000-00000000ab05';
const PARTNER_ID = '99990000-0000-0000-0000-00000000ab06';

const PUBLISHED_SLUG = 'fav-test-published';
const DRAFT_SLUG = 'fav-test-draft';

const customer = (profileId = PROFILE_ID, sub = USER_ID): AccessTokenClaims => ({
  sub,
  role: 'customer',
  permissions: [],
  locale: 'ar',
  customerProfileId: profileId,
});

describeIfDb('FavouritesService', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  let db: Database;
  let service: FavouritesService;

  beforeEach(async () => {
    await harness.begin();
    db = harness.db;
    service = new FavouritesService(db);
    await seed(db);
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('saves a listing and lists it back with its names in every language', async () => {
    await service.save(customer(), PUBLISHED_SLUG);

    const page = await service.list(customer(), { limit: 20 });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.slug).toBe(PUBLISHED_SLUG);
    /* Unpicked, so the client can honour the locale the reader chose. */
    expect(page.items[0]?.property).toStrictEqual({
      nameAr: 'مفضل',
      nameEn: 'Favourite Test',
      nameDe: 'Favoritentest',
    });
    expect(page.items[0]?.isAvailable).toBe(true);
    expect(page.items[0]?.fromPrice).toBe('120.00');
    expect(page.items[0]?.currencyCode).toBe('USD');
  });

  /**
   * Saving twice leaves ONE row, keeping the date it was first saved.
   *
   * The unique index spans deleted rows too, so this is an upsert rather than a race between two
   * inserts — a double tap, a retry and a second tab all converge.
   */
  it('is idempotent, and keeps the original save date', async () => {
    await service.save(customer(), PUBLISHED_SLUG);
    const first = await service.list(customer(), { limit: 20 });

    await service.save(customer(), PUBLISHED_SLUG);
    const second = await service.list(customer(), { limit: 20 });

    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.savedAt).toBe(first.items[0]?.savedAt);

    const rows = await db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count FROM favourites
      WHERE customer_profile_id = ${PROFILE_ID}::uuid`);

    expect(rows.rows[0]?.count).toBe('1');
  });

  /** Un-saving is a SOFT delete: gone from the list, still on the table. */
  it('removes it from the list but keeps the row', async () => {
    await service.save(customer(), PUBLISHED_SLUG);
    await service.remove(customer(), PUBLISHED_SLUG);

    const page = await service.list(customer(), { limit: 20 });

    expect(page.items).toStrictEqual([]);

    const rows = await db.execute<{ deleted: string | null }>(sql`
      SELECT deleted_at::text AS deleted FROM favourites
      WHERE customer_profile_id = ${PROFILE_ID}::uuid`);

    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.deleted).not.toBeNull();
  });

  /** Saving again after removing revives the same row rather than adding a second. */
  it('revives a removed favourite instead of duplicating it', async () => {
    await service.save(customer(), PUBLISHED_SLUG);
    await service.remove(customer(), PUBLISHED_SLUG);
    await service.save(customer(), PUBLISHED_SLUG);

    const page = await service.list(customer(), { limit: 20 });
    const rows = await db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count FROM favourites
      WHERE customer_profile_id = ${PROFILE_ID}::uuid`);

    expect(page.items).toHaveLength(1);
    expect(rows.rows[0]?.count).toBe('1');
  });

  /** Removing something never saved is not an error — the intent is already satisfied. */
  it('accepts removing a listing that was never saved', async () => {
    await expect(service.remove(customer(), PUBLISHED_SLUG)).resolves.toStrictEqual({
      slug: PUBLISHED_SLUG,
      saved: false,
    });
  });

  /**
   * A draft cannot be saved, and says only "not found".
   *
   * Otherwise a slug could be probed for existence, and a listing could be shortlisted before its
   * partner ever chose to publish it.
   */
  it('refuses a listing that is not published', async () => {
    await expect(service.save(customer(), DRAFT_SLUG)).rejects.toMatchObject({
      response: { code: 'property.not_found' },
    });
  });

  it('refuses a slug that does not exist at all, identically', async () => {
    await expect(service.save(customer(), 'no-such-listing')).rejects.toMatchObject({
      response: { code: 'property.not_found' },
    });
  });

  /** Scoped to the caller. Neither customer can see or affect the other's shortlist. */
  it('never shows another customer’s favourites', async () => {
    await service.save(customer(), PUBLISHED_SLUG);

    const theirs = await service.list(customer(OTHER_PROFILE_ID, OTHER_USER_ID), {
      limit: 20,
    });

    expect(theirs.items).toStrictEqual([]);
  });

  /** A token with no customer profile — staff, a partner — has no favourites of its own. */
  it('refuses a token carrying no customer profile', async () => {
    const staff: AccessTokenClaims = {
      sub: USER_ID,
      role: 'support_agent',
      permissions: [],
      locale: 'ar',
    };

    await expect(service.list(staff, { limit: 20 })).rejects.toMatchObject({
      response: { code: 'customer.not_found' },
    });
  });

  it('refuses a malformed cursor rather than restarting at page one', async () => {
    await expect(
      service.list(customer(), { limit: 20, cursor: 'not-a-cursor' }),
    ).rejects.toMatchObject({ response: { code: 'request.cursor_invalid' } });
  });

  /**
   * `status` — the read the save button makes for itself.
   *
   * It exists because the property page is CACHED (`revalidate = 60`), so its saved state cannot be
   * server-rendered: a cached page would hand one customer's shortlist to the next. These assertions
   * were written after the method, which is how it came to ship untested for a turn.
   */
  describe('status', () => {
    it('answers false before anything is saved', async () => {
      await expect(service.status(customer(), PUBLISHED_SLUG)).resolves.toStrictEqual({
        slug: PUBLISHED_SLUG,
        saved: false,
      });
    });

    it('answers true once saved, and false again once removed', async () => {
      await service.save(customer(), PUBLISHED_SLUG);
      await expect(service.status(customer(), PUBLISHED_SLUG)).resolves.toMatchObject({
        saved: true,
      });

      await service.remove(customer(), PUBLISHED_SLUG);
      await expect(service.status(customer(), PUBLISHED_SLUG)).resolves.toMatchObject({
        saved: false,
      });
    });

    /* Scoped to the caller: one customer's save must not light up another's button. */
    it('answers false for a different customer', async () => {
      await service.save(customer(), PUBLISHED_SLUG);

      await expect(
        service.status(customer(OTHER_PROFILE_ID, OTHER_USER_ID), PUBLISHED_SLUG),
      ).resolves.toMatchObject({ saved: false });
    });

    /**
     * An anonymous or non-customer caller gets `false`, NOT a refusal.
     *
     * Unlike `list`, which throws. "Is this saved" has a truthful answer for a guest, and it is no — and
     * the property page is public, so a throw here would break a page for visitors who are not signed
     * in at all.
     */
    it.each<[string, AccessTokenClaims | undefined]>([
      ['no claims at all', undefined],
      [
        'a token with no customer profile',
        {
          sub: USER_ID,
          role: 'support_agent',
          permissions: [],
          locale: 'ar',
        },
      ],
    ])('answers false for %s rather than throwing', async (_label, claims) => {
      await expect(service.status(claims, PUBLISHED_SLUG)).resolves.toStrictEqual({
        slug: PUBLISHED_SLUG,
        saved: false,
      });
    });

    it('answers false for a slug that does not exist, without throwing', async () => {
      await expect(service.status(customer(), 'no-such-listing')).resolves.toMatchObject({
        saved: false,
      });
    });

    /* A saved listing that was later suspended is still SAVED — the button must keep saying so. */
    it('still reports a suspended listing as saved', async () => {
      await service.save(customer(), PUBLISHED_SLUG);
      await db.execute(sql`
        UPDATE properties SET status = 'suspended' WHERE slug = ${PUBLISHED_SLUG}`);

      await expect(service.status(customer(), PUBLISHED_SLUG)).resolves.toMatchObject({
        saved: true,
      });
    });
  });

  /**
   * An unpublished listing that was already saved is REPORTED, not hidden.
   *
   * Dropping it silently would look like the save had failed. The screen can say "no longer
   * available" only if the API tells it.
   */
  it('keeps a saved listing that was later unpublished, flagged as unavailable', async () => {
    await service.save(customer(), PUBLISHED_SLUG);

    await db.execute(sql`
      UPDATE properties SET status = 'suspended' WHERE slug = ${PUBLISHED_SLUG}`);

    const page = await service.list(customer(), { limit: 20 });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.isAvailable).toBe(false);
  });
});

async function seed(db: Database): Promise<void> {
  for (const [id, email] of [
    [USER_ID, 'fav-one@safra.test'],
    [OTHER_USER_ID, 'fav-two@safra.test'],
  ] as const) {
    await db.execute(sql`
      INSERT INTO users (id, email, role) VALUES (${id}::uuid, ${email}, 'customer')
      ON CONFLICT DO NOTHING`);
  }

  await db.execute(sql`
    INSERT INTO users (id, email, role)
    VALUES (${PARTNER_USER_ID}::uuid, 'fav-partner@safra.test', 'partner')
    ON CONFLICT DO NOTHING`);

  for (const [id, userId, name, email] of [
    [PROFILE_ID, USER_ID, 'واحد', 'fav-one@safra.test'],
    [OTHER_PROFILE_ID, OTHER_USER_ID, 'اثنان', 'fav-two@safra.test'],
  ] as const) {
    await db.execute(sql`
      INSERT INTO customer_profiles (id, user_id, full_name, email, phone, is_guest)
      VALUES (${id}::uuid, ${userId}::uuid, ${name}, ${email}, '+963900000020', false)
      ON CONFLICT DO NOTHING`);
  }

  await db.execute(sql`
    INSERT INTO partners (id, user_id, partner_type_id, legal_name, display_name, city_id,
                          address, phone, email)
    SELECT ${PARTNER_ID}::uuid, ${PARTNER_USER_ID}::uuid, pt.id, 'Fav', 'مفضل', c.id,
           'Addr', '+963900000021', 'fav-partner@safra.test'
    FROM partner_types pt, cities c
    WHERE pt.code = 'accommodation' AND c.slug = 'damascus'
    LIMIT 1
    ON CONFLICT DO NOTHING`);

  /* One published listing to save, and one draft that must refuse to be saved. */
  for (const [slug, status] of [
    [PUBLISHED_SLUG, 'published'],
    [DRAFT_SLUG, 'draft'],
  ] as const) {
    await db.execute(sql`
      INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                              slug, name_ar, name_en, name_de, address, status)
      SELECT ${PARTNER_ID}::uuid, c.id, pt.id, cp.id, ${slug},
             'مفضل', 'Favourite Test', 'Favoritentest', 'Addr', ${status}::property_status
      FROM cities c, property_types pt, cancellation_policies cp
      WHERE c.slug = 'damascus' AND pt.code = 'apartment' AND cp.code = 'flex'
      LIMIT 1
      ON CONFLICT DO NOTHING`);
  }

  /* Two units, so the "from" price has to be the CHEAPER one rather than whichever comes first. */
  for (const price of ['180.00', '120.00'] as const) {
    await db.execute(sql`
      INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests,
                         base_price, currency_id, min_nights)
      SELECT p.id, 'وحدة', 'Unit', 'Einheit', 2, ${price}, cu.id, 1
      FROM properties p, currencies cu
      WHERE p.slug = ${PUBLISHED_SLUG} AND cu.code = 'USD'
      LIMIT 1`);
  }
}
