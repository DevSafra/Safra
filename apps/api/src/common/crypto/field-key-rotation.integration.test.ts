import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import type { Env } from '../../config/env.js';
import { FieldEncryptionService } from './field-encryption.service.js';
import {
  ROTATED_COLUMNS,
  rotateFieldEncryption,
  type RotatedColumn,
} from './field-key-rotation.js';

/**
 * A key rotation leaves NOTHING under the retired key, against a real PostgreSQL.
 *
 * The defect (go-live audit, 2026-10-06): `pnpm rotate:encryption-key` rewrote the TOTP column and
 * nothing else, so removing `FIELD_ENCRYPTION_KEY_PREVIOUS` afterwards, as the runbook said to, left
 * every payout account number and every bank-transfer payer and refund destination undecryptable.
 *
 * One fixture row per column in `ROTATED_COLUMNS`, each under a throwaway OLD key. After the rotation
 * every one must open with the NEW key alone, which is exactly the state after the retired key is
 * removed. The payer and the refund copied from it must also still be the same string, because the
 * database proves a refund went back to the sender by comparing them.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const OLD_KEY = randomBytes(32).toString('hex');
const NEW_KEY = randomBytes(32).toString('hex');

const keys = (current: string, previous?: string) =>
  new FieldEncryptionService({
    FIELD_ENCRYPTION_KEY: current,
    ...(previous ? { FIELD_ENCRYPTION_KEY_PREVIOUS: previous } : {}),
  } as Env);

const before = keys(OLD_KEY);
const during = keys(NEW_KEY, OLD_KEY);
const after = keys(NEW_KEY);

/*
  The trigger functions from the file this change edits, applied inside the test's transaction. The
  shared database carries whatever version was last migrated; testing that would test the past.
*/
const POST_0027 = readFileSync(
  new URL(
    '../../../../../packages/db/migrations/post/0027_bank_transfer_refund.sql',
    import.meta.url,
  ),
  'utf8',
);
const TRIGGER_FUNCTIONS =
  POST_0027.match(/CREATE OR REPLACE FUNCTION[\s\S]*?\$\$;/g) ?? [];

const PLAIN = {
  totp: 'JBSWY3DPEHPK3PXP',
  partnerAccount: 'SY110000000000000000004411',
  safraAccount: 'SY220000000000000000005522',
  payer: 'SY330000000000000000006633',
  strayDestination: 'SY440000000000000000007744',
};

