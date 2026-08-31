import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { ERROR } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { GeoWriteService } from './geo-write.service.js';
import type { ImageService } from '../storage/image.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * Creating and correcting geography — the three «+ إضافة» buttons, and closing a city.
 *
 * ## The gap (Bashar, 2026-08-30)
 *
 * P-005 says launch geography is an OPERATIONAL value staff adjust. The screen showed three
 * disabled buttons and a cities table no row could be opened from: a market could be opened only
 * by a migration and could not be closed at all.
 *
 * ## What every case here is really guarding
 *
 * That a write LANDED and that the audit line landed with it. A row written with no audit row is
 * the pair this codebase refuses, and it is invisible to anything that only checks the response.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('creating and correcting geography', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  /*
    A recording stand-in for `ImageService`, so the test can see which keys were removed.
    A real one would need a bucket; what is under test is WHICH objects the delete asks for and
    WHEN — not sharp, and not S3.
  */
  const removed: string[] = [];
  const images = {
    remove: (fileKey: string) => {
      removed.push(fileKey);

      return Promise.resolve();
    },
  } as unknown as ImageService;

  const service = new GeoWriteService(db, new AuditService(db), images);

  let staffId = '';
  /** A code that cannot collide with the seeded set, per test. */
  let suffix = '';

  const staff = (): AccessTokenClaims =>
    ({
      sub: staffId,
      role: 'super_admin',
      permissions: ['geo.manage'],
    }) as unknown as AccessTokenClaims;

  const auditRow = async (action: string) =>
    (
      await db.execute<{ actor: string | null; after: unknown; before: unknown }>(sql`
        SELECT actor_user_id AS actor, after, before FROM audit_log
        WHERE action = ${action} ORDER BY created_at DESC LIMIT 1
      `)
    ).rows[0];

  beforeEach(async () => {
    removed.length = 0;
    await harness.begin();

    const made = await db.execute<{ id: string }>(sql`
      INSERT INTO users (email, phone, role, status)
      VALUES ('geo-' || gen_random_uuid() || '@safra.test', '+963900000180',
              'super_admin', 'active')
      RETURNING id::text
    `);

    staffId = made.rows[0]?.id ?? '';
    /* Two letters from a uuid: enough for a fresh ISO-shaped code inside one transaction. */
    suffix = Math.random().toString(36).slice(2, 4).toUpperCase();
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  /* ── Currencies ─────────────────────────────────────────────────────────── */

  /**
   * The symbol and the decimals come from the CODE, never from the caller.
   *
   * JOD carries THREE minor-unit digits, and a currency stored with two truncates 10.125 to 10.13
   * on the way in — the defect `0049_concerned_eternals.sql` exists to undo. Asserting the stored
   * row rather than the response is what makes this about the database.
   */
  it('adds a currency with the symbol and decimals its code carries', async () => {
    /* Retired in post/0017, so the code is free and its facts are unmistakable. */
    await expect(
      service.createCurrency(staff(), {
        code: 'JOD',
        nameAr: 'دينار أردني',
        nameEn: 'Jordanian Dinar',
        nameDe: 'Jordanischer Dinar',
      }),
    ).resolves.toEqual({ code: 'JOD' });

    const row = await db.execute<{
      symbol: string;
      decimals: number;
      is_active: boolean;
    }>(sql`
      SELECT symbol, decimals, is_active FROM currencies
      WHERE code = 'JOD' AND deleted_at IS NULL
    `);

    expect(row.rows[0]).toMatchObject({ symbol: 'د.أ', decimals: 3, is_active: true });

    const logged = await auditRow('currency.created');

    expect(logged?.actor).toBe(staffId);
    /* The CODE, not the row id — an operator reading سجل التدقيق must not have to look it up. */
    expect(JSON.stringify(logged?.after)).toContain('JOD');
  });

  /**
   * A retired currency comes back as the SAME row, not a second one.
   *
   * The clash check read every row, so once `post/0017` retired JOD and LBP neither could be added
   * again — «that code is already in use» about a currency the screen does not show. And the fix
   * must reinstate rather than insert: the id is what bookings, wallet movements and ledger rows
   * point at, so a second row would leave the history pointing at the retired one.
   */
  it('reinstates a retired currency in place, keeping its id', async () => {
    const was = await db.execute<{ id: string }>(sql`
      SELECT id::text FROM currencies WHERE code = 'LBP'
    `);

    const before = was.rows[0]?.id;

    expect(before, 'LBP is retired in this database').toBeTruthy();

    await service.createCurrency(staff(), {
      code: 'LBP',
      nameAr: 'ليرة لبنانية',
      nameEn: 'Lebanese Pound',
      nameDe: 'Libanesisches Pfund',
    });

    const now = await db.execute<{ id: string; n: string; retired: boolean }>(sql`
      SELECT id::text, (deleted_at IS NOT NULL) AS retired,
             (SELECT count(*)::text FROM currencies WHERE code = 'LBP') AS n
      FROM currencies WHERE code = 'LBP' AND deleted_at IS NULL
    `);

    expect(now.rows[0]?.id, 'the same row, so history still resolves').toBe(before);
    expect(now.rows[0]?.retired).toBe(false);
    expect(now.rows[0]?.n, 'one row, not two').toBe('1');
  });

  /** A code outside the catalogue is refused rather than stored half-known. */
  it('refuses a code it has no symbol or decimals for', async () => {
    await expect(
      service.createCurrency(staff(), {
        code: 'ZZZ',
        nameAr: 'مجهولة',
        nameEn: 'Unknown',
        nameDe: 'Unknown',
      }),
    ).rejects.toMatchObject({ response: { code: ERROR.GEO_CURRENCY_UNKNOWN } });
  });

  it('refuses a currency code that already exists', async () => {
    await expect(
      service.createCurrency(staff(), {
        code: 'USD',
        nameAr: 'مكرر',
        nameEn: 'Dup',
        nameDe: 'Dup',
      }),
    ).rejects.toMatchObject({ response: { code: ERROR.GEO_CODE_TAKEN } });
  });

  /* ── Countries ──────────────────────────────────────────────────────────── */

  it('adds a country against an existing currency', async () => {
    const code = `Q${suffix[0] ?? 'X'}`;

    await expect(
      service.createCountry(staff(), {
        code,
        nameAr: 'دولة اختبار',
        nameEn: 'Testland',
        nameDe: 'Testland',
        displayCurrencyCode: 'USD',
        isLaunchMarket: false,
      }),
    ).resolves.toEqual({ code });

    const row = await db.execute<{ currency: string }>(sql`
      SELECT cur.code AS currency FROM countries co
      JOIN currencies cur ON cur.id = co.display_currency_id
      WHERE co.code = ${code}
    `);

    expect(row.rows[0]?.currency).toBe('USD');
    expect((await auditRow('country.created'))?.actor).toBe(staffId);
  });

  /**
   * A country priced in a currency that does not exist would break every listing in it, and the
   * refusal names the CURRENCY rather than the request — the operator's next action is to add it.
   */
  it('refuses a country whose display currency does not exist', async () => {
    await expect(
      service.createCountry(staff(), {
        code: 'ZZ',
        nameAr: 'لا عملة',
        nameEn: 'No currency',
        nameDe: 'No currency',
        displayCurrencyCode: 'ZZZ',
        isLaunchMarket: false,
      }),
    ).rejects.toMatchObject({ response: { code: ERROR.GEO_CURRENCY_UNKNOWN } });

    const none = await db.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n FROM countries WHERE code = 'ZZ'
    `);

    /* And nothing was written on the way to the refusal. */
    expect(none.rows[0]?.n).toBe('0');
  });

  /* ── Cities ─────────────────────────────────────────────────────────────── */

  it('adds a city with its categories and time zone', async () => {
    const slug = `test-city-${suffix.toLowerCase()}`;

    await expect(
      service.createCity(staff(), {
        countryCode: 'SY',
        slug,
        nameAr: 'مدينة اختبار',
        nameEn: 'Test City',
        nameDe: 'Teststadt',
        timezone: 'Asia/Damascus',
        categories: ['coastal', 'historic'],
      }),
    ).resolves.toEqual({ slug });

    const row = await db.execute<{ categories: string[]; timezone: string }>(sql`
      SELECT categories::text[] AS categories, timezone FROM cities WHERE slug = ${slug}
    `);

    /* An ARRAY of two, not a tuple — see `categoriesLiteral` on why that is worth asserting. */
    expect(row.rows[0]?.categories).toEqual(['coastal', 'historic']);
    expect(row.rows[0]?.timezone).toBe('Asia/Damascus');
  });

  /**
   * A city is filed under its categories in the JOIN, and in the legacy array beside it.
   *
   * `city_category_links` became the authority on 2026-08-30 when الفئات stopped being a pgEnum
   * and became a table staff can manage. `cities.categories` stays written because four readers
   * still use it — the customer city page, the home page's strip, `catalog.service` and the
   * geography screen. A write that updated one and not the other would show a category on one
   * surface and not the next, which is invisible until somebody compares two screens.
   */
  it('files a city in the join and in the array, and keeps them in step', async () => {
    const slug = `linked-${suffix.toLowerCase()}`;

    await service.createCity(staff(), {
      countryCode: 'SY',
      slug,
      nameAr: 'مدينة مرتبطة',
      nameEn: 'Linked',
      nameDe: 'Linked',
      timezone: 'Asia/Damascus',
      categories: ['coastal', 'historic'],
    });

    const both = await db.execute<{ links: string[]; arr: string[] }>(sql`
      SELECT (SELECT array_agg(cc.code ORDER BY cc.code)
              FROM city_category_links l
              JOIN city_categories cc ON cc.id = l.category_id
              WHERE l.city_id = c.id) AS links,
             (SELECT array_agg(x ORDER BY x) FROM unnest(c.categories::text[]) AS x) AS arr
      FROM cities c WHERE c.slug = ${slug}
    `);

    expect(both.rows[0]?.links).toEqual(['coastal', 'historic']);
    expect(both.rows[0]?.arr).toEqual(['coastal', 'historic']);

    /* And correcting them REPLACES rather than accumulates. */
    await service.updateCity(staff(), slug, { categories: ['desert'] });

    const after = await db.execute<{ links: string[]; arr: string[] }>(sql`
      SELECT (SELECT array_agg(cc.code)
              FROM city_category_links l
              JOIN city_categories cc ON cc.id = l.category_id
              WHERE l.city_id = c.id) AS links,
             (SELECT array_agg(x) FROM unnest(c.categories::text[]) AS x) AS arr
      FROM cities c WHERE c.slug = ${slug}
    `);

    expect(after.rows[0]?.links).toEqual(['desert']);
    expect(after.rows[0]?.arr).toEqual(['desert']);
  });

  /**
   * §5.3's same-day cutoff is 17:00 in the CITY's local time, so a city stored with a zone the
   * runtime cannot resolve closes its own bookings at the wrong hour — or throws when somebody
   * tries to book. Asked of `Intl` rather than a list of our own, which would drift with tzdata.
   */
  it('refuses a time zone the runtime does not recognise', async () => {
    await expect(
      service.createCity(staff(), {
        countryCode: 'SY',
        slug: `bad-zone-${suffix.toLowerCase()}`,
        nameAr: 'منطقة خاطئة',
        nameEn: 'Bad zone',
        nameDe: 'Bad zone',
        timezone: 'Mars/Olympus',
        categories: [],
      }),
    ).rejects.toMatchObject({ response: { code: ERROR.GEO_TIMEZONE_INVALID } });
  });

  /** Unique per COUNTRY, not globally: two countries may each have a «طرابلس». */
  it('refuses a slug already used in the same country, and allows it in another', async () => {
    const slug = `shared-${suffix.toLowerCase()}`;

    await service.createCity(staff(), {
      countryCode: 'SY',
      slug,
      nameAr: 'أولى',
      nameEn: 'First',
      nameDe: 'First',
      timezone: 'Asia/Damascus',
      categories: [],
    });

    await expect(
      service.createCity(staff(), {
        countryCode: 'SY',
        slug,
        nameAr: 'ثانية',
        nameEn: 'Second',
        nameDe: 'Second',
        timezone: 'Asia/Damascus',
        categories: [],
      }),
    ).rejects.toMatchObject({ response: { code: ERROR.GEO_SLUG_TAKEN } });

    /* The control: the same slug under a different country is legitimate. */
    await expect(
      service.createCity(staff(), {
        countryCode: 'JO',
        slug,
        nameAr: 'أخرى',
        nameEn: 'Other',
        nameDe: 'Other',
        timezone: 'Asia/Amman',
        categories: [],
      }),
    ).resolves.toEqual({ slug });
  });

  /**
   * Closing a city is the write with a public consequence: its listings leave the search. The
   * audit row records how many PUBLISHED properties that was, because «how much did that cost us»
   * is the question asked afterwards and a flag alone cannot answer it.
   */
  it('closes a city, and records how many listings it affected', async () => {
    const before = await db.execute<{ properties: string }>(sql`
      SELECT count(*)::text AS properties FROM properties p
      JOIN cities c ON c.id = p.city_id
      WHERE c.slug = 'damascus' AND p.status = 'published' AND p.deleted_at IS NULL
    `);

    await expect(
      service.updateCity(staff(), 'damascus', { isActive: false }),
    ).resolves.toEqual({ slug: 'damascus' });

    const row = await db.execute<{ is_active: boolean }>(sql`
      SELECT is_active FROM cities WHERE slug = 'damascus'
    `);

    expect(row.rows[0]?.is_active).toBe(false);

    const logged = await auditRow('city.updated');
    const after = JSON.stringify(logged?.after);

    expect(JSON.stringify(logged?.before)).toContain('true');
    expect(after).toContain('"isActive":false');
    expect(after, 'the audit says what closing it cost').toContain(
      `"publishedProperties":${Number(before.rows[0]?.properties ?? 0)}`,
    );
  });

  it('renames a city without touching anything it was not asked to', async () => {
    const before = await db.execute<{ timezone: string; categories: string[] }>(sql`
      SELECT timezone, categories::text[] AS categories FROM cities WHERE slug = 'damascus'
    `);

    await service.updateCity(staff(), 'damascus', { nameAr: 'دمشق الشام' });

    const after = await db.execute<{
      name_ar: string;
      timezone: string;
      categories: string[];
      is_active: boolean;
    }>(sql`
      SELECT name_ar, timezone, categories::text[] AS categories, is_active
      FROM cities WHERE slug = 'damascus'
    `);

    expect(after.rows[0]?.name_ar).toBe('دمشق الشام');
    /* Everything absent from the payload is left exactly as it was — `coalesce`, not a rewrite. */
    expect(after.rows[0]?.timezone).toBe(before.rows[0]?.timezone);
    expect(after.rows[0]?.categories).toEqual(before.rows[0]?.categories);
    expect(after.rows[0]?.is_active).toBe(true);
  });

  it('refuses to correct a city that does not exist', async () => {
    await expect(
      service.updateCity(staff(), 'no-such-city', { isActive: false }),
    ).rejects.toMatchObject({ response: { code: ERROR.GEO_CITY_NOT_FOUND } });
  });

  /**
   * A city's prose and its tags — Bashar, 2026-08-31.
   *
   * Both render on the PUBLIC city page and were writable only by a migration. The subtlety is not
   * that they save; it is that «clear this» and «leave this» are different requests, and `coalesce`
   * — which every other column here uses — cannot express both. A description written once could
   * never have been removed.
   */
  describe('a city’s public prose', () => {
    const cityProse = async (slug: string) =>
      (
        await db.execute<{
          description_ar: string | null;
          description_en: string | null;
          tags_ar: string[];
        }>(sql`
          SELECT description_ar, description_en, tags_ar FROM cities WHERE slug = ${slug}
        `)
      ).rows[0];

    it('writes the description and the tags in every language', async () => {
      await service.updateCity(staff(), 'damascus', {
        descriptionAr: 'أقدم عاصمة مأهولة في العالم.',
        descriptionEn: 'The oldest continuously inhabited capital.',
        tagsAr: ['المدينة القديمة', 'القلعة'],
      });

      const row = await cityProse('damascus');

      expect(row?.description_ar).toBe('أقدم عاصمة مأهولة في العالم.');
      expect(row?.description_en).toBe('The oldest continuously inhabited capital.');
      expect(row?.tags_ar).toEqual(['المدينة القديمة', 'القلعة']);
    });

    /**
     * The half `coalesce` cannot do.
     *
     * `null` CLEARS; an omitted key LEAVES. Without the distinction a description could be written
     * and never removed, and the test that only checked writing would never have noticed.
     */
    it('clears a description with null, and leaves an omitted one alone', async () => {
      await service.updateCity(staff(), 'damascus', {
        descriptionAr: 'نص مؤقت',
        descriptionEn: 'Temporary',
      });

      await service.updateCity(staff(), 'damascus', { descriptionAr: null });

      const row = await cityProse('damascus');

      expect(row?.description_ar, 'null clears it').toBeNull();
      expect(row?.description_en, 'an omitted key leaves it').toBe('Temporary');
    });

    it('empties the tag strip when given an empty list', async () => {
      await service.updateCity(staff(), 'damascus', { tagsAr: ['واحد'] });
      await service.updateCity(staff(), 'damascus', { tagsAr: [] });

      expect((await cityProse('damascus'))?.tags_ar).toEqual([]);
    });

    /**
     * A tag is free text somebody typed, so it must reach the statement as a PARAMETER.
     *
     * `textArray` builds `ARRAY[$1, $2]::text[]` rather than concatenating — a JS array handed to
     * a `sql` template expands to a tuple, and the workaround somebody reaches for next is string
     * interpolation. A quote round-tripping intact is what proves it did not.
     */
    it('stores a tag containing a quote exactly as typed', async () => {
      await service.updateCity(staff(), 'damascus', { tagsAr: [`باب' شرقي`] });

      expect((await cityProse('damascus'))?.tags_ar).toEqual([`باب' شرقي`]);
    });
  });

  /* ── Deleting ───────────────────────────────────────────────────────────── */

  /**
   * Deleting geography — added on 2026-08-31 because nothing could.
   *
   * Bashar: «I can add/edit everything on the page المدن والدول والعملات but I can not delete».
   *
   * ## What each case is really guarding
   *
   * Not that the delete works — that is the easy half. That it REFUSES when something points at
   * the row, and that the refusal is the coded one the console can turn into a sentence. A delete
   * that silently succeeded against a referenced row would either be rejected by the foreign key
   * as a 500 the reader cannot act on, or — if the key were ever relaxed — leave a booking whose
   * city cannot be named.
   *
   * Every refusal is paired with the OPPOSITE control: the same row, with nothing pointing at it,
   * deleting cleanly. «Refused» and «this code path is broken» are indistinguishable without it.
   */
  describe('deleting', () => {
    /** A city nothing points at, so a test can delete it or hang one reference on it. */
    const spareCity = async (): Promise<{ id: string; slug: string }> => {
      const slug = `probe-${suffix.toLowerCase()}${Math.random().toString(36).slice(2, 6)}`;

      const made = await db.execute<{ id: string }>(sql`
        INSERT INTO cities (country_id, slug, name_ar, name_en, name_de, timezone)
        VALUES ((SELECT id FROM countries WHERE deleted_at IS NULL ORDER BY code LIMIT 1),
                ${slug}, 'مدينة اختبار', 'Probe', 'Probe', 'Asia/Damascus')
        RETURNING id::text
      `);

      return { id: made.rows[0]?.id ?? '', slug };
    };

    it('removes a city nothing points at, and says so in the log', async () => {
      const city = await spareCity();

      await expect(service.deleteCity(staff(), city.slug)).resolves.toEqual({
        slug: city.slug,
      });

      const gone = await db.execute<{ n: string }>(sql`
        SELECT count(*)::text AS n FROM cities
        WHERE slug = ${city.slug} AND deleted_at IS NULL
      `);

      expect(gone.rows[0]?.n).toBe('0');

      const logged = await auditRow('city.deleted');

      expect(logged?.actor).toBe(staffId);
      /* The SLUG, so سجل التدقيق names the city rather than a uuid nobody can resolve. */
      expect(JSON.stringify(logged?.before)).toContain(city.slug);
    });

    /**
     * The photographs go with the city — the bytes, not only the rows.
     *
     * Bashar (2026-08-31): «clean up the storage objects as well when a city is deleted. I do not
     * see a strong reason to keep orphaned objects indefinitely if the corresponding records have
     * been removed.» A deliberate, narrow exception to P-003, which keeps a soft-deleted image's
     * bytes so an audit row naming its key stays verifiable — reasoning that holds while the city
     * exists and stops when it does not.
     *
     * Asserted at the KEY level rather than against a bucket: what is under test is which objects
     * the delete asks for, and that it asks for every one of them.
     */
    it('removes the objects of every photograph the city had', async () => {
      const city = await spareCity();

      const keys = [`cities/${city.slug}/one`, `cities/${city.slug}/two`];

      for (const key of keys) {
        await db.execute(sql`
          INSERT INTO city_images (city_id, file_key, width, height, variant_widths)
          VALUES (${city.id}::uuid, ${key}, 1600, 900, '{480,960,1600}')
        `);
      }

      await service.deleteCity(staff(), city.slug);

      expect([...removed].sort(), 'every key, and only those keys').toEqual(
        [...keys].sort(),
      );

      /* And the rows are retired too — the bytes and the record go together. */
      const live = await db.execute<{ n: string }>(sql`
        SELECT count(*)::text AS n FROM city_images
        WHERE city_id = ${city.id}::uuid AND deleted_at IS NULL
      `);

      expect(live.rows[0]?.n).toBe('0');

      /* The audit row says HOW MANY, since it can no longer point at keys that resolve. */
      const logged = await auditRow('city.deleted');

      expect(JSON.stringify(logged?.after)).toContain('"images":2');
    });

    /**
     * A REFUSED delete touches no object at all.
     *
     * This is the ordering the implementation is built around: the database commits first and the
     * bucket follows, because a transaction can roll back and a bucket delete cannot. Without this
     * assertion, removing the objects before the reference check would look identical — until the
     * day somebody refused a delete and lost the photographs anyway.
     */
    it('leaves every object alone when the delete is refused', async () => {
      const city = await spareCity();

      await db.execute(sql`
        INSERT INTO city_images (city_id, file_key, width, height, variant_widths)
        VALUES (${city.id}::uuid, ${`cities/${city.slug}/kept`}, 1600, 900, '{480}')
      `);

      await db.execute(sql`
        INSERT INTO properties
          (partner_id, city_id, property_type_id, cancellation_policy_id,
           reference, slug, name_ar, name_en, name_de, description_ar, address, status)
        VALUES ((SELECT id FROM partners LIMIT 1), ${city.id}::uuid,
                (SELECT id FROM property_types LIMIT 1),
                (SELECT id FROM cancellation_policies LIMIT 1),
                'PRO-999902', ${`probe-keep-${city.slug}`}, 'عقار', 'P', 'P', 'وصف',
                'شارع', 'draft')
      `);

      await expect(service.deleteCity(staff(), city.slug)).rejects.toMatchObject({
        response: { code: ERROR.GEO_CITY_IN_USE },
      });

      expect(removed, 'a refused delete destroys nothing').toEqual([]);
    });

    it('refuses a city a property points at, and names how many', async () => {
      const city = await spareCity();

      await db.execute(sql`
        INSERT INTO properties
          (partner_id, city_id, property_type_id, cancellation_policy_id,
           reference, slug, name_ar, name_en, name_de, description_ar, address, status)
        VALUES ((SELECT id FROM partners LIMIT 1), ${city.id}::uuid,
                (SELECT id FROM property_types LIMIT 1),
                (SELECT id FROM cancellation_policies LIMIT 1),
                'PRO-999901', ${`probe-prop-${city.slug}`}, 'عقار', 'P', 'P', 'وصف',
                'شارع', 'draft')
      `);

      await expect(service.deleteCity(staff(), city.slug)).rejects.toMatchObject({
        response: { code: ERROR.GEO_CITY_IN_USE },
      });

      /* And it is still there — a refused delete must not half-happen. */
      const alive = await db.execute<{ n: string }>(sql`
        SELECT count(*)::text AS n FROM cities
        WHERE slug = ${city.slug} AND deleted_at IS NULL
      `);

      expect(alive.rows[0]?.n).toBe('1');
    });

    /**
     * The city's OWN children go with it, and do not block it.
     *
     * A category link is a record about nothing but this city. Left behind it would keep the
     * CATEGORY undeletable for ever, pointing at a city nobody can see — «Before deleting, ask
     * what it DID», in reverse.
     */
    it('takes the city’s own category links with it rather than being blocked by them', async () => {
      const city = await spareCity();

      await db.execute(sql`
        INSERT INTO city_category_links (city_id, category_id)
        VALUES (${city.id}::uuid, (SELECT id FROM city_categories
                                   WHERE deleted_at IS NULL ORDER BY sort_order LIMIT 1))
      `);

      await expect(service.deleteCity(staff(), city.slug)).resolves.toBeTruthy();

      const links = await db.execute<{ n: string }>(sql`
        SELECT count(*)::text AS n FROM city_category_links WHERE city_id = ${city.id}::uuid
      `);

      expect(links.rows[0]?.n, 'the links go with the city').toBe('0');
    });

    it('refuses a country that still holds cities, and removes an empty one', async () => {
      const code = `Q${suffix.slice(0, 1)}`;

      await service.createCountry(staff(), {
        code,
        nameAr: 'دولة اختبار',
        nameEn: 'Probe',
        nameDe: 'Probe',
        displayCurrencyCode: 'USD',
        isLaunchMarket: false,
      });

      /* Empty: it goes. */
      await expect(service.deleteCountry(staff(), code)).resolves.toEqual({ code });

      /* Added back by the same code — the reinstate path, which is what makes this reversible. */
      await service.createCountry(staff(), {
        code,
        nameAr: 'دولة اختبار',
        nameEn: 'Probe',
        nameDe: 'Probe',
        displayCurrencyCode: 'USD',
        isLaunchMarket: false,
      });

      await db.execute(sql`
        INSERT INTO cities (country_id, slug, name_ar, name_en, name_de, timezone)
        VALUES ((SELECT id FROM countries WHERE code = ${code}),
                ${`probe-city-${code.toLowerCase()}`}, 'مدينة', 'P', 'P', 'Asia/Damascus')
      `);

      await expect(service.deleteCountry(staff(), code)).rejects.toMatchObject({
        response: { code: ERROR.GEO_COUNTRY_IN_USE },
      });
    });

    /**
     * A country whose only city was DELETED still holds it.
     *
     * The count is deliberately of every row, not the live ones: a soft-deleted city keeps its
     * `country_id`, so a country that looks empty on screen is still pointed at, and a delete that
     * counted only live cities would hit the foreign key as a 500.
     */
    it('still counts a soft-deleted city against its country', async () => {
      const code = `R${suffix.slice(0, 1)}`;

      await service.createCountry(staff(), {
        code,
        nameAr: 'دولة اختبار',
        nameEn: 'Probe',
        nameDe: 'Probe',
        displayCurrencyCode: 'USD',
        isLaunchMarket: false,
      });

      const slug = `probe-dead-${code.toLowerCase()}`;

      await db.execute(sql`
        INSERT INTO cities (country_id, slug, name_ar, name_en, name_de, timezone, deleted_at)
        VALUES ((SELECT id FROM countries WHERE code = ${code}),
                ${slug}, 'مدينة', 'P', 'P', 'Asia/Damascus', now())
      `);

      await expect(service.deleteCountry(staff(), code)).rejects.toMatchObject({
        response: { code: ERROR.GEO_COUNTRY_IN_USE },
      });
    });

    it('removes an unused currency and refuses one a unit is priced in', async () => {
      await service.createCurrency(staff(), {
        code: 'GBP',
        nameAr: 'جنيه إسترليني',
        nameEn: 'Pound Sterling',
        nameDe: 'Pfund Sterling',
      });

      await expect(service.deleteCurrency(staff(), 'GBP')).resolves.toEqual({
        code: 'GBP',
      });

      /* USD prices the platform's units, so it is not removable. */
      await expect(service.deleteCurrency(staff(), 'USD')).rejects.toMatchObject({
        response: { code: ERROR.GEO_CURRENCY_IN_USE },
      });
    });

    /**
     * SYP is refused for a REASON of its own, not because the counts happen to be non-zero.
     *
     * `ledger_entries.amount_syp` is denominated in it and the table is append-only, so it must
     * stay refused on a hypothetical day when nothing else points at it. A separate code, so the
     * console can say something true rather than «مستخدمة في 0 سجلاً».
     */
    it('refuses the accounting currency outright', async () => {
      await expect(service.deleteCurrency(staff(), 'SYP')).rejects.toMatchObject({
        response: { code: ERROR.GEO_CURRENCY_ACCOUNTING },
      });
    });

    it('refuses a code that is not there rather than reporting success', async () => {
      await expect(service.deleteCurrency(staff(), 'ZZZ')).rejects.toMatchObject({
        response: { code: ERROR.GEO_CURRENCY_UNKNOWN },
      });
      await expect(service.deleteCity(staff(), 'no-such-city')).rejects.toMatchObject({
        response: { code: ERROR.GEO_CITY_NOT_FOUND },
      });
    });
  });
});
