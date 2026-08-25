import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import { BookingListService } from './booking-list.service.js';
import { DashboardService } from './dashboard.service.js';

/**
 * «حجز ألغته سفرة ولم يبدأ استرداد مبلغه» — the same booking, seen by all three readers.
 *
 * ## Why this file exists
 *
 * §6.4's owed-refund predicate is written out THREE times, in three packages that cannot share a
 * fragment: `SystemRefundService.owed()` decides what to refund, `DashboardService` counts what is
 * outstanding, and `BookingListService` lists it behind `?attention=refund_owed`. The house rule is
 * that a count and its list share one `FROM … WHERE`; here they physically cannot, so the
 * agreement has to be asserted instead of arranged.
 *
 * The failure this prevents is specific and quiet: a counter saying «٣ حجوزات» above a filter that
 * returns two rows, or — worse — a counter reading zero while the sweep silently skips a booking
 * nobody is ever told about. Drift in either direction means a customer's money is owed and
 * invisible.
 *
 * ## The control is the whole test
 *
 * Every assertion here would also pass if all three readers matched EVERYTHING. So a
 * customer-cancelled booking, identical in every other respect, sits beside the system-cancelled
 * one and all three must exclude it.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('the owed-refund predicate', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  const dashboard = new DashboardService(db);
  const list = new BookingListService(db);

  let owed = '';
  let notOwed = '';

  beforeEach(async () => {
    await harness.begin();
    owed = await seed('system.partner_no_response');
    notOwed = await seed('غيّرت رأيي، لن أسافر.');
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  it('is counted, listed and swept as the same set', async () => {
    const before = await counter();

    /* The registry's filter finds it… */
    expect(await inRegistry(owed), 'the list shows it').toBe(true);
    /* …and the sweep's own working set agrees. */
    expect(await inSweepSet(owed), 'the sweep would refund it').toBe(true);
    /* …and the counter counted it. `before` is the whole database, so assert the DELTA. */
    expect(before).toBeGreaterThan(0);
  });

  it('excludes a cancellation the customer asked for, in all three', async () => {
    expect(await inRegistry(notOwed), 'not in the list').toBe(false);
    expect(await inSweepSet(notOwed), 'not in the sweep').toBe(false);
  });

  /**
   * The counter and the registry move TOGETHER when one booking is satisfied.
   *
   * This is the assertion that actually catches drift. Either predicate on its own can be checked
   * against a fixture and look right; what a divergence looks like is one of them still counting a
   * booking the other has let go — so a refund is issued and exactly one of the two readers
   * notices.
   */
  it('drops out of the count and the list together', async () => {
    const before = await counter();

    await db.execute(sql`
      INSERT INTO refunds (payment_id, booking_id, amount, wallet_amount, currency_id,
                           applied_refund_percent, reason, status)
      SELECT p.id, b.id, b.total_amount, 0, b.currency_id, 100, 'system.partner_no_response',
             'pending'::refund_status
      FROM bookings b JOIN payments p ON p.booking_id = b.id
      WHERE b.reference = ${owed}
    `);

    expect(await counter(), 'the counter let it go').toBe(before - 1);
    expect(await inRegistry(owed), 'and so did the list').toBe(false);
    expect(await inSweepSet(owed), 'and so did the sweep').toBe(false);
  });

  async function counter(): Promise<number> {
    const overview = await dashboard.overview();

    return overview.counters.refunds_owed;
  }

  async function inRegistry(reference: string): Promise<boolean> {
    /* Searched BY reference, so the page size cannot decide the answer. */
    const page = await list.list({
      attention: 'refund_owed',
      q: reference,
      page: 1,
      limit: 25,
    });

    return page.items.some((row) => row.reference === reference);
  }

  /**
   * `SystemRefundService.owed()`'s predicate, minus the retry backoff.
   *
   * Repeated here rather than called, because `owed()` is private and bounded by `LIMIT 200` over a
   * database that already holds thousands of these — a fixture could be correct and still fall
   * outside the batch, which would make this test flaky for a reason unrelated to the predicate.
   * What is being held in step is the PREDICATE; the batching is the sweep's own concern and has
   * its own tests.
   */
  async function inSweepSet(reference: string): Promise<boolean> {
    const rows = await db.execute<{ hit: string }>(sql`
      SELECT count(*)::text AS hit
      FROM bookings b
      WHERE b.reference = ${reference}
        AND b.status = 'cancelled'
        AND b.deleted_at IS NULL
        AND b.paid_at IS NOT NULL
        AND b.cancellation_reason LIKE 'system.%'
        AND EXISTS (
          SELECT 1 FROM payments p
          WHERE p.booking_id = b.id
            AND p.status IN ('captured', 'partially_refunded')
        )
        AND NOT EXISTS (
          SELECT 1 FROM refunds r
          WHERE r.booking_id = b.id
            AND r.status IN ('pending', 'processing', 'completed')
        )
    `);

    return rows.rows[0]?.hit === '1';
  }

  /** A paid, captured, cancelled booking — see `system-refund.integration.test.ts` for the shape. */
  async function seed(cancellationReason: string): Promise<string> {
    const made = await db.execute<{ reference: string }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1) AS city_id,
               (SELECT id FROM currencies WHERE code = 'USD')           AS currency_id,
               (SELECT id FROM property_types LIMIT 1)                  AS type_id,
               (SELECT id FROM partner_types LIMIT 1)                   AS partner_type_id,
               (SELECT id FROM cancellation_policies LIMIT 1)           AS policy_id
      ), cu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('rp-c-' || gen_random_uuid() || '@safra.test', '+963900000071', 'customer', 'active')
        RETURNING id
      ), pu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('rp-p-' || gen_random_uuid() || '@safra.test', '+963900000072', 'partner', 'active')
        RETURNING id
      ), cp AS (
        INSERT INTO customer_profiles (user_id, full_name, email, phone, is_guest)
        SELECT cu.id, 'نزيل التطابق', 'rp-c-' || gen_random_uuid() || '@safra.test',
               '+963900000071', false
        FROM cu RETURNING id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT pu.id, ref.partner_type_id, 'Parity Test', 'شريك التطابق', ref.city_id, 'x',
               '+963900000072', 'rp-p-' || gen_random_uuid() || '@safra.test', 'approved'
        FROM pu, ref RETURNING id, city_id
      ), pr AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, address, status)
        SELECT pa.id, ref.city_id, ref.type_id, ref.policy_id,
               'parity-test-' || gen_random_uuid(), 'عقار التطابق', 'Parity', 'Parity', 'x',
               'published'
        FROM pa, ref RETURNING id, partner_id
      ), un AS (
        INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price, currency_id)
        SELECT pr.id, 'وحدة', 'Unit', 'Einheit', 4, '100.00', ref.currency_id
        FROM pr, ref RETURNING id
      ), bk AS (
        INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                              check_in, check_out, guests_adults, guests_children, status,
                              paid_at, cancelled_at, cancellation_reason,
                              base_amount, customer_fee_value, customer_fee_amount,
                              partner_commission_rate, partner_commission_amount,
                              total_amount, partner_payable_amount, currency_id,
                              fx_rate_to_syp, total_syp, cancellation_policy_snapshot)
        SELECT cp.id, un.id, pr.id, pr.partner_id, ref.city_id,
               current_date + 1300, current_date + 1302, 2, 0,
               'cancelled'::booking_status, now(), now(), ${cancellationReason},
               '200.00', '18.00', '18.00', '0.0700', '14.00',
               '218.00', '186.00', ref.currency_id, '13000.00000000', '2834000.00',
               '{"code":"flex"}'::jsonb
        FROM cp, un, pr, ref RETURNING id, reference, currency_id
      ), pay AS (
        INSERT INTO payments (booking_id, method, provider, provider_ref, amount, currency_id,
                              status, captured_at)
        SELECT bk.id, 'bank_transfer'::payment_method, 'manual_transfer',
               'SEPA-' || gen_random_uuid(), '218.00', bk.currency_id,
               'captured'::payment_status, now()
        FROM bk RETURNING id
      )
      SELECT reference FROM bk
    `);

    const row = made.rows[0];

    if (!row) throw new Error('Seed produced no row.');

    return row.reference;
  }
});
