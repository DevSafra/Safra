import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { BookingDetailService } from './booking-detail.service.js';
import { canTransition } from '../bookings/booking-state.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * Which staff actions a booking OFFERS, per status (§9.4).
 *
 * ## What this is protecting
 *
 * The console decides whether to draw «إلغاء الحجز» from this field. If it says yes where
 * `assertTransition` says no, an operator presses a button and meets a refusal for a move that was
 * never available — and the console has no way to know, because the transition table lives in the
 * API. So the guarantee worth holding is not "cancel is true for confirmed", it is **the field
 * agrees with the function that enforces it, for every status there is**.
 *
 * That is why the expectation is computed from `canTransition` rather than written out as a list.
 * A hand-written list here would be a third copy of the state machine, and the first time somebody
 * added a transition the test would keep passing while the screen went wrong.
 *
 * The one thing stated INDEPENDENTLY is `pending_payment`: staff are not an actor on that edge —
 * the customer or the sweep cancels an unpaid booking — and it is the status where offering the
 * control would be most tempting and most wrong.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const READER = {
  sub: null,
  role: 'operations_manager',
  permissions: ['booking.read_all'],
} as unknown as AccessTokenClaims;

/** Every status a fixture can be put into without tripping the inventory exclusion constraint. */
const STATUSES = [
  'pending_payment',
  'pending_confirmation',
  'confirmed',
  'checked_in',
  'completed',
  'cancelled',
  'disputed',
] as const;

describeIfDb('the actions a booking offers staff', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  const bookings = new BookingDetailService(db, new AuditService(db));

  let reference = '';

  beforeEach(async () => {
    await harness.begin();
    await seed();
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  it.each(STATUSES)('agrees with the transition table from %s', async (status) => {
    await db.execute(sql`
      UPDATE bookings SET status = ${status}::booking_status WHERE reference = ${reference}
    `);

    const detail = await bookings.detail(reference, READER);

    expect(detail.actions.cancel, `cancel from ${status} must match canTransition`).toBe(
      canTransition(status, 'cancelled', 'staff'),
    );
  });

  /**
   * Stated on its own, because it is the edge somebody would "fix" by adding staff to it.
   *
   * An unpaid booking is released by the customer abandoning it or by the EC-001 sweep. A staff
   * cancellation there would take a different path through the wallet hold than the one
   * `releaseWalletHold` is written for.
   */
  it('does not offer a staff cancellation while payment is still outstanding', async () => {
    await db.execute(sql`
      UPDATE bookings SET status = 'pending_payment' WHERE reference = ${reference}
    `);

    const detail = await bookings.detail(reference, READER);

    expect(detail.actions.cancel).toBe(false);
  });

  /** Capturing is the payment window and nothing else — it stands in for a gateway webhook. */
  it('offers capture only while payment is outstanding', async () => {
    for (const status of STATUSES) {
      await db.execute(sql`
        UPDATE bookings SET status = ${status}::booking_status WHERE reference = ${reference}
      `);

      const detail = await bookings.detail(reference, READER);

      expect(detail.actions.capturePayment, `capture from ${status}`).toBe(
        status === 'pending_payment',
      );
    }
  });

  /** The counts behind the cross-links: zero is an answer, and it has to be the right one. */
  it('counts nothing related to a fresh booking', async () => {
    const detail = await bookings.detail(reference, READER);

    expect(detail.related).toEqual({
      disputes: 0,
      conversations: 0,
      notifications: 0,
    });
  });

  it('counts a dispute and a conversation once each exists', async () => {
    await db.execute(sql`
      WITH b AS (SELECT id, partner_id, customer_profile_id FROM bookings WHERE reference = ${reference})
      INSERT INTO disputes (booking_id, partner_id, customer_profile_id, kind, title, status)
      SELECT b.id, b.partner_id, b.customer_profile_id, 'complaint'::dispute_kind,
             'نزاع اختباري', 'open'::dispute_status FROM b
    `);
    /*
      `booking_id` ALONE as the subject. `conversations_exactly_one_subject_v2` counts booking,
      dispute and partner and demands exactly one — naming the partner as well is a second subject,
      not extra context, and the check refuses it.
    */
    await db.execute(sql`
      WITH b AS (SELECT id, customer_profile_id FROM bookings WHERE reference = ${reference})
      INSERT INTO conversations (booking_id, customer_profile_id)
      SELECT b.id, b.customer_profile_id FROM b
    `);

    const detail = await bookings.detail(reference, READER);

    expect(detail.related.disputes).toBe(1);
    expect(detail.related.conversations).toBe(1);
    expect(detail.related.notifications, 'and only what actually exists').toBe(0);
  });

  /** One booking, moved through statuses by the tests above. */
  async function seed(): Promise<void> {
    const made = await db.execute<{ reference: string }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1) AS city_id,
               (SELECT id FROM currencies WHERE code = 'USD')           AS currency_id,
               (SELECT id FROM property_types LIMIT 1)                  AS type_id,
               (SELECT id FROM partner_types LIMIT 1)                   AS partner_type_id,
               (SELECT id FROM cancellation_policies LIMIT 1)           AS policy_id
      ), cu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('act-c-' || gen_random_uuid() || '@safra.test', '+963900000095', 'customer', 'active')
        RETURNING id
      ), pu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('act-p-' || gen_random_uuid() || '@safra.test', '+963900000096', 'partner', 'active')
        RETURNING id
      ), cp AS (
        INSERT INTO customer_profiles (user_id, full_name, email, phone, is_guest)
        SELECT cu.id, 'عميل الإجراءات', 'act-c-' || gen_random_uuid() || '@safra.test',
               '+963900000095', false
        FROM cu RETURNING id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT pu.id, ref.partner_type_id, 'Actions Test', 'إجراءات', ref.city_id, 'x',
               '+963900000096', 'act-p-' || gen_random_uuid() || '@safra.test', 'approved'
        FROM pu, ref RETURNING id, city_id
      ), pr AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, address, status)
        SELECT pa.id, ref.city_id, ref.type_id, ref.policy_id,
               'actions-test-' || gen_random_uuid(), 'عقار الإجراءات', 'Actions', 'Actions', 'x',
               'published'
        FROM pa, ref RETURNING id, partner_id
      ), un AS (
        INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price,
                           currency_id)
        SELECT pr.id, 'وحدة', 'Unit', 'Einheit', 2, '100.00', ref.currency_id
        FROM pr, ref RETURNING id
      ), bk AS (
        INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                              check_in, check_out, guests_adults, status, paid_at,
                              confirmation_deadline_at,
                              base_amount, customer_fee_value, customer_fee_amount,
                              partner_commission_rate, partner_commission_amount,
                              total_amount, partner_payable_amount, currency_id,
                              fx_rate_to_syp, total_syp, cancellation_policy_snapshot)
        SELECT cp.id, un.id, pr.id, pr.partner_id, ref.city_id,
               current_date + 400, current_date + 402, 2,
               'pending_confirmation'::booking_status, now(), now() + INTERVAL '90 minutes',
               '200.00', '1.99', '1.99', '0.0700', '14.00', '201.99', '186.00',
               ref.currency_id, '13000.00000000', '2625870.00', '{"code":"flex"}'::jsonb
        FROM cp, un, pr, ref RETURNING reference
      )
      SELECT reference FROM bk
    `);

    const row = made.rows[0];

    if (!row) throw new Error('Seed produced no row.');

    reference = row.reference;
  }
});
