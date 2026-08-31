import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ERROR } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { CityImagesController } from './city-images.controller.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import type { ImageService } from '../storage/image.service.js';

/**
 * What a city photograph SAYS, and which one §5.4's hero band draws.
 *
 * ## The gap (Bashar, 2026-08-31)
 *
 * `alt_ar/en/de`, `credit`, `is_hero` and `sort_order` have existed since `city_images` was
 * written and NONE of them could be changed: the upload made the first picture the hero and
 * ordered the rest by arrival. So every image on the first third of every public city page went
 * out with an empty `alt`, and a screen reader announced nothing at all.
 *
 * ## What these cases are really guarding
 *
 * The hero being EXCLUSIVE, and the absent-versus-null distinction. Two heroes is not a state the
 * page can draw — `ORDER BY is_hero DESC` picks either — and an alt text that cannot be cleared is
 * an alt text that cannot say «this image is decorative».
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('managing a city photograph', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  /* Nothing here uploads, so the pipeline is never reached. */
  const controller = new CityImagesController(
    db,
    { remove: () => Promise.resolve() } as unknown as ImageService,
    new AuditService(db),
  );

  let staffId = '';
  let slug = '';
  const ids: string[] = [];

  const staff = (): AccessTokenClaims =>
    ({
      sub: staffId,
      role: 'super_admin',
      permissions: ['geo.manage'],
    }) as unknown as AccessTokenClaims;

  const image = async (id: string) =>
    (
      await db.execute<{
        alt_ar: string | null;
        alt_en: string | null;
        credit: string | null;
        is_hero: boolean;
        sort_order: number;
      }>(sql`
        SELECT alt_ar, alt_en, credit, is_hero, sort_order FROM city_images
        WHERE id = ${id}::uuid
      `)
    ).rows[0];

  beforeEach(async () => {
    await harness.begin();

    const made = await db.execute<{ id: string }>(sql`
      INSERT INTO users (email, phone, role, status)
      VALUES ('img-' || gen_random_uuid() || '@safra.test', '+963900000181',
              'super_admin', 'active')
      RETURNING id::text
    `);

    staffId = made.rows[0]?.id ?? '';
    slug = `shot-${Math.random().toString(36).slice(2, 7)}`;

    const city = await db.execute<{ id: string }>(sql`
      INSERT INTO cities (country_id, slug, name_ar, name_en, name_de, timezone)
      VALUES ((SELECT id FROM countries WHERE deleted_at IS NULL ORDER BY code LIMIT 1),
              ${slug}, 'مدينة', 'City', 'Stadt', 'Asia/Damascus')
      RETURNING id::text
    `);

    ids.length = 0;

    /* Two photographs, the first of them the hero — exactly what an upload produces. */
    for (const [index, key] of [`cities/${slug}/a`, `cities/${slug}/b`].entries()) {
      const row = await db.execute<{ id: string }>(sql`
        INSERT INTO city_images (city_id, file_key, width, height, variant_widths,
                                 is_hero, sort_order)
        VALUES (${city.rows[0]?.id}::uuid, ${key}, 1600, 900, '{480,960}',
                ${index === 0}, ${index})
        RETURNING id::text
      `);

      ids.push(row.rows[0]?.id ?? '');
    }
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  it('writes the alt text and the credit, and logs it', async () => {
    const id = ids[0] ?? '';

    await controller.update(staff(), slug, id, {
      altAr: 'سوق مسقوف في وسط المدينة',
      altEn: 'A covered market',
      credit: 'SAFRA',
    });

    expect(await image(id)).toMatchObject({
      alt_ar: 'سوق مسقوف في وسط المدينة',
      alt_en: 'A covered market',
      credit: 'SAFRA',
    });

    const logged = await db.execute<{ actor: string | null }>(sql`
      SELECT actor_user_id AS actor FROM audit_log
      WHERE action = 'city_image.updated' ORDER BY created_at DESC LIMIT 1
    `);

    expect(logged.rows[0]?.actor).toBe(staffId);
  });

  /**
   * `null` clears an alt; an omitted key leaves it.
   *
   * An empty alt is the CORRECT answer for a decorative image, so it has to be expressible — and
   * a `coalesce` would have made clearing impossible while looking identical in every other case.
   */
  it('clears an alt with null and leaves an omitted one alone', async () => {
    const id = ids[0] ?? '';

    await controller.update(staff(), slug, id, { altAr: 'نص', altEn: 'Text' });
    await controller.update(staff(), slug, id, { altAr: null });

    expect(await image(id)).toMatchObject({ alt_ar: null, alt_en: 'Text' });
  });

  /**
   * One hero per city — the previous one is cleared in the same transaction.
   *
   * Two heroes is not a state §5.4 can draw. Both rows are asserted, because a naming that set the
   * new one without clearing the old would leave the page picking either.
   */
  it('moves the hero rather than adding a second one', async () => {
    const [first, second] = ids as [string, string];

    await controller.update(staff(), slug, second, { isHero: true });

    expect((await image(second))?.is_hero, 'the named one').toBe(true);
    expect((await image(first))?.is_hero, 'and only that one').toBe(false);

    const heroes = await db.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n FROM city_images ci
      JOIN cities c ON c.id = ci.city_id
      WHERE c.slug = ${slug} AND ci.is_hero AND ci.deleted_at IS NULL
    `);

    expect(heroes.rows[0]?.n).toBe('1');
  });

  it('reorders without touching what the photographs say', async () => {
    const id = ids[1] ?? '';

    await controller.update(staff(), slug, id, { altAr: 'وصف' });
    await controller.update(staff(), slug, id, { sortOrder: 0 });

    expect(await image(id)).toMatchObject({ sort_order: 0, alt_ar: 'وصف' });
  });

  /** A photograph of ANOTHER city is not this city's to edit — the slug is part of the lookup. */
  it('refuses a photograph that does not belong to the named city', async () => {
    const other = await db.execute<{ id: string }>(sql`
      INSERT INTO city_images (city_id, file_key, width, height, variant_widths)
      VALUES ((SELECT id FROM cities WHERE slug <> ${slug} AND deleted_at IS NULL LIMIT 1),
              ${`cities/elsewhere/${slug}`}, 800, 600, '{480}')
      RETURNING id::text
    `);

    await expect(
      controller.update(staff(), slug, other.rows[0]?.id ?? '', { altAr: 'لا' }),
    ).rejects.toMatchObject({ response: { code: ERROR.IMAGE_NOT_FOUND } });
  });

  /** And a retired one is gone, not merely hidden — the archive path this screen finally calls. */
  it('refuses a photograph that has been removed', async () => {
    const id = ids[0] ?? '';

    await controller.remove(slug, id);

    await expect(
      controller.update(staff(), slug, id, { altAr: 'لا' }),
    ).rejects.toMatchObject({ response: { code: ERROR.IMAGE_NOT_FOUND } });
  });
});
