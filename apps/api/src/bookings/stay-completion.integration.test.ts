import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import { JobRunService } from '../common/jobs/job-run.service.js';
import { StayCompletionService } from './stay-completion.service.js';

/**
 * Ending stays whose departure has passed — the gap that stopped every payout.
 *
 * ## What this is really protecting
 *
 * `checked_in → completed` had no writer at all before 2026-08-25, and `completed` is the
 * predicate `PayoutService` accrues over and `ReviewService` requires. So the assertion that
 * matters is not "the sweep runs" — it is that **a departed stay becomes payable**, and that a
 * stay still in progress does NOT. A sweep that completed everything would satisfy the first
 * perfectly and start paying partners for guests who are still in the room.
 *
 * ## Dates are the whole test, so they are set explicitly
 *
 * Every fixture states its own check-out relative to the property's own timezone. A test that
 * seeded "a booking" and hoped would be asserting whatever the seed happened to choose.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('ending a stay that has departed', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  const stays = new StayCompletionService(db, new JobRunService(db));

  let departed = '';
  let staying = '';
  let notArrived = '';

  beforeEach(async () => {
    await harness.begin();
    await seed();
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  const statusOf = async (reference: string): Promise<string> => {
    const rows = await db.execute<{ status: string }>(sql`
      SELECT status::text AS status FROM bookings WHERE reference = ${reference}
    `);

    return rows.rows[0]?.status ?? '';
  };

  it('completes a checked-in stay whose departure has passed', async () => {
    await stays.sweep();

    expect(await statusOf(departed)).toBe('completed');
  });

  /** The control. Without it, "completes departed stays" passes for a sweep that completes all. */
  it('leaves a stay that is still running alone', async () => {
    await stays.sweep();

    expect(await statusOf(staying)).toBe('checked_in');
  });

  /**
   * And the one that must NOT be completed however old it is.
   *
   * A `confirmed` booking whose dates have passed is a stay nobody recorded an arrival for — the
   * guest may never have turned up. Completing it would pay the partner on no evidence at all.
   * `confirmed → completed` is not in the transition table and this sweep must not invent it;
   * the operational gap that leaves is recorded as `O-book-2`.
   */
  it('never completes a booking nobody checked in, however long ago it ended', async () => {
    await stays.sweep();

    expect(await statusOf(notArrived)).toBe('confirmed');
  });

  it('stamps completed_at and writes the timeline event', async () => {
    await stays.sweep();

    const rows = await db.execute<{ completed_at: string | null; events: number }>(sql`
      SELECT b.completed_at::text AS completed_at,
             (SELECT count(*)::int FROM timeline_events t
               WHERE t.subject_id = b.id AND t.event_type = 'booking.completed') AS events
      FROM bookings b WHERE b.reference = ${departed}
    `);

    expect(rows.rows[0]?.completed_at, 'the stamp is what payouts read').toBeTruthy();
    expect(rows.rows[0]?.events, 'the timeline says the stay ended').toBe(1);
  });

  /** Running twice must not double-complete or double-record — the sweep is meant to be re-run. */
  it('is safe to run again', async () => {
    await stays.sweep();
    await stays.sweep();

    const rows = await db.execute<{ events: number }>(sql`
      SELECT (SELECT count(*)::int FROM timeline_events t
               WHERE t.subject_id = b.id AND t.event_type = 'booking.completed') AS events
      FROM bookings b WHERE b.reference = ${departed}
    `);

    expect(rows.rows[0]?.events, 'one event, not two').toBe(1);
    expect(await statusOf(departed)).toBe('completed');
  });

  /** It records a run, so an absence is visible to `safra_job_last_success_age_seconds`. */
  it('records the run', async () => {
    await stays.sweep();

    const rows = await db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM scheduled_job_runs WHERE job = 'stay-completion'
    `);

    expect(rows.rows[0]?.n, 'a job that stops firing must be queryable').toBeGreaterThan(
      0,
    );
  });

  /** Three bookings on one property: departed, still staying, and never arrived. */
  async function seed(): Promise<void> {
    const made = await db.execute<{
      departed: string;
      staying: string;
      not_arrived: string;
    }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1) AS city_id,
               (SELECT id FROM currencies WHERE code = 'USD')           AS currency_id,
               (SELECT id FROM property_types LIMIT 1)                  AS type_id,
               (SELECT id FROM partner_types LIMIT 1)                   AS partner_type_id,
               (SELECT id FROM cancellation_policies LIMIT 1)           AS policy_id
      ), cu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('stay-c-' || gen_random_uuid() || '@safra.test', '+963900000097', 'customer', 'active')
        RETURNING id
      ), pu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('stay-p-' || gen_random_uuid() || '@safra.test', '+963900000098', 'partner', 'active')
        RETURNING id
      ), cp AS (
        INSERT INTO customer_profiles (user_id, full_name, email, phone, is_guest)
        SELECT cu.id, 'نزيل', 'stay-c-' || gen_random_uuid() || '@safra.test',
               '+963900000097', false
        FROM cu RETURNING id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT pu.id, ref.partner_type_id, 'Stay Test', 'إقامة', ref.city_id, 'x',
               '+963900000098', 'stay-p-' || gen_random_uuid() || '@safra.test', 'approved'
        FROM pu, ref RETURNING id, city_id
      ), pr AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, address, status)
        SELECT pa.id, ref.city_id, ref.type_id, ref.policy_id,
               'stay-test-' || gen_random_uuid(), 'عقار الإقامة', 'Stay', 'Stay', 'x', 'published'
        FROM pa, ref RETURNING id, partner_id
      ), u1 AS (
        INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price, currency_id)
        SELECT pr.id, 'وحدة ١', 'Unit 1', 'Einheit 1', 2, '100.00', ref.currency_id FROM pr, ref
        RETURNING id
      ), u2 AS (
        INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price, currency_id)
        SELECT pr.id, 'وحدة ٢', 'Unit 2', 'Einheit 2', 2, '100.00', ref.currency_id FROM pr, ref
        RETURNING id
      ), u3 AS (
        INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price, currency_id)
        SELECT pr.id, 'وحدة ٣', 'Unit 3', 'Einheit 3', 2, '100.00', ref.currency_id FROM pr, ref
        RETURNING id
      ), gone AS (
        INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                              check_in, check_out, guests_adults, status, paid_at, checked_in_at,
                              base_amount, customer_fee_value, customer_fee_amount,
                              partner_commission_rate, partner_commission_amount,
                              total_amount, partner_payable_amount, currency_id,
                              fx_rate_to_syp, total_syp, cancellation_policy_snapshot)
        SELECT cp.id, u1.id, pr.id, pr.partner_id, ref.city_id,
               current_date - 5, current_date - 2, 2, 'checked_in'::booking_status,
               now() - INTERVAL '6 days', now() - INTERVAL '5 days',
               '200.00', '1.99', '1.99', '0.0700', '14.00', '201.99', '186.00',
               ref.currency_id, '13000.00000000', '2625870.00', '{"code":"flex"}'::jsonb
        FROM cp, u1, pr, ref RETURNING reference
      ), here AS (
        INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                              check_in, check_out, guests_adults, status, paid_at, checked_in_at,
                              base_amount, customer_fee_value, customer_fee_amount,
                              partner_commission_rate, partner_commission_amount,
                              total_amount, partner_payable_amount, currency_id,
                              fx_rate_to_syp, total_syp, cancellation_policy_snapshot)
        SELECT cp.id, u2.id, pr.id, pr.partner_id, ref.city_id,
               current_date - 1, current_date + 3, 2, 'checked_in'::booking_status,
               now() - INTERVAL '2 days', now() - INTERVAL '1 day',
               '200.00', '1.99', '1.99', '0.0700', '14.00', '201.99', '186.00',
               ref.currency_id, '13000.00000000', '2625870.00', '{"code":"flex"}'::jsonb
        FROM cp, u2, pr, ref RETURNING reference
      ), absent AS (
        INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                              check_in, check_out, guests_adults, status, paid_at,
                              base_amount, customer_fee_value, customer_fee_amount,
                              partner_commission_rate, partner_commission_amount,
                              total_amount, partner_payable_amount, currency_id,
                              fx_rate_to_syp, total_syp, cancellation_policy_snapshot)
        SELECT cp.id, u3.id, pr.id, pr.partner_id, ref.city_id,
               current_date - 30, current_date - 27, 2, 'confirmed'::booking_status,
               now() - INTERVAL '31 days',
               '200.00', '1.99', '1.99', '0.0700', '14.00', '201.99', '186.00',
               ref.currency_id, '13000.00000000', '2625870.00', '{"code":"flex"}'::jsonb
        FROM cp, u3, pr, ref RETURNING reference
      )
      SELECT gone.reference AS departed, here.reference AS staying,
             absent.reference AS not_arrived
      FROM gone, here, absent
    `);

    const row = made.rows[0];

    if (!row) throw new Error('Seed produced no row.');

    departed = row.departed;
    staying = row.staying;
    notArrived = row.not_arrived;
  }
});
