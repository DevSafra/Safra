import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import type { Database } from '@safra/db';

import { AuthService, SecondFactorRequiredException } from './auth.service.js';
import type { FieldEncryptionService } from '../common/crypto/field-encryption.service.js';
import type { PasswordService } from '../common/crypto/password.service.js';
import type { LoginCodeService } from './login-code.service.js';
import type { TokenService } from './token.service.js';
import type { TwoFactorService } from './two-factor.service.js';

/**
 * The distinction between "credentials rejected" and "second factor outstanding".
 *
 * Two callers depend on telling these apart, and both fail quietly if the distinction
 * erodes:
 *
 * - the staff sign-in form advances to its second step only for the latter;
 * - `AuthController` must NOT audit the latter as a failed login. Auditing it put one
 *   `auth.login_failed` row against every successful staff sign-in, which made it look
 *   as though everyone fails once and buried the real failure pattern §15 exists to
 *   expose.
 *
 * A distinct exception type carries that, rather than a message string the callers
 * match on — a message is easy to reword and the breakage would be invisible.
 */
describe('AuthService.login — second factor outstanding', () => {
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

  /**
   * `Partial<typeof STAFF>` cannot express "totpEnabledAt is null", because the fixture
   * types it as `Date`. Widening the override type keeps the null case expressible
   * without loosening the fixture itself.
   */
  function service(user: Record<string, unknown> = {}) {
    const db = {
      query: { users: { findFirst: () => Promise.resolve({ ...STAFF, ...user }) } },
      update: () => ({ set: () => ({ where: () => Promise.resolve(undefined) }) }),
    } as unknown as Database;

    return new AuthService(
      db,
      {
        verify: () => Promise.resolve(true),
        verifyDummy: () => Promise.resolve(undefined),
      } as unknown as PasswordService,
      {} as unknown as TokenService,
      {
        decryptForRotation: () => ({
          plaintext: 'JBSWY3DPEHPK3PXP',
          needsReEncryption: false,
        }),
        encrypt: (v: string) => v,
      } as unknown as FieldEncryptionService,
      {} as unknown as TwoFactorService,
      /*
      Never reached: every path here either has no second factor or has an authenticator enrolled,
      and a partner without one is what `login-code.service` covers in its own suite.
    */
      {} as unknown as LoginCodeService,
    );
  }

  const credentials = { email: 'ops@safra.test', password: 'a-correct-password-1' };

  it('throws the dedicated type when no code is supplied', async () => {
    await expect(service().login(credentials, {})).rejects.toBeInstanceOf(
      SecondFactorRequiredException,
    );
  });

  /**
   * Still a 401 to the client. The two-step form reads the message to decide whether to
   * advance, and an unenrolled or non-staff caller must not be able to tell the
   * difference from any other unauthorised response.
   */
  it('is still an UnauthorizedException, so the HTTP status is unchanged', async () => {
    await expect(service().login(credentials, {})).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('says what is missing, so the form can advance on it', async () => {
    const message = await service()
      .login(credentials, {})
      .catch((error: Error) => error.message);

    expect(message).toMatch(/authenticator code required/i);
  });

  describe('what must NOT be this type', () => {
    /**
     * The whole point of the type is that the controller skips the audit row for it.
     * If a genuinely wrong code were also this type, real failed sign-ins would stop
     * being recorded — a silent hole in the audit trail rather than a visible bug.
     */
    it('a wrong code is a plain failure, not an outstanding factor', async () => {
      await expect(
        service().login({ ...credentials, totpCode: '000000' }, {}),
      ).rejects.not.toBeInstanceOf(SecondFactorRequiredException);
    });

    it('an account with no second factor never reaches this path', async () => {
      /**
       * `totpEnabledAt: null` means the guard is not applicable, so login proceeds and
       * fails later on the stubbed token service — anything except this type.
       */
      await expect(
        service({ totpEnabledAt: null }).login(credentials, {}),
      ).rejects.not.toBeInstanceOf(SecondFactorRequiredException);
    });
  });

  /**
   * Partners, mandatory since 2026-08-07.
   *
   * The login path asks `requiresTwoFactor`, not `isStaffRole`. Before that change an enrolled
   * partner was never asked for their code — the account would have carried a second factor that
   * sign-in ignored, which is worse than having none, because the partner believes they are
   * protected.
   */
  describe('partners', () => {
    it('demands the code from an enrolled partner', async () => {
      await expect(
        service({ role: 'partner' }).login(credentials, {}),
      ).rejects.toBeInstanceOf(SecondFactorRequiredException);
    });

    /*
      Requirement 1, the migration case. An existing partner has no enrolment, so sign-in must
      still succeed — otherwise making 2FA mandatory locks out every partner who has one on the day
      it ships, and none of them can enrol, because enrolling needs a session. `TwoFactorGuard` is
      what makes that session useless for anything but enrolment.
    */
    it('lets an unenrolled partner sign in, so they can reach enrolment', async () => {
      await expect(
        service({ role: 'partner', totpEnabledAt: null }).login(credentials, {}),
      ).rejects.not.toBeInstanceOf(SecondFactorRequiredException);
    });

    /* §4 specifies guest checkout: a customer is never asked, enrolled or not. */
    it('never demands a code from a customer', async () => {
      await expect(
        service({ role: 'customer' }).login(credentials, {}),
      ).rejects.not.toBeInstanceOf(SecondFactorRequiredException);
    });
  });
});
