import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { BookingDetailService } from './booking-detail.service.js';
import { PaymentProviderRegistry } from '../payments/providers/provider.registry.js';
import { ManualTransferProvider } from '../payments/providers/manual-transfer.provider.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * Internal notes on a booking, and the two things about them that are easy to get wrong (§9.4).
 *
 * ## The defect this feature had to avoid being
 *
 * `bookings.internal_notes` was a single `text` column: the second person to write a note would
 * have erased the first, along with when it was written and who wrote it. That exact failure was
 * reported on a different screen and fixed the same way — `O-partner-7`, 2026-08-20, "a second
 * telephone call erased the first one's note". So the first test worth writing is not "a note is
 * stored", it is «a second note leaves the first alone», and it is watched to fail against an
 * implementation that UPDATEs.
 *
 * ## And the privacy half
 *
 * A note is free prose about a NAMED customer. `audit_log` is append-only by trigger with no
 * redaction path, so a note copied there is a sentence §14 cannot follow. The assertion walks
 * EVERY string in the audit row rather than naming the note — `not.toContain(theNote)` protects
 * only the note it names, and the next field that starts carrying prose walks straight around it
 * (the lesson `audit-anonymity` learnt the hard way).
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** A reader who may work notes, and one who may only read the booking. */
const WITH_NOTES = (sub: string): AccessTokenClaims =>
  ({
    sub,
    role: 'support_agent',
    permissions: ['booking.read_all', 'booking.add_internal_note'],
  }) as unknown as AccessTokenClaims;

const WITHOUT_NOTES = (sub: string): AccessTokenClaims =>
  ({
    sub,
    role: 'finance',
    permissions: ['booking.read_all', 'payment.read'],
  }) as unknown as AccessTokenClaims;

