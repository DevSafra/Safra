import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import { BookingListService } from './booking-list.service.js';
import { DashboardService } from './dashboard.service.js';

/**
 * EC-004 and EC-011 — the two administrative alerts §16 asks for, and the one thing that must hold.
 *
 * ## The counter and the list are the same predicate or they are worthless
 *
 * The dashboard says «٩ لم يُسجَّل وصولهم» and links to a filtered registry. If those two are
 * written separately they drift, and the operator meets nine on one screen and six on the next —
 * at which point they stop trusting both. This suite asserts the count EQUALS the rows, over
 * fixtures built to sit on either side of the boundary.
 *
 * `SLA_EXPIRY_WARNING_MINUTES` has this guarantee already; `ARRIVAL_ALERT_HOURS` is the new one.
 *
 * ## Why EC-004's fixture has to be written by hand
 *
 * `partnerDecision` writes `partner_responded_at` and the status in ONE transaction, so no code
 * path can produce the state EC-004 describes. That is why the counter is an INVARIANT rather than
 * a queue — and why the only way to test that it would be seen is to create the broken row
 * directly, which is exactly what a real defect would do.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('the two booking alerts §16 asks for', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  const bookings = new BookingListService(db);
  const dashboard = new DashboardService(db);

  let overdue = '';
  let arrivedToday = '';
  let stuck = '';

  beforeEach(async () => {
    await harness.begin();
    await seed();
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  const listed = async (attention: 'no_check_in' | 'unconfirmed'): Promise<string[]> => {
    const page = await bookings.list({ page: 1, limit: 100, attention });

    return page.items.map((item) => item.reference);
  };

  /**
   * The registry's TOTAL for a filter, which is what the dashboard number has to equal.
   *
   * Not the page length — that is bounded by the page size, and comparing a counter against it
   * asserts that the database holds fewer than a hundred matching rows rather than that the two
   * predicates agree. The seed alone has 429.
   */
  const totalFor = async (attention: 'no_check_in' | 'unconfirmed'): Promise<number> =>
    (await bookings.list({ page: 1, limit: 1, attention })).total;

  describe('EC-011 — an arrival nobody recorded', () => {
    it('lists a confirmed stay whose arrival passed more than a day ago', async () => {
      expect(await listed('no_check_in')).toContain(overdue);
    });

    /**
     * The control, and the reason the window is 24 hours rather than zero.
     *
     * A guest arriving in the evening may not be recorded until the next morning. Alerting on
     * today's arrivals would fire on the ordinary case, which is how an alert gets ignored.
     */
    it('leaves an arrival from today alone', async () => {
      expect(await listed('no_check_in')).not.toContain(arrivedToday);
    });

    /** The whole point of the pair: the number on the dashboard is the number of rows. */
    it('counts exactly what it lists', async () => {
      const counters = await dashboard.overview();

      expect(counters.counters.arrivals_not_checked_in).toBe(
        await totalFor('no_check_in'),
      );
    });

    /** And moves together: recording the arrival takes it off both, in one step. */
    it('drops off both the counter and the list once the arrival is recorded', async () => {
      const before = await totalFor('no_check_in');

      await db.execute(sql`
        UPDATE bookings SET status = 'checked_in', checked_in_at = now()
        WHERE reference = ${overdue}
      `);

      expect(await totalFor('no_check_in')).toBe(before - 1);
      expect((await dashboard.overview()).counters.arrivals_not_checked_in).toBe(
        before - 1,
      );
    });
  });

  describe('EC-004 — answered by the partner and never moved', () => {
    it('is zero for a healthy database, which is the expected state', async () => {
      await db.execute(sql`
        UPDATE bookings SET partner_responded_at = NULL WHERE reference = ${stuck}
      `);

      const counters = await dashboard.overview();

      expect(counters.counters.confirmed_not_recorded).toBe(0);
      expect(await listed('unconfirmed')).toHaveLength(0);
    });

    /**
     * And a broken row IS seen — the assertion above is worthless without this one.
     *
     * A counter that returned zero unconditionally would satisfy "is zero for a healthy database"
     * perfectly, and the defect it exists to surface would stay invisible for ever.
     */
    it('surfaces a booking answered by the partner that never moved', async () => {
      expect(await listed('unconfirmed')).toContain(stuck);
      expect((await dashboard.overview()).counters.confirmed_not_recorded).toBe(
        await totalFor('unconfirmed'),
      );
    });
  });

  /** Three bookings: one overdue arrival, one arriving today, one answered but stuck. */
  async function seed(): Promise<void> {
    const made = await db.execute<{ overdue: string; today: string; stuck: string }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1) AS city_id,
               (SELECT id FROM currencies WHERE code = 'USD')           AS currency_id,
               (SELECT id FROM property_types LIMIT 1)                  AS type_id,
               (SELECT id FROM partner_types LIMIT 1)                   AS partner_type_id,
               (SELECT id FROM cancellation_policies LIMIT 1)           AS policy_id
      ), cu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('att-c-' || gen_random_uuid() || '@safra.test', '+963900000071', 'customer', 'active')
        RETURNING id
      ), pu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('att-p-' || gen_random_uuid() || '@safra.test', '+963900000072', 'partner', 'active')
        RETURNING id
      ), cp AS (
        INSERT INTO customer_profiles (user_id, full_name, email, phone, is_guest)
        SELECT cu.id, 'نزيل التنبيه', 'att-c-' || gen_random_uuid() || '@safra.test',
               '+963900000071', false
        FROM cu RETURNING id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT pu.id, ref.partner_type_id, 'Attention Test', 'تنبيه', ref.city_id, 'x',
               '+963900000072', 'att-p-' || gen_random_uuid() || '@safra.test', 'approved'
        FROM pu, ref RETURNING id, city_id
      ), pr AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, address, status)
        SELECT pa.id, ref.city_id, ref.type_id, ref.policy_id,
               'attention-test-' || gen_random_uuid(), 'عقار التنبيه', 'Attn', 'Attn', 'x',
               'published'
        FROM pa, ref RETURNING id, partner_id
      ), u1 AS (
        INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price, currency_id)
        SELECT pr.id, 'و١', 'U1', 'E1', 2, '100.00', ref.currency_id FROM pr, ref RETURNING id
      ), u2 AS (
        INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price, currency_id)
        SELECT pr.id, 'و٢', 'U2', 'E2', 2, '100.00', ref.currency_id FROM pr, ref RETURNING id
      ), u3 AS (
        INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price, currency_id)
        SELECT pr.id, 'و٣', 'U3', 'E3', 2, '100.00', ref.currency_id FROM pr, ref RETURNING id
      ), late AS (
        INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                              check_in, check_out, guests_adults, status, paid_at, confirmed_at,
                              base_amount, customer_fee_value, customer_fee_amount,
                              partner_commission_rate, partner_commission_amount,
                              total_amount, partner_payable_amount, currency_id,
                              fx_rate_to_syp, total_syp, cancellation_policy_snapshot)
        SELECT cp.id, u1.id, pr.id, pr.partner_id, ref.city_id,
               current_date - 4, current_date - 1, 2, 'confirmed'::booking_status,
               now() - INTERVAL '6 days', now() - INTERVAL '6 days',
               '200.00', '1.99', '1.99', '0.0700', '14.00', '201.99', '186.00',
               ref.currency_id, '13000.00000000', '2625870.00', '{"code":"flex"}'::jsonb
        FROM cp, u1, pr, ref RETURNING reference
      ), fresh AS (
        INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                              check_in, check_out, guests_adults, status, paid_at, confirmed_at,
                              base_amount, customer_fee_value, customer_fee_amount,
                              partner_commission_rate, partner_commission_amount,
                              total_amount, partner_payable_amount, currency_id,
                              fx_rate_to_syp, total_syp, cancellation_policy_snapshot)
        SELECT cp.id, u2.id, pr.id, pr.partner_id, ref.city_id,
               current_date, current_date + 3, 2, 'confirmed'::booking_status,
               now() - INTERVAL '2 days', now() - INTERVAL '2 days',
               '200.00', '1.99', '1.99', '0.0700', '14.00', '201.99', '186.00',
               ref.currency_id, '13000.00000000', '2625870.00', '{"code":"flex"}'::jsonb
        FROM cp, u2, pr, ref RETURNING reference
      ), broken AS (
        INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                              check_in, check_out, guests_adults, status, paid_at,
                              partner_responded_at, confirmation_deadline_at,
                              base_amount, customer_fee_value, customer_fee_amount,
                              partner_commission_rate, partner_commission_amount,
                              total_amount, partner_payable_amount, currency_id,
                              fx_rate_to_syp, total_syp, cancellation_policy_snapshot)
        SELECT cp.id, u3.id, pr.id, pr.partner_id, ref.city_id,
               current_date + 700, current_date + 703, 2,
               'pending_confirmation'::booking_status, now(), now(), now() + INTERVAL '2 hours',
               '200.00', '1.99', '1.99', '0.0700', '14.00', '201.99', '186.00',
               ref.currency_id, '13000.00000000', '2625870.00', '{"code":"flex"}'::jsonb
        FROM cp, u3, pr, ref RETURNING reference
      )
      SELECT late.reference AS overdue, fresh.reference AS today, broken.reference AS stuck
      FROM late, fresh, broken
    `);

    const row = made.rows[0];

    if (!row) throw new Error('Seed produced no row.');

    overdue = row.overdue;
    arrivedToday = row.today;
    stuck = row.stuck;
  }
});
