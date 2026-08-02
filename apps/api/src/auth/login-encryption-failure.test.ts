import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { Database } from '@safra/db';

import { AuthService } from './auth.service.js';
import type { FieldEncryptionService } from '../common/crypto/field-encryption.service.js';
import type { PasswordService } from '../common/crypto/password.service.js';
import type { TokenService } from './token.service.js';
import type { TwoFactorService } from './two-factor.service.js';

/**
 * What a staff sign-in does when the stored TOTP secret cannot be decrypted.
 *
 * Found on 2026-08-02 by running the API in a container with a `FIELD_ENCRYPTION_KEY`
 * that did not match the one the secrets were encrypted with. Every staff login
 * returned a bare `500 Internal server error`, identical for every account, and
 * nothing in the response or the logs named the key. An operator would reasonably
 * conclude the database or the API was broken and start looking in the wrong place.
 *
 * The realistic production trigger is not a typo — it is rotating
 * `FIELD_ENCRYPTION_KEY` without re-encrypting the stored secrets, which locks out
 * every staff account at once. See the future-work register: there is no rotation
 * procedure yet, and that is recorded as an operational gap.
 */
describe('AuthService.login when the TOTP secret cannot be decrypted', () => {
  const STAFF = {
    id: 'user-1',
    email: 'ops@safra.test',
    passwordHash: 'argon2-hash',
    role: 'super_admin',
    status: 'active',
    lockedUntil: null,
    totpEnabledAt: new Date(),
    totpSecretEncrypted: 'iv:tag:ciphertext',
    preferredLocale: 'en',
  };

  function service(overrides: { decrypt?: () => string } = {}) {
    /**
     * `registerFailedAttempt` runs on a wrong code, so the stub has to accept an
     * update. Without it the "wrong code" case fails on the stub rather than on the
     * assertion, which would make that test pass for the wrong reason.
     */
    const db = {
      query: { users: { findFirst: () => Promise.resolve(STAFF) } },
      update: () => ({ set: () => ({ where: () => Promise.resolve(undefined) }) }),
    } as unknown as Database;

    const passwords = {
      verify: () => Promise.resolve(true),
      verifyDummy: () => Promise.resolve(undefined),
    } as unknown as PasswordService;

    /**
     * `decryptForRotation` is what the login path calls, not `decrypt` — that changed
     * when key rotation landed (S-6), and this stub failing to keep up is exactly how
     * this test caught the change.
     */
    const decrypt =
      overrides.decrypt ??
      (() => {
        // Exactly what node's crypto throws for a key/ciphertext mismatch.
        throw new Error('Unsupported state or unable to authenticate data');
      });

    const encryption = {
      decrypt,
      decryptForRotation: () => ({ plaintext: decrypt(), needsReEncryption: false }),
      encrypt: (value: string) => value,
    } as unknown as FieldEncryptionService;

    return new AuthService(
      db,
      passwords,
      {} as unknown as TokenService,
      encryption,
      {} as unknown as TwoFactorService,
    );
  }

  const credentials = {
    email: 'ops@safra.test',
    password: 'a-correct-password-1',
    totpCode: '123456',
  };

  it('reports it as unavailable, not as a bad code', async () => {
    /**
     * 503 rather than 401 deliberately. "Try again with the right code" is wrong
     * advice — no code will ever work until the configuration is fixed, and telling
     * staff otherwise sends them to reset an authenticator that is not the problem.
     */
    await expect(service().login(credentials, {})).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('does not leak the reason to the client', async () => {
    const message = await service()
      .login(credentials, {})
      .catch((error: Error) => error.message);

    expect(message).not.toMatch(/decrypt|encryption|key|FIELD_ENCRYPTION/i);
  });

  it('names FIELD_ENCRYPTION_KEY in the server log so the cause is findable', async () => {
    const auth = service();
    const logger = (auth as unknown as { logger: { error: (m: string) => void } }).logger;
    const logged: string[] = [];

    vi.spyOn(logger, 'error').mockImplementation((message: unknown) => {
      logged.push(String(message));
    });

    await auth.login(credentials, {}).catch(() => undefined);

    expect(logged.join(' ')).toMatch(/FIELD_ENCRYPTION_KEY/);
  });

  /** A genuinely wrong code must still be a 401, or the fix has masked real failures. */
  it('still rejects a wrong code as unauthorised when decryption succeeds', async () => {
    const auth = service({ decrypt: () => 'JBSWY3DPEHPK3PXP' });

    await expect(auth.login(credentials, {})).rejects.toThrow(UnauthorizedException);
  });
});
