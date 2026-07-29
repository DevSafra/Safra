import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type Database } from '@safra/db';

import { CalendarService } from './calendar.service.js';
import type { AuditService } from '../common/audit/audit.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * Integration test against a REAL PostgreSQL.
 *
 * The behaviour under test lives in SQL — an ON CONFLICT upsert whose per-field
 * semantics cannot be exercised by a mock. It is skipped when DATABASE_URL is
 * unset so local `pnpm test` stays fast, and runs in CI where a database is
 * provisioned.
 *
 * Regression guard for a bug that shipped and was caught in manual testing: a
 * price-only calendar edit silently reset `closed` days back to `available`,
 * making unavailable units sellable. That is an overbooking, not a cosmetic
 * defect, so it gets a permanent test.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

// Valid hex only — 'l' is not a hex digit and Postgres rejects it as a uuid.
const PARTNER_ID = '99990000-0000-0000-0000-0000000000c1';
const PROPERTY_ID = '99990000-0000-0000-0000-0000000000c2';
const UNIT_ID = '99990000-0000-0000-0000-0000000000c3';
const USER_ID = '99990000-0000-0000-0000-0000000000c4';

const claims: AccessTokenClaims = {
  sub: USER_ID,
  role: 'partner',
  permissions: ['calendar.manage_own'],
  locale: 'ar',
  partnerId: PARTNER_ID,
};

describeIfDb('CalendarService.updateRange — field-level upsert semantics', () => {
  let db: Database;
  let service: CalendarService;

  beforeAll(async () => {
    db = createDatabase(DATABASE_URL as string, 2);

    // Audit writes are not what this test covers; a no-op keeps the fixture small.
    const audit = { record: () => Promise.resolve() } as unknown as AuditService;
    service = new CalendarService(db, audit);

    await seed(db);
  });

  afterAll(async () => {
    await teardown(db);
    await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
  });

  it('creates rows for a range and defaults new days to available', async () => {
    const result = await service.updateRange(claims, UNIT_ID, {
      from: '2030-01-10',
      to: '2030-01-12',
      price: 150,
    });

    expect(result.daysAffected).toBe(3);

    const { days } = await service.read(claims, UNIT_ID, {
      from: '2030-01-10',
      to: '2030-01-12',
    });

    // A price-only write must not fail on status NOT NULL, and must materialise
    // the only sensible default.
    expect(days.map((d) => d.status)).toEqual(['available', 'available', 'available']);
    expect(days.every((d) => d.isPriceOverridden)).toBe(true);
  });

  it('PRESERVES a closed status when only the price is edited', async () => {
    await service.updateRange(claims, UNIT_ID, {
      from: '2030-02-01',
      to: '2030-02-03',
      status: 'closed',
    });

    await service.updateRange(claims, UNIT_ID, {
      from: '2030-02-01',
      to: '2030-02-02',
      price: 200,
    });

    const { days } = await service.read(claims, UNIT_ID, {
      from: '2030-02-01',
      to: '2030-02-03',
    });

    // THE regression: these must still be closed. If any reads 'available', a
    // partner adjusting a price has silently put unavailable inventory on sale.
    expect(days.find((d) => d.date === '2030-02-01')?.status).toBe('closed');
    expect(days.find((d) => d.date === '2030-02-02')?.status).toBe('closed');
    expect(days.find((d) => d.date === '2030-02-03')?.status).toBe('closed');
    expect(days.find((d) => d.date === '2030-02-01')?.price).toBe('200.00');
  });

  it('preserves status when only minNights is edited', async () => {
    await service.updateRange(claims, UNIT_ID, {
      from: '2030-03-01',
      to: '2030-03-01',
      status: 'maintenance',
    });

    await service.updateRange(claims, UNIT_ID, {
      from: '2030-03-01',
      to: '2030-03-01',
      minNights: 4,
    });

    const { days } = await service.read(claims, UNIT_ID, {
      from: '2030-03-01',
      to: '2030-03-01',
    });

    expect(days[0]?.status).toBe('maintenance');
    expect(days[0]?.minNights).toBe(4);
  });

  it('applies an explicit status change', async () => {
    await service.updateRange(claims, UNIT_ID, {
      from: '2030-02-02',
      to: '2030-02-02',
      status: 'available',
    });

    const { days } = await service.read(claims, UNIT_ID, {
      from: '2030-02-01',
      to: '2030-02-03',
    });

    // Only the targeted day reopens; its neighbours stay closed.
    expect(days.find((d) => d.date === '2030-02-01')?.status).toBe('closed');
    expect(days.find((d) => d.date === '2030-02-02')?.status).toBe('available');
    expect(days.find((d) => d.date === '2030-02-03')?.status).toBe('closed');
  });

  it('clears a price override when null is passed explicitly', async () => {
    await service.updateRange(claims, UNIT_ID, {
      from: '2030-01-10',
      to: '2030-01-10',
      price: null,
    });

    const { days } = await service.read(claims, UNIT_ID, {
      from: '2030-01-10',
      to: '2030-01-10',
    });

    // Falls back to the unit's base price, and says so.
    expect(days[0]?.isPriceOverridden).toBe(false);
    expect(days[0]?.price).toBe('80.00');
  });

  it('refuses a unit belonging to another partner', async () => {
    const otherPartner: AccessTokenClaims = {
      ...claims,
      partnerId: '99990000-0000-0000-0000-0000000000cf',
    };

    await expect(
      service.updateRange(otherPartner, UNIT_ID, {
        from: '2030-01-10',
        to: '2030-01-10',
        status: 'closed',
      }),
    ).rejects.toThrow(/not found/i);
  });
});

