import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { createRollbackDatabase, type Database } from '@safra/db';
import { SLA_EXPIRY_WARNING_MINUTES, type BookingAttention } from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { BookingExportService } from './booking-export.service.js';
import { BookingListService } from './booking-list.service.js';

/**
 * «تصدير CSV» builds the set الحجوزات is showing (go-live audit, 2026-10-06).
 *
 * The export wrote its own copy of the registry's predicate with `status` and `q` in it and nothing
 * else, so pressed on an alert view, «مهلة التأكيد توشك على الانتهاء» or «لم يُسجَّل وصولهم», it
 * produced every booking in scope. The assertion is AGREEMENT, file against list, per filter, on
 * fixtures placed either side of each predicate: a test that wrote the predicate a third time would
 * prove only that it agrees with itself.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('the booking export honours every registry filter', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  const list = new BookingListService(db);
  const exports = new BookingExportService(db, new AuditService(db));

  /** A tag unique to this run, carried in the fixture property's name so `q` isolates the fixtures. */
  let tag = '';
  let fixtures: { soon: string; responded: string; arrived: string } = {
    soon: '',
    responded: '',
    arrived: '',
  };

  beforeEach(async () => {
    await harness.begin();
    await seed();
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  const listed = async (filters: {
    expiring?: boolean;
    attention?: BookingAttention;
  }): Promise<string[]> =>
    (await list.list({ page: 1, limit: 100, q: tag, ...filters })).items
      .map((row) => row.reference)
      .sort();

  const exported = async (filters: {
    expiring?: boolean;
    attention?: BookingAttention;
  }): Promise<string[]> => {
    const built = await exports.toCsv(undefined, { q: tag, ...filters, audit: false });

    return built.csv
      .split('\n')
      .slice(1)
      .map((line) => line.split(',')[0] ?? '')
      .filter((reference) => reference.startsWith('BKG-'))
      .sort();
  };

  it.each([
    ['expiring', { expiring: true }, 'soon'],
    ['attention=unconfirmed', { attention: 'unconfirmed' }, 'responded'],
    ['attention=no_check_in', { attention: 'no_check_in' }, 'arrived'],
  ] as const)(
    'exports exactly what the list shows under %s',
    async (_name, filters, only) => {
      const file = await exported(filters);

      expect(file).toStrictEqual(await listed(filters));
      /* And the list is the narrowed one, or agreement would be two copies of "everything". */
      expect(file).toStrictEqual([fixtures[only]]);
    },
  );

  it('exports all three when no alert filter is set', async () => {
    expect(await exported({})).toStrictEqual(
      [fixtures.soon, fixtures.responded, fixtures.arrived].sort(),
    );
  });

  /** Three bookings, each inside exactly one alert's predicate. */
  async function seed(): Promise<void> {
    tag = `exp-${Math.random().toString(36).slice(2, 10)}`;

    const made = await db.execute<{
      soon: string;
      responded: string;
      arrived: string;
    }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1) AS city_id,
               (SELECT id FROM currencies WHERE code = 'USD')           AS currency_id,
               (SELECT id FROM property_types LIMIT 1)                  AS type_id,
               (SELECT id FROM partner_types LIMIT 1)                   AS partner_type_id,
               (SELECT id FROM cancellation_policies LIMIT 1)            AS policy_id
      ), cu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('exp-' || gen_random_uuid() || '@safra.test', '+963900000092', 'customer', 'active')
        RETURNING id
      ), pu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('exp-p-' || gen_random_uuid() || '@safra.test', '+963900000093', 'partner', 'active')
        RETURNING id
      ), cp AS (
        INSERT INTO customer_profiles (user_id, full_name, email, phone, is_guest)
        SELECT cu.id, 'تصدير', 'exp-' || gen_random_uuid() || '@safra.test', '+963900000092', false
        FROM cu RETURNING id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT pu.id, ref.partner_type_id, 'Export Test', 'تصدير', ref.city_id, 'x',
               '+963900000093', 'exp-p-' || gen_random_uuid() || '@safra.test', 'approved'
        FROM pu, ref RETURNING id
      ), pr AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, address, status)
        SELECT pa.id, ref.city_id, ref.type_id, ref.policy_id,
               'exp-test-' || gen_random_uuid(), ${tag}, 'EXP', 'EXP', 'x', 'published'
        FROM pa, ref RETURNING id, partner_id
      ), un AS (
        INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price,
                           currency_id)
        SELECT pr.id, 'وحدة', 'Unit', 'Einheit', 2, '100.00', ref.currency_id
        FROM pr, ref RETURNING id
      ), rows AS (
        INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                              check_in, check_out, guests_adults, status, paid_at,
                              confirmation_deadline_at, partner_responded_at,
                              base_amount, customer_fee_value, customer_fee_amount,
                              partner_commission_rate, partner_commission_amount,
                              total_amount, partner_payable_amount, currency_id,
                              fx_rate_to_syp, total_syp, cancellation_policy_snapshot)
        SELECT cp.id, un.id, pr.id, pr.partner_id, ref.city_id,
               v.check_in, v.check_in + 2, 2, v.status::booking_status, now(),
               v.deadline, v.responded,
               '200.00', '1.99', '1.99', '0.0700', '14.00', '201.99', '186.00',
               ref.currency_id, '13000.00000000', '2625870.00', '{"code":"flex"}'::jsonb
        FROM cp, un, pr, ref,
             (VALUES
               (1, current_date + 100, 'pending_confirmation',
                now() + (${SLA_EXPIRY_WARNING_MINUTES - 5}::int * INTERVAL '1 minute'),
                NULL::timestamptz),
               (2, current_date + 110, 'pending_confirmation',
                now() + INTERVAL '2 days', now()),
               (3, current_date - 3, 'confirmed', NULL::timestamptz, NULL::timestamptz)
             ) AS v(n, check_in, status, deadline, responded)
        ORDER BY v.n
        RETURNING reference, status, partner_responded_at
      )
      SELECT
        (SELECT reference FROM rows
          WHERE status = 'pending_confirmation' AND partner_responded_at IS NULL) AS soon,
        (SELECT reference FROM rows
          WHERE status = 'pending_confirmation' AND partner_responded_at IS NOT NULL) AS responded,
        (SELECT reference FROM rows WHERE status = 'confirmed') AS arrived
    `);

    const row = made.rows[0];

    if (!row) throw new Error('fixture insert returned nothing');

    fixtures = row;
  }
});
