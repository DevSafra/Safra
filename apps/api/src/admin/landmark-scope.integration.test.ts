import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ERROR } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { LandmarkService } from './landmark.service.js';

/**
 * A landmark edit reaches exactly one landmark, and only one the actor may write.
 *
 * ## The two defects this holds closed
 *
 * 1. **Ambiguous address.** Edits were `PATCH /admin/landmarks/:slug`, and a slug is unique only
 *    WITHIN a city. Two cities with an «airport» meant the edit landed on whichever row Postgres
 *    returned first. Every case below builds the SAME slug in two cities, because with one row
 *    the old lookup and the new one are indistinguishable and the test would pass on the defect.
 * 2. **No scope.** `GEO_MANAGE` can be held by a role limited to cities, and nothing asked which
 *    city the landmark was in, or which city it was being moved to.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('landmark edits: one row, inside the actor’s scope', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  const service = new LandmarkService(db, new AuditService(db));

  type City = {
    id: string;
    slug: string;
    latitude: string;
    longitude: string;
  };

  let home: City;
  let away: City;
  let kindCode = '';
  let slug = '';

  /* A real user row: the audit log's actor is a foreign key. */
  let staffId = '';

  const superAdmin = (): AccessTokenClaims =>
    ({
      sub: staffId,
      role: 'super_admin',
      permissions: ['geo.manage'],
    }) as unknown as AccessTokenClaims;

  const scopedTo = (
    cityIds: string[],
    outside: 'none' | 'read_only' = 'none',
  ): AccessTokenClaims =>
    ({
      sub: staffId,
      role: 'operations_manager',
      permissions: ['geo.manage'],
      scope: { kind: 'cities', cityIds, outside },
    }) as unknown as AccessTokenClaims;

  /** Files `slug` in a city, positioned on the city itself so the distance check is not in play. */
  async function file(city: City): Promise<string> {
    await service.create(superAdmin(), {
      citySlug: city.slug,
      kindCode,
      slug,
      nameAr: `معلم ${city.slug}`,
      nameEn: `Landmark ${city.slug}`,
      nameDe: `Wahrzeichen ${city.slug}`,
      latitude: city.latitude,
      longitude: city.longitude,
    });

    const listed = await service.list({
      page: 1,
      size: 100,
      citySlug: city.slug,
      q: slug,
    });
    const id = listed.items.find((row) => row.slug === slug)?.id;

    if (!id) throw new Error(`the fixture landmark in ${city.slug} was not listed`);

    return id;
  }

  async function nameOf(id: string): Promise<{ name_en: string; deleted: boolean }> {
    const found = await db.execute<{ name_en: string; deleted: boolean }>(sql`
      SELECT name_en, deleted_at IS NOT NULL AS deleted FROM landmarks WHERE id = ${id}::uuid
    `);
    const row = found.rows[0];

    if (!row) throw new Error('landmark row vanished');

    return row;
  }

  beforeEach(async () => {
    await harness.begin();

    const staff = await db.execute<{ id: string }>(sql`
      INSERT INTO users (email, phone, role, status)
      VALUES (${`lm-${randomUUID()}@safra.test`}, '+963900000170', 'super_admin', 'active')
      RETURNING id::text
    `);

    staffId = staff.rows[0]?.id ?? '';

    const cities = await db.execute<City>(sql`
      SELECT id::text, slug,
             coalesce(latitude::text, '33.5138') AS latitude,
             coalesce(longitude::text, '36.2765') AS longitude
      FROM cities WHERE deleted_at IS NULL ORDER BY slug LIMIT 2
    `);
    const kind = await db.execute<{ code: string }>(sql`
      SELECT code FROM landmark_kinds WHERE deleted_at IS NULL ORDER BY code LIMIT 1
    `);

    const [first, second] = cities.rows;

    if (!first || !second || !kind.rows[0]) {
      throw new Error('the landmark scope fixture needs two cities and a landmark kind');
    }

    home = first;
    away = second;
    kindCode = kind.rows[0].code;
    slug = `scope-${randomUUID().slice(0, 8)}`;
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  it('edits the landmark it names, and not its namesake in another city', async () => {
    const mine = await file(home);
    const namesake = await file(away);

    await service.update(superAdmin(), namesake, { nameEn: 'Edited' });

    expect((await nameOf(namesake)).name_en).toBe('Edited');
    expect((await nameOf(mine)).name_en, 'the same slug elsewhere is untouched').toBe(
      `Landmark ${home.slug}`,
    );
  });

  it('archives the landmark it names, and not its namesake in another city', async () => {
    const mine = await file(home);
    const namesake = await file(away);

    await service.archive(superAdmin(), namesake);

    expect((await nameOf(namesake)).deleted).toBe(true);
    expect((await nameOf(mine)).deleted, 'the same slug elsewhere is still live').toBe(
      false,
    );
  });

  /**
   * «Not yours» answers like «not there» for a member who cannot see the city, with the control
   * that the same member CAN edit the landmark in their own city — otherwise a service that
   * refused everybody would pass.
   */
  it('refuses a landmark outside a scoped member’s cities as if it did not exist', async () => {
    const mine = await file(home);
    const theirs = await file(away);
    const member = scopedTo([home.id]);

    await expect(service.update(member, theirs, { nameEn: 'X' })).rejects.toMatchObject({
      response: { code: ERROR.LANDMARK_NOT_FOUND },
    });
    await expect(service.archive(member, theirs)).rejects.toMatchObject({
      response: { code: ERROR.LANDMARK_NOT_FOUND },
    });
    await expect(
      service.update(member, randomUUID(), { nameEn: 'X' }),
    ).rejects.toMatchObject({
      response: { code: ERROR.LANDMARK_NOT_FOUND },
    });

    expect((await nameOf(theirs)).name_en).toBe(`Landmark ${away.slug}`);
    expect((await nameOf(theirs)).deleted).toBe(false);

    await expect(service.update(member, mine, { nameEn: 'Mine' })).resolves.toMatchObject(
      {
        slug,
      },
    );
  });

  it('lets a read-only member see past their cities and change nothing there', async () => {
    const theirs = await file(away);
    const member = scopedTo([home.id], 'read_only');

    await expect(service.update(member, theirs, { nameEn: 'X' })).rejects.toMatchObject({
      response: { code: ERROR.SCOPE_OUTSIDE },
    });
    await expect(service.archive(member, theirs)).rejects.toMatchObject({
      response: { code: ERROR.SCOPE_OUTSIDE },
    });
  });

  /** The destination is a write too: moving a landmark files it in a city. */
  it('refuses to file or move a landmark into a city outside the member’s scope', async () => {
    const mine = await file(home);
    const member = scopedTo([home.id]);

    await expect(
      service.update(member, mine, {
        citySlug: away.slug,
        latitude: away.latitude,
        longitude: away.longitude,
      }),
    ).rejects.toMatchObject({ response: { code: ERROR.SCOPE_OUTSIDE } });

    await expect(
      service.create(member, {
        citySlug: away.slug,
        kindCode,
        slug: `${slug}-new`,
        nameAr: 'جديد',
        nameEn: 'New',
        nameDe: 'Neu',
        latitude: away.latitude,
        longitude: away.longitude,
      }),
    ).rejects.toMatchObject({ response: { code: ERROR.SCOPE_OUTSIDE } });

    /* The control: the same member files one in their own city. */
    await expect(
      service.create(member, {
        citySlug: home.slug,
        kindCode,
        slug: `${slug}-new`,
        nameAr: 'جديد',
        nameEn: 'New',
        nameDe: 'Neu',
        latitude: home.latitude,
        longitude: home.longitude,
      }),
    ).resolves.toStrictEqual({ slug: `${slug}-new` });
  });

  /** Moving onto a city that already has the slug is a clash, answered as the create answers it. */
  it('refuses to move a landmark onto a city that already has its slug', async () => {
    const mine = await file(home);

    await file(away);

    await expect(
      service.update(superAdmin(), mine, {
        citySlug: away.slug,
        latitude: away.latitude,
        longitude: away.longitude,
      }),
    ).rejects.toMatchObject({ response: { code: ERROR.LANDMARK_SLUG_TAKEN } });
  });
});
