import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PERMISSIONS as P } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import type { AccessTokenClaims } from '../auth/token.service.js';
import { BookingsService } from './bookings.service.js';

/**
 * Whether money was ever RECEIVED, on the customer's own booking — finding 220.
 *
 * ## The two bookings that read identically
 *
 * A `cancelled` booking may have been paid and then refunded, or cancelled for non-payment and
 * never paid at all. The payload carried nothing to tell them apart, so the page printed the
 * neutral «إجمالي الحجز» for both — honest, and less useful than the truth.
 *
 * It was found the other way round, which is worse: before the neutral label, a booking the EC-001
 * sweep had killed BECAUSE nothing was ever paid said «الإجمالي المدفوع $196.99».
 *
 * ## `captured`, and only `captured`
 *
 * An `authorized` payment is a HOLD. The money has not moved, and reporting it as received is the
 * same false claim in a quieter voice — so the second test plants one and asserts it counts for
 * nothing. `initiated` and `failed` likewise.
 *
 * ## Absent is not zero
 *
 * `null` when nothing was captured, never `'0.00'`: a zero is an amount and reads as one. The
 * consumer distinguishes three states — a figure, `null` («captured nothing»), and an absent field
 * («this API did not say») — and collapsing the last two would print «لم يُدفع» over a booking that
 * was paid.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('what a customer can learn about their own payment', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  let db: Database;
  let service: BookingsService;

  beforeEach(async () => {
    await harness.begin();
    db = harness.db;
    service = new BookingsService(db);
  });

  afterEach(async () => {
    await harness.rollback();
  });

  /** A real booking with its own customer, and no payments of any kind left on it. */
  async function aBooking() {
    const rows = await db.execute<{
      id: string;
      reference: string;
      customer_profile_id: string;
      currency_id: string;
    }>(sql`
      SELECT b.id, b.reference, b.customer_profile_id, b.currency_id
        FROM bookings b
       WHERE b.deleted_at IS NULL AND b.customer_profile_id IS NOT NULL
       ORDER BY b.reference
       LIMIT 1
    `);

    const row = rows.rows[0];

    if (!row) throw new Error('no booking with a customer to test against');

    /* Inside the rollback, so the real payments are still there afterwards. */
    await db.execute(sql`DELETE FROM payments WHERE booking_id = ${row.id}`);

    return row;
  }

  const customer = (row: { customer_profile_id: string }): AccessTokenClaims =>
    ({
      sub: '00000000-0000-7000-8000-00000000c001',
      role: 'customer',
      permissions: [P.BOOKING_READ_OWN],
      locale: 'ar',
      customerProfileId: row.customer_profile_id,
    }) as unknown as AccessTokenClaims;

  async function aPayment(
    row: { id: string; currency_id: string },
    status: string,
    amount: string,
    capturedAt: string | null,
  ) {
    await db.execute(sql`
      INSERT INTO payments (booking_id, method, provider, amount, currency_id, status, captured_at)
      VALUES (${row.id}, 'bank_transfer', 'manual_transfer', ${amount}, ${row.currency_id},
              ${status}::payment_status,
              ${capturedAt === null ? null : sql`${capturedAt}::timestamptz`})
    `);
  }

  it('says nothing was received when nothing was', async () => {
    const row = await aBooking();

    const booking = await service.findByReference(customer(row), row.reference);

    expect(booking['paidAmount'], 'null, not a zero — a zero is an amount').toBeNull();
    expect(booking['paidAt']).toBeNull();
  });

  /*
    One capture beside an attempt that failed. It was two captures summed, which the database now
    refuses (post/0026_refund_destination.sql: one capture per booking, so a refund always has ONE
    original payment to return through). A failed attempt is the real shape of «more than one row».
  */
  it('reports what was captured, and when', async () => {
    const row = await aBooking();

    await aPayment(row, 'failed', '30.00', null);
    await aPayment(row, 'captured', '150.00', '2026-09-01T10:00:00Z');

    const booking = await service.findByReference(customer(row), row.reference);

    expect(Number(booking['paidAmount']), 'the capture, not the failed attempt').toBe(
      150,
    );
    expect(String(booking['paidAt'])).toContain('2026-09-01');
  });

  /**
   * A HOLD is not money received.
   *
   * The control matters as much as the assertion: the authorised row must be there to be ignored,
   * or this passes against a fixture that planted nothing. So it is asserted beside a capture, and
   * the total proves only the capture was counted.
   */
  it('counts an authorisation for nothing', async () => {
    const row = await aBooking();

    await aPayment(row, 'authorized', '500.00', null);
    await aPayment(row, 'captured', '40.00', '2026-09-05T10:00:00Z');

    const booking = await service.findByReference(customer(row), row.reference);

    expect(Number(booking['paidAmount']), 'the hold is not money').toBe(40);
  });

  it('counts an initiated or failed attempt for nothing', async () => {
    const row = await aBooking();

    await aPayment(row, 'initiated', '500.00', null);
    await aPayment(row, 'failed', '500.00', null);

    const booking = await service.findByReference(customer(row), row.reference);

    expect(booking['paidAmount']).toBeNull();
  });

  /** A deleted payment is not a payment. */
  it('ignores a soft-deleted capture', async () => {
    const row = await aBooking();

    await aPayment(row, 'captured', '90.00', '2026-09-07T10:00:00Z');
    await db.execute(
      sql`UPDATE payments SET deleted_at = now() WHERE booking_id = ${row.id}`,
    );

    const booking = await service.findByReference(customer(row), row.reference);

    expect(booking['paidAmount']).toBeNull();
  });

  /**
   * And it adds no reach.
   *
   * The fact travels on a booking the caller was already scoped to, so the thing to hold is that
   * nothing about the PAYMENT beyond a sum and a date came with it — a provider reference is
   * operational plumbing a customer would quote to their bank in error, which is the line the
   * refunds query already draws.
   */
  it('carries no provider, reference or method with it', async () => {
    const row = await aBooking();

    await aPayment(row, 'captured', '60.00', '2026-09-09T10:00:00Z');

    const booking = await service.findByReference(customer(row), row.reference);

    const serialised = JSON.stringify(booking);

    expect(serialised).not.toContain('manual_transfer');
    expect(serialised).not.toContain('bank_transfer');
    expect(serialised).not.toContain('PAY-');
  });
});
