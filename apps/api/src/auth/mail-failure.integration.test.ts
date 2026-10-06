import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { PasswordService } from '../common/crypto/password.service.js';
import type { Env } from '../config/env.js';
import type { FxRateService } from '../fx/fx-rate.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { MailService } from '../mail/mail.service.js';
import { WalletService } from '../wallet/wallet.service.js';
import { AccountRecoveryService } from './account-recovery.service.js';
import { AuthTokenService } from './auth-token.service.js';
import { LoginCodeService } from './login-code.service.js';
import type { TokenService } from './token.service.js';

/**
 * A mail server that refuses, on every auth path that sends from inside a request.
 *
 * REGRESSION (2026-10-06). `MailService.send` rethrows since 2026-09-06 so the queue can retry,
 * and these callers sent with a bare `await` after their own work had committed:
 *
 *  - a password reset issued its token, then 500'd and never wrote its audit row;
 *  - registering a NEW address 500'd (the verification mail) while a TAKEN one answered 202 — or
 *    the reverse — which is the enumeration oracle `POST /auth/register` was rebuilt to close;
 *  - a partner's sign-in code was stored and the sign-in answered 500.
 *
 * The transport is a REAL `MailService` pointed at a port nothing listens on, so the failure is
 * nodemailer's own connection refusal, not a stub's idea of one.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('auth mail that cannot be delivered', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  const passwords = new PasswordService();

  const refusing = new MailService({
    MAIL_FROM: 'safra@example.test',
    SMTP_URL: 'smtp://127.0.0.1:1',
  } as unknown as Env);

  const fx = {
    rateToSyp: () => Promise.resolve('13000.00000000'),
    decimalsOf: () => Promise.resolve(2),
  } as unknown as FxRateService;

  const recovery = new AccountRecoveryService(
    db,
    { APP_URL: 'https://safra.test' } as unknown as Env,
    new AuthTokenService(db),
    passwords,
    { revokeAllForUser: () => Promise.resolve() } as unknown as TokenService,
    refusing,
    new AuditService(db),
    new WalletService(db, fx),
    new LedgerService(db),
    fx,
  );

  const loginCodes = new LoginCodeService(db, passwords, refusing);

  let user = { id: '', email: '' };

  beforeEach(async () => {
    await harness.begin();

    const id = randomUUID();
    user = { id, email: `mail-failure-${id.slice(0, 8)}@safra.test` };

    await db.execute(sql`
      INSERT INTO users (id, email, password_hash, role, preferred_locale)
      VALUES (${id}::uuid, ${user.email}, ${await passwords.hash('the-original-password')},
              'customer', 'en')`);
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  /** The control: the transport really does refuse, so a green below is not a stub being kind. */
  it('is a transport that throws on send', async () => {
    await expect(
      refusing.send({ to: user.email, subject: 'probe', text: 'probe' }),
    ).rejects.toThrow();
  });

  it('answers a password reset the same way, and still writes its audit row', async () => {
    await expect(recovery.requestPasswordReset(user.email, {})).resolves.toBeUndefined();

    const audited = await db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM audit_log
      WHERE action = 'auth.password_reset_requested' AND subject_id = ${user.id}::uuid`);

    expect(audited.rows[0]?.n).toBe(1);
  });

  /**
   * Both branches of `POST /auth/register` resolve. The controller answers `202 { ok: true }` after
   * whichever one it awaited, so resolving is the whole of what must be equal.
   */
  it('resolves on the new-address branch and the taken-address branch alike', async () => {
    await expect(recovery.requestEmailVerification(user.id, {})).resolves.toBeUndefined();
    await expect(recovery.notifyAccountExists(user.email, 'en')).resolves.toBeUndefined();
  });

  it('keeps the sign-in code it issued when the mail cannot carry it', async () => {
    await expect(
      loginCodes.issue(user.id, user.email, 'ar', {}),
    ).resolves.toBeUndefined();

    const live = await db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM login_codes
      WHERE user_id = ${user.id}::uuid AND consumed_at IS NULL`);

    expect(live.rows[0]?.n).toBe(1);
  });
});