describeIfDb('internal notes on a booking', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  const bookings = new BookingDetailService(
    db,
    new AuditService(db),
    /*
      A REAL registry — the manual-transfer provider and nothing else.

      Neither of these suites is about payment rails, but a stub that answered `isOffline` however
      it liked would make the capture control's scope a fiction here. This is the registry the
      application builds with the simulator disabled, which is also the production shape.
    */
    new PaymentProviderRegistry(
      { PAYMENT_SIMULATOR_ENABLED: false } as never,
      null as never,
      new ManualTransferProvider(),
    ),
    /*
      Neither suite compensates anybody, and `null` here surfaces as a crash the moment one tries
      rather than as a silently wrong balance. `booking-compensation.integration.test.ts` is where
      the real service is exercised.
    */
    null as never,
  );

  let reference = '';
  let staffId = '';

  beforeEach(async () => {
    await harness.begin();
    await seed();
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  it('keeps a note and attributes it', async () => {
    await bookings.addNote(
      reference,
      'العميل اتصل بخصوص موعد الوصول',
      WITH_NOTES(staffId),
    );

    const detail = await bookings.detail(reference, WITH_NOTES(staffId));

    expect(detail.notes).toHaveLength(1);
    expect(detail.notes?.[0]?.note).toBe('العميل اتصل بخصوص موعد الوصول');
    expect(detail.notes?.[0]?.author, 'the note names who wrote it').toBeTruthy();
  });

  /**
   * The whole reason this is a table.
   *
   * Watched to fail: with `addNote` writing `UPDATE bookings SET internal_notes = $1` — the shape
   * the column invited — this returns one note and it is the second one.
   */
  it('a second note leaves the first one alone', async () => {
    await bookings.addNote(
      reference,
      'أول ملاحظة: العميل طلب تأخير الوصول',
      WITH_NOTES(staffId),
    );
    await bookings.addNote(
      reference,
      'ثاني ملاحظة: الشريك وافق على التأخير',
      WITH_NOTES(staffId),
    );

    const detail = await bookings.detail(reference, WITH_NOTES(staffId));

    expect(detail.notes).toHaveLength(2);
    expect(
      detail.notes?.map((n) => n.note),
      'oldest first — the section is a history and reads downwards',
    ).toEqual([
      'أول ملاحظة: العميل طلب تأخير الوصول',
      'ثاني ملاحظة: الشريك وافق على التأخير',
    ]);
  });

  /** And the database refuses it too, so the guarantee does not depend on the service. */
  it('refuses an UPDATE, by trigger', async () => {
    await bookings.addNote(reference, 'ملاحظة لا يجوز تعديلها', WITH_NOTES(staffId));

    const refused = await db
      .execute(sql`UPDATE booking_internal_notes SET note = 'مُعدَّلة'`)
      .then(
        () => null,
        (error: unknown) => error,
      );

    expect(refused, 'the UPDATE must not succeed').not.toBeNull();
    expect(
      isAppendOnlyRefusal(refused),
      'refused BY THE TRIGGER, not by a typo in this SQL',
    ).toBe(true);
  });

  /** DELETE is the other half of the same guarantee, and it is a separate trigger event. */
  it('refuses a DELETE, by trigger', async () => {
    await bookings.addNote(reference, 'ملاحظة لا تُحذف', WITH_NOTES(staffId));

    const refused = await db.execute(sql`DELETE FROM booking_internal_notes`).then(
      () => null,
      (error: unknown) => error,
    );

    expect(isAppendOnlyRefusal(refused), 'refused by the trigger').toBe(true);
  });

  /**
   * The privacy half, asked as the general question.
   *
   * Every string ANYWHERE in the audit row is checked for the note's words, not just a field
   * somebody thought of. The opposite control is in the same test: an audit row naming the action
   * and the actor must exist, or "the note is not in the audit log" would pass beautifully against
   * a service that audited nothing at all.
   */
  it('records that a note was written and never what it said', async () => {
    const secret = 'رقم هاتف بديل للعميل ٠٩٩٩٩٩٩٩٩٩ وملاحظة خاصة';

    await bookings.addNote(reference, secret, WITH_NOTES(staffId));

    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT * FROM audit_log
      WHERE action = 'booking.internal_note_added' AND actor_user_id = ${staffId}::uuid
    `);

    /* The opposite control: the act IS recorded. */
    expect(rows.rows, 'the act of writing a note is audited').toHaveLength(1);

    const walked = JSON.stringify(rows.rows[0]);

    for (const word of ['٠٩٩٩٩٩٩٩٩٩', 'هاتف', 'ملاحظة خاصة']) {
      expect(walked, `no part of the note reaches audit_log: ${word}`).not.toContain(
        word,
      );
    }
  });

  /**
   * Absent, not empty — and the opposite control beside it.
   *
   * "Withheld" and "there are none" are indistinguishable without both halves: a service that
   * returned notes to nobody would pass the first assertion perfectly.
   */
  it('withholds notes from a reader without the capability, and shows them to one with it', async () => {
    await bookings.addNote(reference, 'ملاحظة داخلية للدعم فقط', WITH_NOTES(staffId));

    const hidden = await bookings.detail(reference, WITHOUT_NOTES(staffId));
    const shown = await bookings.detail(reference, WITH_NOTES(staffId));

    expect(hidden.notes, 'absent, not an empty array').toBeUndefined();
    expect(
      JSON.stringify(hidden),
      'and nowhere else in the payload either',
    ).not.toContain('ملاحظة داخلية للدعم فقط');
    expect(shown.notes, 'the control: a reader who may see them, does').toHaveLength(1);
  });

  /** A booking that is not there answers the same way a booking nobody may read does. */
  it('refuses a note against a reference that does not exist', async () => {
    await expect(
      bookings.addNote('BKG-DOES-NOT-EXIST', 'ملاحظة', WITH_NOTES(staffId)),
    ).rejects.toThrow();
  });

  /** One booking, one staff account to attribute notes to. */
  async function seed(): Promise<void> {
    const made = await db.execute<{ reference: string; staff: string }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1) AS city_id,
               (SELECT id FROM currencies WHERE code = 'USD')           AS currency_id,
               (SELECT id FROM property_types LIMIT 1)                  AS type_id,
               (SELECT id FROM partner_types LIMIT 1)                   AS partner_type_id,
               (SELECT id FROM cancellation_policies LIMIT 1)           AS policy_id
      ), st AS (
        INSERT INTO users (full_name, email, phone, role, status)
        VALUES ('موظف الدعم', 'note-s-' || gen_random_uuid() || '@safra.test',
                '+963900000092', 'support_agent', 'active')
        RETURNING id
      ), cu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('note-c-' || gen_random_uuid() || '@safra.test', '+963900000093', 'customer', 'active')
        RETURNING id
      ), pu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('note-p-' || gen_random_uuid() || '@safra.test', '+963900000094', 'partner', 'active')
        RETURNING id
      ), cp AS (
        INSERT INTO customer_profiles (user_id, full_name, email, phone, is_guest)
        SELECT cu.id, 'عميل الملاحظات', 'note-c-' || gen_random_uuid() || '@safra.test',
               '+963900000093', false
        FROM cu RETURNING id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT pu.id, ref.partner_type_id, 'Notes Test', 'ملاحظات', ref.city_id, 'x',
               '+963900000094', 'note-p-' || gen_random_uuid() || '@safra.test', 'approved'
        FROM pu, ref RETURNING id, city_id
      ), pr AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, address, status)
        SELECT pa.id, ref.city_id, ref.type_id, ref.policy_id,
               'notes-test-' || gen_random_uuid(), 'عقار الملاحظات', 'Notes', 'Notes', 'x',
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
               current_date + 300, current_date + 302, 2,
               'pending_confirmation'::booking_status, now(), now() + INTERVAL '90 minutes',
               '200.00', '1.99', '1.99', '0.0700', '14.00', '201.99', '186.00',
               ref.currency_id, '13000.00000000', '2625870.00', '{"code":"flex"}'::jsonb
        FROM cp, un, pr, ref RETURNING reference
      )
      SELECT bk.reference, st.id AS staff FROM bk, st
    `);

    const row = made.rows[0];

    if (!row) throw new Error('Seed produced no row.');

    reference = row.reference;
    staffId = row.staff;
  }
});

/**
 * Asserts the rejection came from the append-only trigger, not from anything else.
 *
 * Drizzle wraps a driver error as "Failed query: …" and hangs the real one off `cause`, so matching
 * the top-level message would pass for ANY failed statement — including a typo in this file's own
 * SQL. The trigger's own text is what proves the guard fired. Lifted from
 * `settings-admin.integration.test.ts`, which learnt it first.
 */
function isAppendOnlyRefusal(error: unknown): boolean {
  const cause = (error as { cause?: unknown } | null)?.cause;
  const message = cause instanceof Error ? cause.message : String(error);

  return /append-only/i.test(message);
}
