import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';

import type { FieldEncryptionService } from './field-encryption.service.js';

/**
 * Every column that holds `FieldEncryptionService` ciphertext, and therefore every column a key
 * rotation must rewrite before `FIELD_ENCRYPTION_KEY_PREVIOUS` can be removed.
 *
 * Written as a list because the rotation used to know about ONE column (`users`), while four more
 * had been added beside it: payout account numbers on both tables, and the bank-transfer payer and
 * refund destination. Removing the retired key after that rotation would have made every one of
 * them undecryptable. `field-key-rotation.test.ts` fails if the schema grows an `*_encrypted`
 * column, or the source a new `encrypt()` call, that this list does not name.
 */
export const ROTATED_COLUMNS = [
  'users.totp_secret_encrypted',
  'partner_payout_accounts.account_number_encrypted',
  'safra_payout_accounts.account_number_encrypted',
  'payments.payer_account_encrypted',
  'refunds.destination_account_encrypted',
] as const;

export type RotatedColumn = (typeof ROTATED_COLUMNS)[number];

/**
 * The session setting `post/0027_bank_transfer_refund.sql` reads to let a rotation rewrite the
 * set-once sender and destination ciphertext. Set with `set_config(…, true)`, so it lasts for one
 * transaction and never for the connection.
 */
const ROTATION_SETTING = 'safra.field_key_rotation';

/** Rows read per round trip, so a large table is walked rather than loaded whole. */
const DEFAULT_BATCH = 500;

export interface ColumnRotationReport {
  readonly column: RotatedColumn;
  /** Rewritten under the current key (or, on a dry run, that would be). */
  readonly reEncrypted: number;
  readonly alreadyCurrent: number;
  /** Ids no configured key decrypts. Ids only: never the value. */
  readonly unreadable: readonly string[];
}

type Row = { id: string; value: string };

/** A table or column name, quoted by drizzle rather than spliced. */
type Identifier = ReturnType<typeof sql.identifier>;

type Outcome = 'current' | 'rewritten' | 'unreadable';

/**
 * Re-encrypts every value in `ROTATED_COLUMNS` that is still under the retired key.
 *
 * Idempotent: a value already under the current key is left alone, so a partial run is finished by
 * running again. Each write is conditional on the ciphertext it read, so a row somebody rewrote in
 * between (which is then under the current key anyway) is never overwritten with a stale value.
 * Soft-deleted rows are included: the old key is about to stop existing, and a row restored later
 * would otherwise be the one nothing can read.
 */
export async function rotateFieldEncryption(
  db: Database,
  encryption: FieldEncryptionService,
  options: { readonly dryRun: boolean; readonly batchSize?: number },
): Promise<ColumnRotationReport[]> {
  const { dryRun } = options;
  const batch = options.batchSize ?? DEFAULT_BATCH;

  const standalone = (column: RotatedColumn, table: string, field: string) =>
    rotateColumn(
      db,
      encryption,
      column,
      sql.identifier(table),
      sql.identifier(field),
      dryRun,
      batch,
    );

  return [
    await standalone('users.totp_secret_encrypted', 'users', 'totp_secret_encrypted'),
    await standalone(
      'partner_payout_accounts.account_number_encrypted',
      'partner_payout_accounts',
      'account_number_encrypted',
    ),
    await standalone(
      'safra_payout_accounts.account_number_encrypted',
      'safra_payout_accounts',
      'account_number_encrypted',
    ),
    ...(await rotatePayerAccounts(db, encryption, dryRun, batch)),
  ];
}

/** Walks one column by primary key, classifying each value with `visit`. */
async function walk(
  db: Database,
  table: Identifier,
  field: Identifier,
  batchSize: number,
  visit: (row: Row) => Promise<Outcome>,
): Promise<{ reEncrypted: number; alreadyCurrent: number; unreadable: string[] }> {
  let after: string | null = null;
  let reEncrypted = 0;
  let alreadyCurrent = 0;
  const unreadable: string[] = [];

  for (;;) {
    const page: { rows: Row[] } = await db.execute<Row>(sql`
      SELECT id::text AS id, ${field} AS value
        FROM ${table}
       WHERE ${field} IS NOT NULL
         ${after === null ? sql`` : sql`AND id > ${after}::uuid`}
       ORDER BY id
       LIMIT ${batchSize}
    `);

    for (const row of page.rows) {
      const outcome = await visit(row);

      if (outcome === 'current') alreadyCurrent += 1;
      else if (outcome === 'rewritten') reEncrypted += 1;
      else unreadable.push(row.id);
    }

    if (page.rows.length < batchSize) break;
    after = page.rows[page.rows.length - 1]!.id;
  }

  return { reEncrypted, alreadyCurrent, unreadable };
}

