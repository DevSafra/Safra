import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { ERROR } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { GeoWriteService } from './geo-write.service.js';
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
  const service = new GeoWriteService(db, new AuditService(db));

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

  it('adds a currency, and says so in the audit log', async () => {
    const code = `Q${suffix}`;

    await expect(
      service.createCurrency(staff(), {
        code,
        nameAr: 'عملة اختبار',
        nameEn: 'Test',
        nameDe: 'Test',
        symbol: '¤',
        decimals: 2,
      }),
    ).resolves.toEqual({ code });

    const row = await db.execute<{ symbol: string; is_active: boolean }>(sql`
      SELECT symbol, is_active FROM currencies WHERE code = ${code}
    `);

    expect(row.rows[0]).toMatchObject({ symbol: '¤', is_active: true });

    const logged = await auditRow('currency.created');

    expect(logged?.actor).toBe(staffId);
    /* The CODE, not the row id — an operator reading سجل التدقيق must not have to look it up. */
    expect(JSON.stringify(logged?.after)).toContain(code);
  });

  it('refuses a currency code that already exists', async () => {
    await expect(
      service.createCurrency(staff(), {
        code: 'USD',
        nameAr: 'مكرر',
        nameEn: 'Dup',
        nameDe: 'Dup',
        symbol: '$',
        decimals: 2,
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
});
