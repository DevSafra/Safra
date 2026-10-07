import { createDatabase } from '@safra/db';

import { FieldEncryptionService } from '../common/crypto/field-encryption.service.js';
import { rotateFieldEncryption } from '../common/crypto/field-key-rotation.js';
import { loadEnv } from '../config/env.js';

/**
 * Re-encrypts every field-encrypted value under the CURRENT key (future-work S-6): every column in
 * `ROTATED_COLUMNS`, which `field-key-rotation.test.ts` holds to the schema and the source.
 *
 * ## Why this exists as well as lazy migration
 *
 * `AuthService.login` re-encrypts a TOTP secret whenever it decrypts one with the retired
 * key, but only for accounts that sign in, and nothing re-encrypts the account numbers
 * lazily at all. A dormant staff account, a payout account nobody has edited, a bank
 * transfer refunded months ago: all stay under the old key until this runs, so this is
 * what lets `FIELD_ENCRYPTION_KEY_PREVIOUS` actually be removed.
 *
 * ## Procedure
 *
 *   1. Generate a new key:  openssl rand -hex 32
 *   2. Set FIELD_ENCRYPTION_KEY_PREVIOUS to the CURRENT key
 *   3. Set FIELD_ENCRYPTION_KEY to the NEW key
 *   4. Deploy (migrations included). Both keys decrypt; only the new one encrypts.
 *   5. Run this script:  pnpm --filter @safra/api rotate:encryption-key
 *   6. Run it again with --dry-run; every column must report 0 re-encrypted and
 *      0 unreadable. Only then remove FIELD_ENCRYPTION_KEY_PREVIOUS
 *
 * Steps 4 and 6 are separate deploys on purpose. Removing the previous key in the
 * same change as adding the new one is exactly the mistake that locks everyone out.
 *
 * ## Safety
 *
 * Idempotent: a value already under the current key is left alone. Read-modify-write
 * per row rather than one large transaction: a partial run is harmless because both
 * keys still decrypt, whereas a long transaction over these tables would hold locks
 * across an operation that has no need to be atomic.
 *
 * `--dry-run` reports what would change without writing.
 */
async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const env = loadEnv();
  const encryption = new FieldEncryptionService(env);

  if (!encryption.hasPreviousKey) {
    console.log(
      'FIELD_ENCRYPTION_KEY_PREVIOUS is not set, so nothing can be under an old key.\n' +
        'If you are mid-rotation, set it to the key being retired and re-run.',
    );
    return;
  }

  const db = createDatabase(env.DATABASE_URL, 2);

  try {
    const reports = await rotateFieldEncryption(db, encryption, { dryRun });
    const prefix = dryRun ? '[dry run] ' : '';
    let unreadable = 0;
    let pending = 0;

    for (const report of reports) {
      console.log(
        `${prefix}${report.column}: ${report.reEncrypted} ${dryRun ? 'would be ' : ''}` +
          `re-encrypted, ${report.alreadyCurrent} already current, ` +
          `${report.unreadable.length} unreadable.`,
      );

      /*
        Named by id rather than aborting: one unreadable row must not stop the rest from migrating,
        and the id is what an operator needs to act on it. Never the value.
      */
      for (const id of report.unreadable) {
        console.error(
          `  UNREADABLE: ${report.column} row ${id}, no configured key decrypts it.`,
        );
      }

      unreadable += report.unreadable.length;
      if (dryRun) pending += report.reEncrypted;
    }

    if (unreadable > 0) {
      console.error(
        '\nThose rows cannot be recovered by rotation: they were encrypted with a key that is no\n' +
          'longer configured. Restore that key if it still exists. Otherwise: users, reset the\n' +
          'second factor; payout accounts, have the number entered again; payments and refunds,\n' +
          'the sender account is set once and cannot be re-entered, so a bank-transfer refund of\n' +
          'that payment cannot be settled. Do NOT remove FIELD_ENCRYPTION_KEY_PREVIOUS while any\n' +
          'row is listed here.',
      );
    }

    if (unreadable === 0 && pending === 0) {
      console.log(
        '\nNothing remains under the previous key. Safe to remove\n' +
          'FIELD_ENCRYPTION_KEY_PREVIOUS in the next deploy.',
      );
    }

    // Non-zero when something still needs attention, so CI or a deploy step can gate on it.
    if (unreadable > 0) process.exitCode = 1;
  } finally {
    await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
  }
}

await main();
