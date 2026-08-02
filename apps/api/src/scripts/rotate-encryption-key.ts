import { sql } from 'drizzle-orm';

import { createDatabase } from '@safra/db';

import { FieldEncryptionService } from '../common/crypto/field-encryption.service.js';
import { loadEnv } from '../config/env.js';

/**
 * Re-encrypts every field-encrypted value under the CURRENT key (future-work S-6).
 *
 * ## Why this exists as well as lazy migration
 *
 * `AuthService.login` re-encrypts a secret whenever it decrypts one with the retired
 * key, so rotation largely completes by itself. But it only covers accounts that sign
 * in. A staff member on parental leave, a rarely-used finance account, a dormant
 * super admin — those keep their secret under the old key indefinitely, and the old
 * key can never be retired with confidence. This finishes the job so
 * `FIELD_ENCRYPTION_KEY_PREVIOUS` can actually be removed.
 *
 * ## Procedure
 *
 *   1. Generate a new key:  openssl rand -hex 32
 *   2. Set FIELD_ENCRYPTION_KEY_PREVIOUS to the CURRENT key
 *   3. Set FIELD_ENCRYPTION_KEY to the NEW key
 *   4. Deploy. Both keys decrypt; only the new one encrypts. Nobody is locked out.
 *   5. Run this script:  pnpm rotate:encryption-key
 *   6. Confirm it reports 0 remaining, then remove FIELD_ENCRYPTION_KEY_PREVIOUS
 *
 * Steps 4 and 6 are separate deploys on purpose. Removing the previous key in the
 * same change as adding the new one is exactly the mistake that locks everyone out.
 *
 * ## Safety
 *
 * Idempotent — a value already under the current key is left alone. Read-modify-write
 * per row rather than one large transaction: a partial run is harmless because both
 * keys still decrypt, whereas a long transaction over the users table would hold locks
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
    const rows = await db.execute<{ id: string; totp_secret_encrypted: string }>(sql`
      SELECT id, totp_secret_encrypted FROM users
      WHERE totp_secret_encrypted IS NOT NULL AND deleted_at IS NULL
    `);

    let migrated = 0;
    let current = 0;
    let failed = 0;

    for (const row of rows.rows) {
      try {
        const { plaintext, needsReEncryption } = encryption.decryptForRotation(
          row.totp_secret_encrypted,
        );

        if (!needsReEncryption) {
          current += 1;
          continue;
        }

        if (!dryRun) {
          await db.execute(sql`
            UPDATE users SET totp_secret_encrypted = ${encryption.encrypt(plaintext)}
            WHERE id = ${row.id}
          `);
        }

        migrated += 1;
      } catch {
        /**
         * Neither key decrypts this row. Counted and named rather than aborting: one
         * unreadable row must not stop the rest from migrating, and the id is what an
         * operator needs to reset that account's second factor.
         */
        failed += 1;
        console.error(`  UNREADABLE: user ${row.id} — no configured key decrypts it.`);
      }
    }

    console.log(
      `\n${dryRun ? '[dry run] ' : ''}TOTP secrets: ` +
        `${migrated} ${dryRun ? 'would be ' : ''}re-encrypted, ` +
        `${current} already current, ${failed} unreadable.`,
    );

    if (failed > 0) {
      console.error(
        '\nThose accounts cannot be recovered by rotation — their secret was encrypted\n' +
          'with a key that is no longer configured. Reset their second factor.',
      );
    }

    const remaining = failed + (dryRun ? migrated : 0);

    if (remaining === 0) {
      console.log(
        '\nNothing remains under the previous key. Safe to remove\n' +
          'FIELD_ENCRYPTION_KEY_PREVIOUS in the next deploy.',
      );
    }

    // Non-zero when something still needs attention, so CI or a deploy step can gate.
    if (failed > 0) process.exitCode = 1;
  } finally {
    await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
  }
}

await main();
