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
 * A customer signs in only after proving they hold the mailbox (Bashar, 2026-10-06: «Require
 * verification to sign in»).
 *
 * ## Why it matters beyond tidiness
 *
 * Registration takes any address. Without this, somebody could register with a stranger's email,
 * sign in, and act as that address on the platform — book under it, hold a wallet under it — and the
 * verification that later merges the stranger's guest bookings would be the only thing that ever
 * asked whether the mailbox was theirs.
 *
 * ## What each case pins
 *
 * - An unverified customer with the RIGHT password gets the dedicated code, so the form can say
 *   what to do and offer the link again.
 * - With the WRONG password they get the generic answer. The new code must not become an oracle
 *   for "this address registered and never verified".
 * - A verified customer is not refused, and neither is staff: staff and partner accounts are
 *   verified by the invitation that created them, and this rule is about customers.
 *
 * `TokenService` throws a marker from `buildClaims`, so reaching it means "the sign-in was allowed
 * past every refusal" without a JWT configuration in the test.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const REACHED_SESSION = 'reached-session-issue';

describeIfDb('sign-in requires a verified customer address', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  const passwords = new PasswordService();

  const service = new AuthService(
    db,
    passwords,
    {
      buildClaims: () => Promise.reject(new Error(REACHED_SESSION)),
    } as unknown as TokenService,
    {
      decryptForRotation: () => ({ plaintext: '', needsReEncryption: false }),
    } as unknown as FieldEncryptionService,
    {} as unknown as TwoFactorService,
    {} as unknown as LoginCodeService,
  );

  const PASSWORD = 'a-correct-password-1';

  beforeEach(async () => {
    await harness.begin();
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  async function account(role: string, verified: boolean): Promise<string> {
    const email = `verify-gate-${crypto.randomUUID()}@safra.test`;
    const hash = await passwords.hash(PASSWORD);

    await db.execute(sql`
      INSERT INTO users (email, phone, role, status, preferred_locale, password_hash,
                         email_verified_at)
      VALUES (${email}, '+963900000000', ${role}::user_role, 'active', 'ar', ${hash},
              ${verified ? sql`now()` : sql`NULL`})
    `);

    return email;
  }

  /** The code a refusal carries, or the marker when the sign-in got through. */
  async function outcome(
    email: string,
    password = PASSWORD,
  ): Promise<string | undefined> {
    return service.login({ email, password }, {}).then(
      () => 'signed-in',
      (error: { message?: string; response?: { code?: string } }) =>
        error.response?.code ?? error.message,
    );
  }

  it('refuses an unverified customer with the dedicated code', async () => {
    const email = await account('customer', false);

    expect(await outcome(email)).toBe('auth.email_unverified');
  });

  it('answers 403, not 401: the credentials were right', async () => {
    const email = await account('customer', false);

    const status = await service
      .login({ email, password: PASSWORD }, {})
      .catch((error: { getStatus?: () => number }) => error.getStatus?.());

    expect(status).toBe(403);
  });

  it('does not reveal an unverified account to somebody without the password', async () => {
    const email = await account('customer', false);

    expect(await outcome(email, 'not-the-password')).toBe('auth.credentials_invalid');
  });

  it('does not count the refusal as a failed attempt', async () => {
    const email = await account('customer', false);

    await outcome(email);

    const row = await db.execute<{ attempts: number }>(
      sql`SELECT failed_login_attempts AS attempts FROM users WHERE email = ${email}`,
    );
    expect(row.rows[0]?.attempts).toBe(0);
  });

  /* The control: the gate is about verification, not about customers. */
  it('lets a verified customer through', async () => {
    const email = await account('customer', true);

    expect(await outcome(email)).toBe(REACHED_SESSION);
  });

  /*
    Staff are verified by the invitation that made them, but a hand-made or legacy staff row with no
    timestamp must not be locked out of the console by a customer rule.
  */
  it('does not apply to a staff account', async () => {
    const email = await account('support_agent', false);

    expect(await outcome(email)).toBe(REACHED_SESSION);
  });
});
