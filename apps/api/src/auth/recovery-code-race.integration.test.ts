import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { PasswordService } from '../common/crypto/password.service.js';
import { TwoFactorService } from './two-factor.service.js';

/**
 * A recovery code is single-use under a race, against a REAL PostgreSQL.
 *
 * ## The defect
 *
 * `consumeRecoveryCode` read the stored hashes, verified the code in JavaScript and wrote back the
 * array minus the match, unconditionally. Two sign-ins presenting the same code both read the
 * array before either wrote, both matched, and both were let in: a "single-use" code used twice.
 * The same read-then-overwrite also RESURRECTED codes: two different codes used at once each wrote
 * back an array still holding the other one.
 *
 * Both calls share the harness's one connection, which interleaves them at every await: both reads
 * complete before either Argon2id verification finishes, which is the interleaving that produced it.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('recovery codes under concurrency', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  const passwords = new PasswordService();

  const twoFactor = new TwoFactorService(
    db,
    {} as never,
    passwords,
    {} as never,
    new AuditService(db),
  );

  const CODES = ['aaaa-bbbb-cccc', 'dddd-eeee-ffff', 'gggg-hhhh-iiii'];
  let userId = '';

  beforeEach(async () => {
    await harness.begin();

    const hashes = await Promise.all(CODES.map((code) => passwords.hash(code)));
    const array = sql.join(
      hashes.map((hash) => sql`${hash}`),
      sql`, `,
    );

    const rows = await db.execute<{ id: string }>(sql`
      INSERT INTO users (email, phone, role, status, preferred_locale, password_hash,
                         email_verified_at, totp_recovery_code_hashes)
      VALUES (${`recovery-${crypto.randomUUID()}@safra.test`}, '+963900000000',
              'support_agent', 'active', 'ar', 'x', now(), ARRAY[${array}]::text[])
      RETURNING id
    `);

    userId = rows.rows[0]?.id ?? '';
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  async function remaining(): Promise<number> {
    const rows = await db.execute<{ n: number }>(sql`
      SELECT cardinality(totp_recovery_code_hashes) AS n FROM users WHERE id = ${userId}::uuid
    `);

    return Number(rows.rows[0]?.n ?? -1);
  }

  /* The control: one use works, and a second use afterwards does not. */
  it('accepts a code once', async () => {
    expect(await twoFactor.consumeRecoveryCode(userId, CODES[0] ?? '')).toBe(true);
    expect(await twoFactor.consumeRecoveryCode(userId, CODES[0] ?? '')).toBe(false);
    expect(await remaining()).toBe(2);
  });

  it('accepts the same code for only one of two concurrent sign-ins', async () => {
    const results = await Promise.all([
      twoFactor.consumeRecoveryCode(userId, CODES[0] ?? ''),
      twoFactor.consumeRecoveryCode(userId, CODES[0] ?? ''),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await remaining()).toBe(2);
  });

  it('does not resurrect a code when two different codes are used at once', async () => {
    const results = await Promise.all([
      twoFactor.consumeRecoveryCode(userId, CODES[0] ?? ''),
      twoFactor.consumeRecoveryCode(userId, CODES[1] ?? ''),
    ]);

    expect(results).toEqual([true, true]);
    expect(await remaining()).toBe(1);
    expect(await twoFactor.consumeRecoveryCode(userId, CODES[0] ?? '')).toBe(false);
    expect(await twoFactor.consumeRecoveryCode(userId, CODES[1] ?? '')).toBe(false);
  });
});
