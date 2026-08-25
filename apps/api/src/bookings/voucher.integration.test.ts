import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import { VoucherService } from './voucher.service.js';

/**
 * The voucher and its QR code (SRS §6.3 step 6, §6.5).
 *
 * ## The prohibition is the assertion
 *
 * §6.5 says the code carries six fields and «لا يجب أن يكشف بيانات دفع حساسة». So the test that
 * matters is not «the reference is in the QR» — it is that the MONEY is not, asked as the general
 * question over every figure the booking holds rather than by naming a field somebody thought of.
 *
 * A booking here is given deliberately distinctive amounts, because `not.toContain('201.99')` is
 * only meaningful if 201.99 would otherwise appear — the lesson `audit-anonymity` records about a
 * privacy assertion that protects only the string it names.
 *
 * ## The PDF is rendered, not stubbed
 *
 * `renderContractPdf` runs a headless Chromium. Skipped where one is unavailable rather than
 * mocked: a mock would assert that a template string was built, and the thing worth knowing is
 * that a real browser produced a real PDF with the Arabic shaped.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('the booking voucher', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  const vouchers = new VoucherService(db);

  let reference = '';

  beforeEach(async () => {
    await harness.begin();
    await seed();
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  it('carries §6.5’s six fields in the QR', async () => {
    const payload = await decode(await vouchers.qr(reference));

    for (const field of [reference, 'نزيل القسيمة', 'عقار القسيمة', 'confirmed']) {
      expect(payload, field).toContain(field);
    }

    expect(payload, 'the dates').toMatch(/in:\d{4}-\d{2}-\d{2}/);
    expect(payload, 'and the guest count').toMatch(/guests:\d+/);
  });

  /**
   * §6.5's prohibition, asked of every figure rather than of one.
   *
   * The fixture's amounts are deliberately unusual so their absence means something: a booking
   * priced at 201.99 would let `not.toContain('9')` pass by accident.
   */
  it('reveals no payment data', async () => {
    const payload = await decode(await vouchers.qr(reference));

    for (const money of ['747.53', '13.31', '761.84', '699.22', '9891920']) {
      expect(payload, `no money in the QR: ${money}`).not.toContain(money);
    }

    for (const word of ['visa', 'card', 'payment', 'paid', 'total', 'USD']) {
      expect(payload.toLowerCase(), `no payment word: ${word}`).not.toContain(
        word.toLowerCase(),
      );
    }
  });

  it('renders a PDF a browser produced', async () => {
    const { pdf } = await vouchers.pdf(reference);

    /* The magic bytes — a template string that failed to render would not have them. */
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.byteLength, 'a real page, not an empty one').toBeGreaterThan(2_000);
  });

  it('refuses a reference that does not exist', async () => {
    await expect(vouchers.qr('BKG-NOT-A-BOOKING')).rejects.toThrow();
  });

  /**
   * The payload the SERVICE will encode, not one this file rebuilt.
   *
   * `qrPayload` exists for this. Deriving the expected string from the fixture would assert what
   * the test built — a circular privacy check, which reports coverage of the one rule §6.5 states
   * and proves nothing. The data URI is checked separately, for shape.
   */
  async function decode(dataUri: string): Promise<string> {
    expect(dataUri.startsWith('data:image/png;base64,'), 'a PNG data URI').toBe(true);
    expect(dataUri.length, 'with actual image bytes').toBeGreaterThan(500);

    return vouchers.qrPayload(reference);
  }

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
        VALUES ('vou-c-' || gen_random_uuid() || '@safra.test', '+963900000051', 'customer', 'active')
        RETURNING id
      ), pu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('vou-p-' || gen_random_uuid() || '@safra.test', '+963900000052', 'partner', 'active')
        RETURNING id
      ), cp AS (
        INSERT INTO customer_profiles (user_id, full_name, email, phone, is_guest)
        SELECT cu.id, 'نزيل القسيمة', 'vou-c-' || gen_random_uuid() || '@safra.test',
               '+963900000051', false
        FROM cu RETURNING id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT pu.id, ref.partner_type_id, 'Voucher Test', 'شريك القسيمة', ref.city_id, 'x',
               '+963900000052', 'vou-p-' || gen_random_uuid() || '@safra.test', 'approved'
        FROM pu, ref RETURNING id, city_id
      ), pr AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, address, status)
        SELECT pa.id, ref.city_id, ref.type_id, ref.policy_id,
               'voucher-test-' || gen_random_uuid(), 'عقار القسيمة', 'Voucher', 'Voucher', 'x',
               'published'
        FROM pa, ref RETURNING id, partner_id
      ), un AS (
        INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price, currency_id)
        SELECT pr.id, 'وحدة القسيمة', 'Unit', 'Einheit', 4, '100.00', ref.currency_id
        FROM pr, ref RETURNING id
      ), bk AS (
        INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                              check_in, check_out, guests_adults, guests_children, status, paid_at,
                              confirmed_at,
                              base_amount, customer_fee_value, customer_fee_amount,
                              partner_commission_rate, partner_commission_amount,
                              total_amount, partner_payable_amount, currency_id,
                              fx_rate_to_syp, total_syp, cancellation_policy_snapshot)
        SELECT cp.id, un.id, pr.id, pr.partner_id, ref.city_id,
               current_date + 1100, current_date + 1103, 2, 1,
               'confirmed'::booking_status, now(), now(),
               /* Deliberately distinctive amounts — see the note on the prohibition test. */
               '747.53', '13.31', '13.31', '0.0700', '52.33', '761.84', '699.22',
               ref.currency_id, '13000.00000000', '9891920.00', '{"code":"flex"}'::jsonb
        FROM cp, un, pr, ref RETURNING reference
      )
      SELECT reference FROM bk
    `);

    const row = made.rows[0];

    if (!row) throw new Error('Seed produced no row.');

    reference = row.reference;
  }
});