describeIfDb('field-encryption key rotation covers every encrypted column', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  beforeEach(async () => {
    await harness.begin();
    for (const fn of TRIGGER_FUNCTIONS) await db.execute(sql.raw(fn));
  });
  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  it('has the two trigger functions it relies on', () => {
    expect(TRIGGER_FUNCTIONS).toHaveLength(2);
  });

  /*
    The opposite control: the exception is the rotation's, not everybody's. Outside it the sender's
    account and a refund's destination stay set-once, and inside it the last four still cannot move,
    so a rotation can only re-encrypt the SAME account.

    Second in the file on purpose: it then runs on a connection that has never set the setting, where
    `current_setting(…, true)` is NULL. Written without a coalesce, that NULL switched the guard off
    for every fresh connection, and this test is what found it. The 'off' half covers a connection
    that has set it before.
  */
  it('still refuses changing the set-once ciphertext outside a rotation', async () => {
    const fixture = await seed();

    await refused(
      db.execute(sql`
        UPDATE payments SET payer_account_encrypted = ${before.encrypt(PLAIN.payer)}
         WHERE id = ${fixture.paymentId}::uuid
      `),
    );
    await refused(
      db.execute(sql`
        UPDATE refunds SET destination_account_encrypted = ${before.encrypt(PLAIN.payer)}
         WHERE id = ${fixture.completedRefundId}::uuid
      `),
    );

    await db.execute(sql`SELECT set_config('safra.field_key_rotation', 'off', true)`);
    await refused(
      db.execute(sql`
        UPDATE payments SET payer_account_encrypted = ${before.encrypt(PLAIN.payer)}
         WHERE id = ${fixture.paymentId}::uuid
      `),
    );
  });

  it('leaves every column readable with the new key alone', async () => {
    const fixture = await seed();

    /* The fixture must reach every column, or a column it skips would pass by being absent. */
    expect(Object.keys(fixture.rows).sort()).toEqual([...ROTATED_COLUMNS].sort());

    /* Two rows a page, so the walk crosses page boundaries as it does on a real table. */
    const reports = await rotateFieldEncryption(db, during, {
      dryRun: false,
      batchSize: 2,
    });

    for (const column of ROTATED_COLUMNS) {
      const report = reports.find((r) => r.column === column);

      expect(report, column).toBeDefined();
      expect(report?.unreadable, column).not.toContain(fixture.rows[column].id);

      for (const { id, plaintext } of fixture.rows[column].values) {
        const stored = await valueOf(column, id);

        expect(
          after.decrypt(stored),
          `${column} ${id} opens with the new key alone`,
        ).toBe(plaintext);
      }
    }
  });

  it('keeps a refund destination identical to the payer ciphertext it was copied from', async () => {
    const fixture = await seed();

    await rotateFieldEncryption(db, during, { dryRun: false });

    const pair = await db.execute<{ payer: string; destination: string }>(sql`
      SELECT p.payer_account_encrypted AS payer, r.destination_account_encrypted AS destination
        FROM refunds r JOIN payments p ON p.id = r.payment_id
       WHERE r.id = ${fixture.completedRefundId}::uuid
    `);

    expect(pair.rows[0]?.destination).toBe(pair.rows[0]?.payer);
    expect(after.decrypt(pair.rows[0]!.payer)).toBe(PLAIN.payer);
  });

  it('writes nothing on a dry run, and counts what it would rewrite', async () => {
    const fixture = await seed();
    const stored = await valueOf('payments.payer_account_encrypted', fixture.paymentId);

    const reports = await rotateFieldEncryption(db, during, { dryRun: true });

    expect(await valueOf('payments.payer_account_encrypted', fixture.paymentId)).toBe(
      stored,
    );
    for (const report of reports) {
      expect(report.reEncrypted, report.column).toBeGreaterThanOrEqual(
        fixture.rows[report.column].values.length,
      );
    }
  });

  it('reports a second run as having nothing left to do for the fixture', async () => {
    const fixture = await seed();

    await rotateFieldEncryption(db, during, { dryRun: false });
    const again = await rotateFieldEncryption(db, during, { dryRun: true });

    for (const column of ROTATED_COLUMNS) {
      for (const { id } of fixture.rows[column].values) {
        expect(
          during.decryptForRotation(await valueOf(column, id)).needsReEncryption,
        ).toBe(false);
      }
      expect(again.find((r) => r.column === column)?.unreadable).not.toContain(
        fixture.rows[column].id,
      );
    }
  });

  it('refuses a rotation that moves the last four', async () => {
    const fixture = await seed();

    await refused(
      db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('safra.field_key_rotation', 'on', true)`);
        await tx.execute(sql`
          UPDATE payments SET payer_account_encrypted = ${after.encrypt(PLAIN.strayDestination)},
                              payer_account_last4 = '7744'
           WHERE id = ${fixture.paymentId}::uuid
        `);
      }),
    );
  });

  const refused = (write: Promise<unknown>) =>
    expect(write).rejects.toSatisfy((error: unknown) => {
      const cause = (error as { cause?: { code?: string } }).cause;
      return (cause?.code ?? (error as { code?: string }).code) === '23514';
    });

  async function valueOf(column: RotatedColumn, id: string): Promise<string> {
    const [table, field] = column.split('.') as [string, string];
    const rows = await db.execute<{ value: string }>(sql`
      SELECT ${sql.identifier(field)} AS value FROM ${sql.identifier(table)} WHERE id = ${id}::uuid
    `);
    return rows.rows[0]!.value;
  }

  interface Seeded {
    rows: Record<
      RotatedColumn,
      { id: string; values: { id: string; plaintext: string }[] }
    >;
    paymentId: string;
    completedRefundId: string;
  }

  async function seed(): Promise<Seeded> {
    const made = await db.execute<{
      staff_id: string;
      partner_account_id: string;
      safra_account_id: string;
      booking_id: string;
    }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1) AS city_id,
               (SELECT id FROM currencies WHERE code = 'USD')           AS currency_id,
               (SELECT id FROM property_types LIMIT 1)                  AS type_id,
               (SELECT id FROM partner_types LIMIT 1)                   AS partner_type_id,
               (SELECT id FROM cancellation_policies LIMIT 1)           AS policy_id
      ), st AS (
        INSERT INTO users (email, phone, role, status, totp_secret_encrypted)
        VALUES ('rot-s-' || gen_random_uuid() || '@safra.test', '+963900000081', 'customer',
                'active', ${before.encrypt(PLAIN.totp)})
        RETURNING id
      ), cu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('rot-c-' || gen_random_uuid() || '@safra.test', '+963900000082', 'customer', 'active')
        RETURNING id
      ), pu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('rot-p-' || gen_random_uuid() || '@safra.test', '+963900000083', 'partner', 'active')
        RETURNING id
      ), cp AS (
        INSERT INTO customer_profiles (user_id, full_name, email, phone, is_guest)
        SELECT cu.id, 'نزيل التدوير', 'rot-c-' || gen_random_uuid() || '@safra.test',
               '+963900000082', false
        FROM cu RETURNING id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT pu.id, ref.partner_type_id, 'Key Rotation', 'شريك', ref.city_id, 'x',
               '+963900000083', 'rot-p-' || gen_random_uuid() || '@safra.test', 'approved'
        FROM pu, ref RETURNING id
      ), ppa AS (
        INSERT INTO partner_payout_accounts (partner_id, method, account_holder,
                                             account_number_encrypted, account_number_last4,
                                             currency_id)
        SELECT pa.id, 'bank_transfer', 'Key Rotation', ${before.encrypt(PLAIN.partnerAccount)},
               '4411', ref.currency_id
        FROM pa, ref RETURNING id
      ), spa AS (
        INSERT INTO safra_payout_accounts (label, method, account_holder,
                                           account_number_encrypted, account_number_last4,
                                           currency_id)
        SELECT 'حساب التدوير', 'bank_transfer', 'SAFRA', ${before.encrypt(PLAIN.safraAccount)},
               '5522', ref.currency_id
        FROM ref RETURNING id
      ), pr AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, address, status)
        SELECT pa.id, ref.city_id, ref.type_id, ref.policy_id,
               'key-rotation-' || gen_random_uuid(), 'عقار', 'Stay', 'Stay', 'x', 'published'
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
                              total_amount, wallet_amount, partner_payable_amount, currency_id,
                              fx_rate_to_syp, total_syp, cancellation_policy_snapshot)
        SELECT cp.id, un.id, pr.id, pr.partner_id, ref.city_id,
               current_date + 1400, current_date + 1402, 2, 0, 'cancelled'::booking_status,
               now(), now(), 'system.partner_no_response',
               '200.00', '0', '0', '0.0700', '0', '200.00', '0.00',
               '200.00', ref.currency_id, '13000.00000000', '2600000.00',
               '{"code":"flex","minRefundPercent":50,"tiers":[]}'::jsonb
        FROM cp, un, pr, ref RETURNING id
      )
      SELECT (SELECT id::text FROM st)  AS staff_id,
             (SELECT id::text FROM ppa) AS partner_account_id,
             (SELECT id::text FROM spa) AS safra_account_id,
             (SELECT id::text FROM bk)  AS booking_id
    `);
    const ids = made.rows[0]!;

    const paid = await db.execute<{ id: string }>(sql`
      INSERT INTO payments (booking_id, method, provider, provider_ref, amount, currency_id,
                            status, captured_at, payer_account_encrypted, payer_account_last4)
      SELECT ${ids.booking_id}::uuid, 'bank_transfer'::payment_method, 'manual_transfer',
             ${`SEPA-${crypto.randomUUID()}`}, '200.00', currency_id, 'captured'::payment_status,
             now(), ${before.encrypt(PLAIN.payer)}, '6633'
        FROM bookings WHERE id = ${ids.booking_id}::uuid
      RETURNING id::text
    `);
    const paymentId = paid.rows[0]!.id;

    const refund = async (amount: string) =>
      (
        await db.execute<{ id: string }>(sql`
          INSERT INTO refunds (payment_id, booking_id, amount, wallet_amount, currency_id, reason,
                               status)
          VALUES (${paymentId}::uuid, ${ids.booking_id}::uuid, ${amount}, '0',
                  (SELECT id FROM currencies WHERE code = 'USD'), 'key rotation',
                  'processing'::refund_status)
          RETURNING id::text
        `)
      ).rows[0]!.id;

    /* Settled the way `RefundService` settles one: the payment's own ciphertext, copied. */
    const completedRefundId = await refund('100.00');
    await db.execute(sql`
      UPDATE refunds r
         SET status = 'completed'::refund_status, completed_at = now(),
             destination_account_encrypted = p.payer_account_encrypted,
             destination_account_last4 = p.payer_account_last4,
             transfer_reference = 'TRX-ROTATION'
        FROM payments p
       WHERE r.id = ${completedRefundId}::uuid AND p.id = r.payment_id
    `);

    /* A destination that is NOT a copy of its payment's, which only the second pass reaches. */
    const strayRefundId = await refund('50.00');
    await db.execute(sql`
      UPDATE refunds
         SET destination_account_encrypted = ${before.encrypt(PLAIN.strayDestination)},
             destination_account_last4 = '7744'
       WHERE id = ${strayRefundId}::uuid
    `);

    const one = (id: string, plaintext: string) => ({ id, values: [{ id, plaintext }] });

    return {
      paymentId,
      completedRefundId,
      rows: {
        'users.totp_secret_encrypted': one(ids.staff_id, PLAIN.totp),
        'partner_payout_accounts.account_number_encrypted': one(
          ids.partner_account_id,
          PLAIN.partnerAccount,
        ),
        'safra_payout_accounts.account_number_encrypted': one(
          ids.safra_account_id,
          PLAIN.safraAccount,
        ),
        'payments.payer_account_encrypted': one(paymentId, PLAIN.payer),
        'refunds.destination_account_encrypted': {
          id: completedRefundId,
          values: [
            { id: completedRefundId, plaintext: PLAIN.payer },
            { id: strayRefundId, plaintext: PLAIN.strayDestination },
          ],
        },
      },
    };
  }
});
