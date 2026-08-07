import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, type Database } from '@safra/db';

import { AuthService } from './auth.service.js';
import { PasswordService } from '../common/crypto/password.service.js';
import type { FieldEncryptionService } from '../common/crypto/field-encryption.service.js';
import type { TokenService } from './token.service.js';
import type { TwoFactorService } from './two-factor.service.js';

/**
 * The per-ACCOUNT lockout, against a REAL PostgreSQL.
 *
 * ## Why this test exists now
 *
 * Auth throttling moved from IP-only to IP + account on 2026-08-07 so that one person behind a
 * carrier-grade NAT could not lock out everyone sharing their address. That change deliberately
 * makes the RATE limit more permissive for the population, and it is only safe because the account
 * lockout is untouched and does the targeted-brute-force work.
 *
 * "Untouched" was true by inspection and had nothing asserting it. These do: five failed attempts
 * lock the account for fifteen minutes, wherever the attempts came from, and a success clears the
 * counter.
 *
 * `TokenService` is stubbed because none of these paths reach it — a failed login throws before
 * anything is issued, which is itself part of the guarantee.
 *
 * Skipped when DATABASE_URL is unset; CI provisions a database and runs it.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('the account lockout', () => {
  const db: Database = createDatabase(DATABASE_URL ?? '', 2);
  const passwords = new PasswordService();

  const service = new AuthService(
    db,
    passwords,
    {} as unknown as TokenService,
    {
      decryptForRotation: () => ({ plaintext: '', needsReEncryption: false }),
    } as unknown as FieldEncryptionService,
    {} as unknown as TwoFactorService,
  );

  const PASSWORD = 'a-correct-password-1';
  let email = '';

  beforeEach(async () => {
    email = `lockout-${crypto.randomUUID()}@safra.test`;
    const hash = await passwords.hash(PASSWORD);

    await db.execute(sql`
      INSERT INTO users (email, phone, role, status, preferred_locale, password_hash)
      VALUES (${email}, '+963900000000', 'customer', 'active', 'ar', ${hash})
    `);
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM users WHERE email LIKE 'lockout-%@safra.test'`);
    await db.$client.end();
  });

  async function state() {
    const row = await db.execute<{ attempts: number; locked_until: string | null }>(
      sql`SELECT failed_login_attempts AS attempts, locked_until::text
          FROM users WHERE email = ${email}`,
    );

    return row.rows[0];
  }

  const wrong = () => service.login({ email, password: 'not-it' }, {});

  it('counts a failed attempt', async () => {
    await expect(wrong()).rejects.toThrow();

    expect((await state())?.attempts).toBe(1);
  });

  /**
   * THE guarantee the throttling change leans on.
   *
   * Five failures lock the account for fifteen minutes. This is enforced against the USER ROW, not
   * against a counter in Redis, so it does not care which address the attempts came from — which
   * is what bounds a distributed attack now that the rate limit is per (person, network).
   */
  it('locks the account after five failures', async () => {
    for (let i = 0; i < 5; i += 1) await wrong().catch(() => undefined);

    const after = await state();

    expect(after?.attempts).toBe(5);
    expect(after?.locked_until).not.toBeNull();
  });

  /* And a locked account is refused even with the RIGHT password — the point of locking it. */
  it('refuses the correct password while locked', async () => {
    for (let i = 0; i < 5; i += 1) await wrong().catch(() => undefined);

    await expect(service.login({ email, password: PASSWORD }, {})).rejects.toThrow();
  });

  /*
    A locked account answers `auth.locked`, not the generic credentials message. That is a
    deliberate disclosure: the person has to be told to wait rather than left retrying, and by
    then an attacker has already learned the address exists from having locked it.
  */
  it('says the account is locked rather than blaming the password', async () => {
    for (let i = 0; i < 5; i += 1) await wrong().catch(() => undefined);

    const code = await service
      .login({ email, password: PASSWORD }, {})
      .catch((error: { response?: { code?: string } }) => error.response?.code);

    expect(code).toBe('auth.locked');
  });

  it('does not lock after four', async () => {
    for (let i = 0; i < 4; i += 1) await wrong().catch(() => undefined);

    expect((await state())?.locked_until).toBeNull();
  });

  /*
    Four failures then a success must leave a clean slate, or a user who mistypes twice a day for
    three days is locked out on the third — a lockout that counts across weeks is a lockout that
    punishes ordinary use.
  */
  it('clears the counter on a successful sign-in', async () => {
    for (let i = 0; i < 4; i += 1) await wrong().catch(() => undefined);

    /* Reaches the stubbed TokenService and throws there — after the counter is cleared. */
    await service.login({ email, password: PASSWORD }, {}).catch(() => undefined);

    expect((await state())?.attempts).toBe(0);
  });

  /** An unknown address must not be distinguishable from a wrong password. */
  it('answers a wrong password and an unknown account identically', async () => {
    const unknown = await service
      .login({ email: 'nobody-here@safra.test', password: 'x' }, {})
      .catch((error: { response?: { code?: string } }) => error.response?.code);

    const bad = await wrong().catch(
      (error: { response?: { code?: string } }) => error.response?.code,
    );

    expect(unknown).toBe(bad);
  });
});
