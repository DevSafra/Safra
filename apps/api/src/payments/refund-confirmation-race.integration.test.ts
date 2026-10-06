import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from '@safra/db';

import { PaymentWebhookService } from './payment-webhook.service.js';

/**
 * Two confirmations of two equal refunds on one payment, arriving together (audit 2026-10-06).
 *
 * The provider refunds a payment twice for the same figure and posts both confirmations at once.
 * Each picks «the oldest open refund of that figure», and both picked the SAME one: the second
 * waited on the first's lock, then completed the row the first had just completed, reported success,
 * and left the other refund `processing` for ever, with the customer's money returned and no row
 * saying so.
 *
 * ## Why this suite commits
 *
 * The race is inside ONE statement, between two connections. `createRollbackDatabase` pins a single
 * connection, and `interleaved()` stages a writer before a transaction opens, so neither can put a
 * second statement inside the first's lock. Two real pools can. The rows are committed and removed
 * in `afterAll`, on a payment this suite creates, so nothing it leaves can be mistaken for real data.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('two refund confirmations arriving together', () => {
  const first = createDatabase(DATABASE_URL ?? '', 2);
  const second = createDatabase(DATABASE_URL ?? '', 2);

  let paymentId = '';
  let older = '';
  let newer = '';

  beforeAll(async () => {
    const made = await first.execute<{
      payment: string;
      older: string;
      newer: string;
    }>(sql`
      WITH b AS (
        SELECT id, currency_id FROM bookings
         WHERE deleted_at IS NULL
         ORDER BY created_at, id
         LIMIT 1
      ), pay AS (
        INSERT INTO payments (booking_id, method, provider, amount, currency_id, status)
        SELECT id, 'visa', 'simulator', 100, currency_id, 'captured' FROM b
        RETURNING id, booking_id, currency_id
      ), one AS (
        INSERT INTO refunds (payment_id, booking_id, amount, currency_id, reason, status, created_at)
        SELECT id, booking_id, 20, currency_id, 'race fixture, older', 'processing', now() - interval '1 minute'
          FROM pay
        RETURNING id
      ), two AS (
        INSERT INTO refunds (payment_id, booking_id, amount, currency_id, reason, status)
        SELECT id, booking_id, 20, currency_id, 'race fixture, newer', 'processing' FROM pay
        RETURNING id
      )
      SELECT pay.id::text AS payment, one.id::text AS older, two.id::text AS newer
        FROM pay, one, two
    `);

    paymentId = made.rows[0]?.payment ?? '';
    older = made.rows[0]?.older ?? '';
    newer = made.rows[0]?.newer ?? '';
  });

  afterAll(async () => {
    if (paymentId) {
      await first.execute(sql`DELETE FROM refunds WHERE payment_id = ${paymentId}::uuid`);
      await first.execute(sql`DELETE FROM payments WHERE id = ${paymentId}::uuid`);
    }

    await first.$client.end();
    await second.$client.end();
  });

  it('completes each refund once, the second confirmation taking the other one', async () => {
    expect(paymentId, 'the fixture needs a booking to hang a payment on').not.toBe('');

    const webhooks = new PaymentWebhookService(
      second,
      {} as never,
      {} as never,
      {} as never,
      {
        /* The reversal is not this suite's subject; the row a confirmation completes is. */
        reverseForRefund: () => Promise.resolve(),
      } as never,
    );
    const confirm = (
      webhooks as unknown as {
        applyRefundConfirmation(
          payment: { id: string; reference: string },
          event: { providerEventId: string; amount: { value: string } },
        ): Promise<string>;
      }
    ).applyRefundConfirmation.bind(webhooks);

    /* The first confirmation, mid-flight: it has completed the older refund and not yet committed. */
    const held = await first.$client.connect();

    try {
      await held.query('BEGIN');
      await held.query(
        `UPDATE refunds SET status = 'completed', completed_at = now() WHERE id = $1`,
        [older],
      );

      const racing = confirm(
        { id: paymentId, reference: 'race-fixture' },
        { providerEventId: 'race-second', amount: { value: '20' } },
      );

      /* Long enough for the second to have chosen its row and be waiting, if it waits. */
      await new Promise((resolve) => setTimeout(resolve, 400));
      await held.query('COMMIT');

      expect(await racing).toBe('accepted');
    } finally {
      held.release();
    }

    const rows = await first.execute<{ id: string; status: string }>(sql`
      SELECT id::text, status::text FROM refunds WHERE payment_id = ${paymentId}::uuid
    `);
    const status = Object.fromEntries(rows.rows.map((row) => [row.id, row.status]));

    expect(status[older], 'the first confirmation completed the older refund').toBe(
      'completed',
    );
    expect(
      status[newer],
      'and the second completed the other, not the same one twice',
    ).toBe('completed');
  });
});
