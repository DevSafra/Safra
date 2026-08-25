import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import { JobRunService } from '../common/jobs/job-run.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { MoneySettingsService } from '../settings/money-settings.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { SlaService } from './sla.service.js';
import { WalletService } from '../wallet/wallet.service.js';
import type { FxRateService } from '../fx/fx-rate.service.js';
import type { NotificationService } from '../notifications/notification.service.js';

/**
 * §6.4's two-hour window, and what happens to the customer when it lapses.
 *
 * ## Why this file exists
 *
 * `expireUnconfirmedBookings` is the busiest consequence in the platform — it cancels a paid
 * booking, fines the partner, counts the cancellation against their ranking and credits
 * compensation — and nothing drove it end to end. `payments.integration.test.ts` calls `sweep()`,
 * but for the OTHER pass, EC-001's unpaid expiry. So the §6.4 path was reachable only in
 * production.
 *
 * The final booking audit found what that hid: the sweep told the customer **nothing**. Their stay
 * vanished, money moved twice, and the first they could know was opening the app.
 *
 * ## The sweep is global, so every assertion names THIS booking
 *
 * `sweep()` expires every overdue booking on the platform, and the dev database has plenty. An
 * assertion on a total passes on a clean database and fails on a used one — the least useful kind
 * of test. Every check here is keyed to the fixture's own id.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('the confirmation window lapsing', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  /** Every notice the sweep asked to send, as (template, bookingId). */
  const sent: { template: string; bookingId: string | undefined }[] = [];

  const notifications = {
    notify: (
      template: string,
      _mail: unknown,
      _locale: string,
      subject?: { bookingId?: string },
    ) => {
      sent.push({ template, bookingId: subject?.bookingId });

      return Promise.resolve();
    },
  } as unknown as NotificationService;

  const fx = {
    rateToSyp: () => {
      throw new Error('FX must not be consulted for a same-currency movement.');
    },
  } as unknown as FxRateService;

  const sla = new SlaService(
    db,
    new MoneySettingsService(new SettingsService(db), fx),
    new LedgerService(db),
    new WalletService(db, fx),
    new JobRunService(db),
    notifications,
    { APP_URL: 'https://safra.test' } as never,
  );

  let bookingId = '';

  beforeEach(async () => {
    await harness.begin();
    sent.length = 0;
    ({ bookingId } = await seed());
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  it('cancels the booking, fines the partner and compensates the customer', async () => {
    await sla.sweep();

    const after = await db.execute<{ status: string; reason: string | null }>(sql`
      SELECT status::text AS status, cancellation_reason AS reason
      FROM bookings WHERE id = ${bookingId}
    `);

    expect(after.rows[0]?.status).toBe('cancelled');
    expect(after.rows[0]?.reason).toBe('system.partner_no_response');

    const violation = await db.execute<{ kind: string; fine: string }>(sql`
      SELECT kind::text AS kind, fine_amount::text AS fine
      FROM partner_violations WHERE booking_id = ${bookingId}
    `);

    expect(violation.rows[0]?.kind, '§6.4 records the no-response violation').toBe(
      'no_response',
    );

    const credited = await db.execute<{ reason: string }>(sql`
      SELECT reason::text AS reason FROM wallet_transactions
      WHERE booking_id = ${bookingId} AND direction = 'credit'
    `);

    expect(credited.rows.map((r) => r.reason)).toContain('sla_compensation');
  });

  /**
   * §6.4 and §10.3 — the customer is TOLD, and told once.
   *
   * The template key is asserted, not merely "a notice happened": `booking.cancelled_refund` is the
   * entry the console's catalogue already carried for this event, and a mail sent under a key the
   * console cannot name renders as raw snake_case in سجل واتساب والبريد — a defect this codebase
   * has shipped before.
   */
  it('tells the customer, under the key the console can name', async () => {
    await sla.sweep();

    const mine = sent.filter((notice) => notice.bookingId === bookingId);

    expect(mine, 'exactly one notice for this booking').toHaveLength(1);
    expect(mine[0]?.template).toBe('booking.cancelled_refund');
  });

  /**
   * A booking still inside its window is not touched.
   *
   * The control without which every assertion above would also hold for a sweep that cancelled
   * everything it could see — which is the one behaviour that would be catastrophic here.
   */
  it('leaves a booking whose window has not lapsed alone', async () => {
    await db.execute(sql`
      UPDATE bookings SET confirmation_deadline_at = now() + INTERVAL '1 hour'
      WHERE id = ${bookingId}
    `);

    await sla.sweep();

    const after = await db.execute<{ status: string }>(sql`
      SELECT status::text AS status FROM bookings WHERE id = ${bookingId}
    `);

    expect(after.rows[0]?.status).toBe('pending_confirmation');
    expect(sent.filter((notice) => notice.bookingId === bookingId)).toHaveLength(0);
  });

  /** A paid booking whose partner never answered, with its window already past. */
  async function seed(): Promise<{ bookingId: string }> {
    const made = await db.execute<{ id: string }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1) AS city_id,
               (SELECT id FROM currencies WHERE code = 'USD')           AS currency_id,
               (SELECT id FROM property_types LIMIT 1)                  AS type_id,
               (SELECT id FROM partner_types LIMIT 1)                   AS partner_type_id,
               (SELECT id FROM cancellation_policies LIMIT 1)           AS policy_id
      ), cu AS (
        INSERT INTO users (email, phone, role, status, preferred_locale)
        VALUES ('sla-c-' || gen_random_uuid() || '@safra.test', '+963900000081', 'customer',
                'active', 'ar')
        RETURNING id
      ), pu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('sla-p-' || gen_random_uuid() || '@safra.test', '+963900000082', 'partner', 'active')
        RETURNING id
      ), cp AS (
        INSERT INTO customer_profiles (user_id, full_name, email, phone, is_guest)
        SELECT cu.id, 'نزيل المهلة', 'sla-c-' || gen_random_uuid() || '@safra.test',
               '+963900000081', false
        FROM cu RETURNING id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT pu.id, ref.partner_type_id, 'SLA Test', 'شريك المهلة', ref.city_id, 'x',
               '+963900000082', 'sla-p-' || gen_random_uuid() || '@safra.test', 'approved'
        FROM pu, ref RETURNING id, city_id
      ), pr AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, address, status)
        SELECT pa.id, ref.city_id, ref.type_id, ref.policy_id,
               'sla-test-' || gen_random_uuid(), 'عقار المهلة', 'Sla', 'Sla', 'x', 'published'
        FROM pa, ref RETURNING id, partner_id
      ), un AS (
        INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price, currency_id)
        SELECT pr.id, 'وحدة', 'Unit', 'Einheit', 4, '100.00', ref.currency_id
        FROM pr, ref RETURNING id
      ), bk AS (
        INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                              check_in, check_out, guests_adults, guests_children, status,
                              paid_at, confirmation_deadline_at,
                              base_amount, customer_fee_value, customer_fee_amount,
                              partner_commission_rate, partner_commission_amount,
                              total_amount, partner_payable_amount, currency_id,
                              fx_rate_to_syp, total_syp, cancellation_policy_snapshot)
        SELECT cp.id, un.id, pr.id, pr.partner_id, ref.city_id,
               current_date + 1400, current_date + 1402, 2, 0,
               'pending_confirmation'::booking_status, now(), now() - INTERVAL '1 minute',
               '200.00', '18.00', '18.00', '0.0700', '14.00',
               '218.00', '186.00', ref.currency_id, '13000.00000000', '2834000.00',
               '{"code":"flex"}'::jsonb
        FROM cp, un, pr, ref RETURNING id
      )
      SELECT id FROM bk
    `);

    const row = made.rows[0];

    if (!row) throw new Error('Seed produced no row.');

    return { bookingId: row.id };
  }
});