async function seed(db: Database): Promise<void> {
  const { sql } = await import('drizzle-orm');

  // One statement per execute(): a parameterised query cannot carry multiple
  // commands, so these cannot be batched into a single template.
  await db.execute(sql`
    INSERT INTO users (id, email, role)
    VALUES (${claims.sub}::uuid, 'calendar-test@safra.test', 'partner')
    ON CONFLICT DO NOTHING`);

  await db.execute(sql`
    INSERT INTO partners (id, user_id, partner_type_id, legal_name, display_name, city_id,
                          address, phone, email)
    SELECT ${PARTNER_ID}::uuid, ${claims.sub}::uuid, pt.id, 'Cal Test', 'اختبار', c.id,
           'Addr', '+963900000000', 'calendar-test@safra.test'
    FROM partner_types pt, cities c
    WHERE pt.code = 'accommodation' AND c.slug = 'damascus'
    LIMIT 1
    ON CONFLICT DO NOTHING`);

  await db.execute(sql`
    INSERT INTO properties (id, partner_id, city_id, property_type_id, slug,
                            name_ar, name_en, name_de, address, cancellation_policy_id, status)
    SELECT ${PROPERTY_ID}::uuid, ${PARTNER_ID}::uuid, c.id, pt.id, 'calendar-test-property',
           'اختبار', 'Calendar Test', 'Test', 'Addr', cp.id, 'draft'
    FROM cities c, property_types pt, cancellation_policies cp
    WHERE c.slug = 'damascus' AND pt.code = 'apartment' AND cp.code = 'flex'
    LIMIT 1
    ON CONFLICT DO NOTHING`);

  await db.execute(sql`
    INSERT INTO units (id, property_id, name_ar, name_en, name_de, max_guests,
                       base_price, currency_id, min_nights)
    SELECT ${UNIT_ID}::uuid, ${PROPERTY_ID}::uuid, 'وحدة', 'Unit', 'Einheit', 2, 80, cu.id, 1
    FROM currencies cu WHERE cu.code = 'USD'
    LIMIT 1
    ON CONFLICT DO NOTHING`);
}

async function teardown(db: Database): Promise<void> {
  const { sql } = await import('drizzle-orm');

  // Hard deletes are acceptable ONLY here: these are synthetic test rows, never
  // production data. P-003 governs application code paths, not test cleanup.
  await db.execute(sql`DELETE FROM availability_days WHERE unit_id = ${UNIT_ID}::uuid`);
  await db.execute(sql`DELETE FROM units WHERE id = ${UNIT_ID}::uuid`);
  await db.execute(sql`DELETE FROM properties WHERE id = ${PROPERTY_ID}::uuid`);
  await db.execute(sql`DELETE FROM partners WHERE id = ${PARTNER_ID}::uuid`);
  await db.execute(sql`DELETE FROM users WHERE id = ${claims.sub}::uuid`);
}
