import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';
import { BOOKING_VERIFICATION_ATTEMPTS } from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { BookingRecoveryService } from './booking-recovery.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * EC-010 — and the properties that make it a verification rather than a disclosure.
 *
 * ## What is actually being protected
 *
 * An email address is not a secret. The failure this design refuses is the ORACLE: type an
 * address, learn whether that person is travelling. So the assertions that matter are about what
 * the CALLER is told — which must be nothing at all — rather than about whether the right mail was
 * sent, and those two are deliberately different questions here.
 *
 * ## The mailer is captured, not stubbed away
 *
 * A stub that swallowed the send would let «the caller learns nothing» pass against a service that
 * emailed the references to whoever asked. The fake records WHERE each message went, so the test
 * can assert the disclosure landed in the mailbox on the booking and nowhere else.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const STAFF = { sub: null, role: 'support_agent' } as unknown as AccessTokenClaims;

describeIfDb('recovering a booking somebody has lost the reference to', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  const sent: { to: string; text: string; subject: string }[] = [];
  const mail = {
    /* Not `async` — the fake does no awaiting, and a promise is what the caller needs back. */
    send: vi.fn((message: { to: string; text: string; subject: string }) => {
      sent.push(message);

      return Promise.resolve();
    }),
  };

  const recovery = new BookingRecoveryService(db, mail as never, new AuditService(db));

  let reference = '';
  let customerEmail = '';

  beforeEach(async () => {
    await harness.begin();
    sent.length = 0;
    await seed();
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  describe('tier 1 — self-service', () => {
    it('sends the reference to the address on the booking', async () => {
      await recovery.recover(customerEmail);

      expect(sent).toHaveLength(1);
      expect(sent[0]?.to).toBe(customerEmail);
      expect(sent[0]?.text).toContain(reference);
    });

    /**
     * The oracle, refused — and this is the assertion the whole tier exists for.
     *
     * An address with no bookings gets a message too, so a caller cannot tell the two apart by
     * whether anything arrived. Watched to fail against a service that returns early when it finds
     * nothing, which is the obvious implementation.
     */
    it('answers an address with no bookings the same way', async () => {
      await recovery.recover(
        'nobody-' + Math.random().toString(36).slice(2) + '@safra.test',
      );

      expect(
        sent,
        'silence would answer the question this refuses to answer',
      ).toHaveLength(1);
      expect(sent[0]?.text).not.toContain('BKG-');
    });

    /** And the reference never travels to an address that is not on a booking. */
    it('never sends one customer a reference belonging to another', async () => {
      const stranger = 'stranger-' + Math.random().toString(36).slice(2) + '@safra.test';

      await recovery.recover(stranger);

      expect(sent[0]?.to).toBe(stranger);
      expect(sent[0]?.text).not.toContain(reference);
    });
  });

  describe('tier 2 — staff-assisted', () => {
    it('sends a code to the booking address and tells the agent only a masked one', async () => {
      const result = await recovery.sendCode(reference, STAFF);

      expect(sent[0]?.to, 'the code goes where the BOOKING says').toBe(customerEmail);
      expect(result.sentTo, 'and the agent sees a mask, not an address').not.toBe(
        customerEmail,
      );
      expect(result.sentTo).toContain('•');
    });

    it('accepts the code that was sent', async () => {
      await recovery.sendCode(reference, STAFF);

      const code = codeFrom(sent[0]?.text ?? '');

      await expect(recovery.verify(reference, code, STAFF)).resolves.toMatchObject({
        reference,
      });
    });

    it('refuses a code that was not', async () => {
      await recovery.sendCode(reference, STAFF);

      const wrong = codeFrom(sent[0]?.text ?? '') === '000000' ? '111111' : '000000';

      await expect(recovery.verify(reference, wrong, STAFF)).rejects.toThrow();
    });

    /** One use. A code read out on one call must not open the record again on the next. */
    it('refuses the same code twice', async () => {
      await recovery.sendCode(reference, STAFF);

      const code = codeFrom(sent[0]?.text ?? '');

      await recovery.verify(reference, code, STAFF);
      await expect(recovery.verify(reference, code, STAFF)).rejects.toThrow();
    });

    /**
     * Guessing is bounded by the CEILING, not by the hash.
     *
     * A support call has no rate limit of its own — the agent is holding the telephone and can
     * type whatever the caller offers. After three wrong guesses the code is spent, and the only
     * way on is to send another, which puts a fresh message in the customer's mailbox and makes a
     * guessing campaign visible to the person being attacked.
     */
    it('spends the code after three wrong guesses, even if the fourth is right', async () => {
      await recovery.sendCode(reference, STAFF);

      const code = codeFrom(sent[0]?.text ?? '');
      const wrong = code === '000000' ? '111111' : '000000';

      for (let i = 0; i < BOOKING_VERIFICATION_ATTEMPTS; i += 1) {
        await expect(recovery.verify(reference, wrong, STAFF)).rejects.toThrow();
      }

      await expect(
        recovery.verify(reference, code, STAFF),
        'the right code, after the ceiling — still refused',
      ).rejects.toThrow();
    });

    it('refuses an expired code', async () => {
      await recovery.sendCode(reference, STAFF);

      await db.execute(sql`
        UPDATE booking_verifications SET expires_at = now() - INTERVAL '1 minute'
      `);

      await expect(
        recovery.verify(reference, codeFrom(sent[0]?.text ?? ''), STAFF),
      ).rejects.toThrow();
    });

    /**
     * The code is never stored, and never audited.
     *
     * Asked as the general question — every string in the row and in the audit payload — rather
     * than «the column does not equal the code». A digest column that accidentally held the plain
     * value would satisfy a narrower assertion by name.
     */
    it('stores a digest and records the channel, never the code or the address', async () => {
      await recovery.sendCode(reference, STAFF);

      const code = codeFrom(sent[0]?.text ?? '');
      const rows = await db.execute<Record<string, unknown>>(sql`
        SELECT * FROM booking_verifications
      `);
      const audit = await db.execute<Record<string, unknown>>(sql`
        SELECT * FROM audit_log WHERE action = 'booking.verification_sent'
      `);

      const walked = JSON.stringify(rows.rows[0]) + JSON.stringify(audit.rows[0]);

      expect(walked, 'the code itself is nowhere').not.toContain(code);
      expect(walked, 'nor is the customer address').not.toContain(customerEmail);
      expect(JSON.stringify(audit.rows[0]), 'the channel is').toContain('email');
    });
  });

  /**
   * The code, and NOT the reference that precedes it in the same sentence.
   *
   * `BKG-2026-000042` ends in six digits, so a bare `\d{6}` match returns the reference number and
   * every «right code» assertion fails against a service that is working perfectly. Removing the
   * reference first is what leaves only the code — and it is worth the two lines, because the
   * alternative is a test that lies in the more dangerous direction the day the wording changes.
   */
  function codeFrom(text: string): string {
    return /\b(\d{6})\b/.exec(text.split(reference).join(' '))?.[1] ?? '';
  }

  async function seed(): Promise<void> {
    customerEmail = `rec-${Math.random().toString(36).slice(2)}@safra.test`;

    const made = await db.execute<{ reference: string }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1) AS city_id,
               (SELECT id FROM currencies WHERE code = 'USD')           AS currency_id,
               (SELECT id FROM property_types LIMIT 1)                  AS type_id,
               (SELECT id FROM partner_types LIMIT 1)                   AS partner_type_id,
               (SELECT id FROM cancellation_policies LIMIT 1)           AS policy_id
      ), cu AS (
        INSERT INTO users (email, phone, role, status, preferred_locale)
        VALUES (${customerEmail}, '+963900000061', 'customer', 'active', 'ar')
        RETURNING id
      ), pu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('rec-p-' || gen_random_uuid() || '@safra.test', '+963900000062', 'partner', 'active')
        RETURNING id
      ), cp AS (
        INSERT INTO customer_profiles (user_id, full_name, email, phone, is_guest)
        SELECT cu.id, 'نزيل الاستعادة', ${customerEmail}, '+963900000061', false
        FROM cu RETURNING id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT pu.id, ref.partner_type_id, 'Recovery Test', 'استعادة', ref.city_id, 'x',
               '+963900000062', 'rec-p-' || gen_random_uuid() || '@safra.test', 'approved'
        FROM pu, ref RETURNING id, city_id
      ), pr AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, address, status)
        SELECT pa.id, ref.city_id, ref.type_id, ref.policy_id,
               'recovery-test-' || gen_random_uuid(), 'عقار الاستعادة', 'Rec', 'Rec', 'x',
               'published'
        FROM pa, ref RETURNING id, partner_id
      ), un AS (
        INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price, currency_id)
        SELECT pr.id, 'وحدة', 'Unit', 'Einheit', 2, '100.00', ref.currency_id FROM pr, ref
        RETURNING id
      ), bk AS (
        INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                              check_in, check_out, guests_adults, status, paid_at,
                              base_amount, customer_fee_value, customer_fee_amount,
                              partner_commission_rate, partner_commission_amount,
                              total_amount, partner_payable_amount, currency_id,
                              fx_rate_to_syp, total_syp, cancellation_policy_snapshot)
        SELECT cp.id, un.id, pr.id, pr.partner_id, ref.city_id,
               current_date + 900, current_date + 903, 2, 'confirmed'::booking_status, now(),
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
