import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import type { LoginCodeService } from './login-code.service.js';
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
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  /* Every row this suite writes is discarded when the test that wrote it ends. */
  const db: Database = harness.db;
  const passwords = new PasswordService();

  const service = new AuthService(
    db,
    passwords,
    {} as unknown as TokenService,
    {
      decryptForRotation: () => ({ plaintext: '', needsReEncryption: false }),
    } as unknown as FieldEncryptionService,
    {} as unknown as TwoFactorService,
    /*
      Never reached: every path here either has no second factor or has an authenticator enrolled,
      and a partner without one is what `login-code.service` covers in its own suite.
    */
    {} as unknown as LoginCodeService,
  );

  const PASSWORD = 'a-correct-password-1';
  let email = '';

  beforeEach(async () => {
    await harness.begin();

    email = `lockout-${crypto.randomUUID()}@safra.test`;
    const hash = await passwords.hash(PASSWORD);

    await db.execute(sql`
      INSERT INTO users (email, phone, role, status, preferred_locale, password_hash)
      VALUES (${email}, '+963900000000', 'customer', 'active', 'ar', ${hash})
    `);
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
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
    A locked account answers `auth.locked` — to somebody who knows the password.

    The disclosure is deliberate: a person who cannot get in has to be told to wait rather than
    left retyping. Requiring the password first is what stops it being an enumeration oracle; see
    the pair of tests below.
  */
  it('tells somebody with the right password that the account is locked', async () => {
    for (let i = 0; i < 5; i += 1) await wrong().catch(() => undefined);

    const code = await service
      .login({ email, password: PASSWORD }, {})
      .catch((error: { response?: { code?: string } }) => error.response?.code);

    expect(code).toBe('auth.locked');
  });

  /**
   * The enumeration oracle, closed 2026-08-07.
   *
   * Before the password was checked first, five wrong guesses locked a real account and a sixth
   * returned `auth.locked` — while an address that does not exist answered the generic message
   * forever. Six requests confirmed anybody's registration, at the cost of denying them service.
   *
   * Now a caller who does not know the password cannot tell a locked real account from an address
   * that was never registered. Asserted as an EQUALITY between the two, because that is the
   * property: not "it returns X" but "it returns the same thing either way".
   */
  it('does not reveal a locked account to somebody guessing passwords', async () => {
    for (let i = 0; i < 5; i += 1) await wrong().catch(() => undefined);

    const lockedReal = await wrong().catch(
      (error: { response?: { code?: string } }) => error.response?.code,
    );

    const neverRegistered = await service
      .login({ email: `ghost-${crypto.randomUUID()}@safra.test`, password: 'not-it' }, {})
      .catch((error: { response?: { code?: string } }) => error.response?.code);

    expect(lockedReal).toBe(neverRegistered);
    expect(lockedReal).toBe('auth.credentials_invalid');
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
  /**
   * The resend endpoint must not be a way AROUND the lockout.
   *
   * `POST /auth/login/resend-code` verifies a password, so if a wrong one there did not count, an
   * attacker could sit on it guessing for ever while `/auth/login` — the route the lockout
   * watches — stayed untouched. That is what the first version of it did (found 2026-08-20 in a
   * security pass over the emailed sign-in code, before it ever ran in anger).
   *
   * It cannot lock a real partner out: a legitimate resend is pressed from step two, by somebody
   * whose password has ALREADY been accepted. A wrong password here is always somebody guessing.
   */
  it('counts a wrong password at the resend endpoint toward the lockout', async () => {
    const resendWrong = () => service.resendLoginCode({ email, password: 'not-it' }, {});

    for (let i = 0; i < 5; i += 1) await resendWrong();

    const after = await state();

    expect(after?.attempts).toBe(5);
    expect(after?.locked_until).not.toBeNull();
  });

  /**
   * And a CORRECT password there never counts, so the button cannot lock its own user out.
   *
   * The fixture is a customer, so this account also returns early on the role check — a customer
   * has no second factor to resend. The assertion is therefore the narrow one it claims: the
   * counter does not move for a password that was right. That a partner with the right password
   * gets a code instead is proven in the browser, in `partner.spec.ts`.
   */
  it('never counts a correct password at the resend endpoint', async () => {
    await service.resendLoginCode({ email, password: PASSWORD }, {});

    expect((await state())?.attempts).toBe(0);
  });

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