/** The plaintext when the value needs rewriting, `current` when it does not, `unreadable` when no key opens it. */
function open(
  encryption: FieldEncryptionService,
  value: string,
): { plaintext: string } | 'current' | 'unreadable' {
  try {
    const decrypted = encryption.decryptForRotation(value);

    return decrypted.needsReEncryption ? { plaintext: decrypted.plaintext } : 'current';
  } catch {
    return 'unreadable';
  }
}

async function rotateColumn(
  db: Database,
  encryption: FieldEncryptionService,
  column: RotatedColumn,
  table: Identifier,
  field: Identifier,
  dryRun: boolean,
  batchSize: number,
): Promise<ColumnRotationReport> {
  const counts = await walk(db, table, field, batchSize, async (row) => {
    const opened = open(encryption, row.value);

    if (typeof opened === 'string') return opened;

    if (!dryRun) {
      await db.execute(sql`
        UPDATE ${table} SET ${field} = ${encryption.encrypt(opened.plaintext)}
         WHERE id = ${row.id}::uuid AND ${field} = ${row.value}
      `);
    }

    return 'rewritten';
  });

  return { column, ...counts };
}

/**
 * The sender's account and the refund destinations copied from it, rotated TOGETHER.
 *
 * Settling an offline refund copies `payments.payer_account_encrypted` onto the refund, and the
 * database proves it went back to the same account by comparing the two strings. Re-encrypting each
 * column on its own would give them different random IVs, so a payment and its refunds are rewritten
 * in one transaction with one new ciphertext, and the comparison still holds afterwards.
 *
 * A destination that is NOT a copy of its payment's current value is rotated on its own in a second
 * pass. Nothing writes one today; the pass exists so such a row cannot outlive the key that opens it.
 */
async function rotatePayerAccounts(
  db: Database,
  encryption: FieldEncryptionService,
  dryRun: boolean,
  batchSize: number,
): Promise<ColumnRotationReport[]> {
  let destinationsWithPayment = 0;

  const payments = await walk(
    db,
    sql.identifier('payments'),
    sql.identifier('payer_account_encrypted'),
    batchSize,
    async (row) => {
      const opened = open(encryption, row.value);

      if (typeof opened === 'string') return opened;

      if (!dryRun) {
        const rewritten = encryption.encrypt(opened.plaintext);

        await db.transaction(async (tx) => {
          await tx.execute(sql`SELECT set_config(${ROTATION_SETTING}, 'on', true)`);
          await tx.execute(sql`
            UPDATE payments SET payer_account_encrypted = ${rewritten}
             WHERE id = ${row.id}::uuid AND payer_account_encrypted = ${row.value}
          `);
          const copies = await tx.execute(sql`
            UPDATE refunds SET destination_account_encrypted = ${rewritten}
             WHERE payment_id = ${row.id}::uuid AND destination_account_encrypted = ${row.value}
          `);

          destinationsWithPayment += copies.rowCount ?? 0;
        });
      }

      return 'rewritten';
    },
  );

  /*
    After a real run the copies rewritten above read as current here, and they were counted as
    rewritten already; on a dry run nothing moved, so this pass counts them itself.
  */
  const refunds = await walk(
    db,
    sql.identifier('refunds'),
    sql.identifier('destination_account_encrypted'),
    batchSize,
    async (row) => {
      const opened = open(encryption, row.value);

      if (typeof opened === 'string') return opened;

      if (!dryRun) {
        await db.transaction(async (tx) => {
          await tx.execute(sql`SELECT set_config(${ROTATION_SETTING}, 'on', true)`);
          await tx.execute(sql`
            UPDATE refunds SET destination_account_encrypted = ${encryption.encrypt(opened.plaintext)}
             WHERE id = ${row.id}::uuid AND destination_account_encrypted = ${row.value}
          `);
        });
      }

      return 'rewritten';
    },
  );

  return [
    { column: 'payments.payer_account_encrypted', ...payments },
    {
      column: 'refunds.destination_account_encrypted',
      unreadable: refunds.unreadable,
      reEncrypted: refunds.reEncrypted + (dryRun ? 0 : destinationsWithPayment),
      alreadyCurrent: refunds.alreadyCurrent - (dryRun ? 0 : destinationsWithPayment),
    },
  ];
}
