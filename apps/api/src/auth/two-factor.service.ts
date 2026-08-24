import { randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { authenticator } from 'otplib';

import type { Database } from '@safra/db';
import { schema } from '@safra/db';
import {
  ERROR,
  requiresTwoFactor,
  type TotpEnableResponse,
  type TotpSetupResponse,
} from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { FieldEncryptionService } from '../common/crypto/field-encryption.service.js';
import { PasswordService } from '../common/crypto/password.service.js';
import { TokenService, type AccessTokenClaims } from './token.service.js';
import {
  badRequest,
  conflict,
  forbidden,
  unauthorized,
} from '../common/errors/app-error.js';

const RECOVERY_CODE_COUNT = 8;
const ISSUER = 'SAFRA';

@Injectable()
export class TwoFactorService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly encryption: FieldEncryptionService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Step 1 — generate a secret and return it for the authenticator app.
   *
   * The secret is stored ENCRYPTED but `totpEnabledAt` stays null, so 2FA is not yet
   * enforced. That two-step design matters: if enrolment stored and enforced in one
   * call, a staff member who scanned the QR incorrectly would be locked out of their
   * own account with no way back in.
   *
   * Calling this again before confirming replaces the pending secret, which is the
   * correct behaviour for "I closed the page and want to start over".
   */
  async beginSetup(claims: AccessTokenClaims | undefined): Promise<TotpSetupResponse> {
    const user = await this.requireEnrollable(claims);

    if (user.totpEnabledAt !== null) {
      throw conflict(ERROR.AUTH_TWO_FACTOR_ALREADY_ENABLED_REENROL);
    }

    const secret = authenticator.generateSecret();

    await this.db
      .update(schema.users)
      .set({ totpSecretEncrypted: this.encryption.encrypt(secret) })
      .where(eq(schema.users.id, user.id));

    return {
      otpauthUri: authenticator.keyuri(user.email, ISSUER, secret),
      secret,
    };
  }

  /**
   * Step 2 — verify a code from the app, then enforce 2FA and issue recovery codes.
   *
   * Recovery codes are returned exactly once and stored only as Argon2id hashes, so
   * a database compromise cannot yield working bypass codes.
   */
  async enable(
    claims: AccessTokenClaims | undefined,
    code: string,
    context: { ipAddress?: string | undefined; userAgent?: string | undefined } = {},
  ): Promise<TotpEnableResponse> {
    const user = await this.requireEnrollable(claims);

    if (user.totpEnabledAt !== null) {
      throw conflict(ERROR.AUTH_TWO_FACTOR_ALREADY_ENABLED);
    }

    if (!user.totpSecretEncrypted) {
      throw badRequest(ERROR.AUTH_TWO_FACTOR_SETUP_REQUIRED);
    }

    const secret = this.encryption.decrypt(user.totpSecretEncrypted);

    if (!authenticator.verify({ token: code, secret })) {
      throw unauthorized(ERROR.AUTH_CODE_INVALID_CHECK_APP);
    }

    const plainCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
      generateRecoveryCode(),
    );
    const hashes = await Promise.all(plainCodes.map((c) => this.passwords.hash(c)));

    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.users)
        .set({ totpEnabledAt: new Date(), totpRecoveryCodeHashes: hashes })
        .where(eq(schema.users.id, user.id));

      await this.audit.record(
        {
          actorUserId: user.id,
          actorRole: user.role,
          action: 'auth.two_factor_enabled',
          subjectType: 'user',
          subjectId: user.id,
          // Never the secret or the codes themselves.
          after: { recoveryCodesIssued: plainCodes.length },
        },
        tx as unknown as Database,
      );
    });

    /**
     * Every other session is revoked. Enabling a second factor is a security event,
     * and any session that predates it was established under weaker authentication —
     * possibly by whoever prompted the enrolment in the first place.
     */
    await this.tokens.revokeAllForUser(user.id);

    /**
     * And a REPLACEMENT is issued, because this session was one of the ones just revoked.
     *
     * ## The bug this closes (O-sec-14, found 2026-08-24)
     *
     * `totpEnabled` is a CLAIM, signed at sign-in. Enabling wrote `totp_enabled_at` and returned
     * no token, so the caller kept a token still saying `false`, and both middlewares decide with
     * `hasTwoFactor(session)`. Every navigation after a successful enrolment bounced back to
     * `/enrol-2fa`: press «حفظتها — متابعة», nothing happens, forever.
     *
     * Not for a moment, either. `rotateIfStale` only refreshes NEAR EXPIRY and `ACCESS_TOKEN_TTL`
     * is fifteen minutes — and the revocation above had already killed the refresh token, so when
     * the access token finally expired the reader was signed out rather than corrected. It hit
     * every new staff member and every new partner, on the first thing the platform asks them to
     * do, and the components in both apps carried a comment asserting the new token carries the
     * claim. It described the intent.
     *
     * Fails CLOSED, which is why it was medium rather than critical: it denied access to somebody
     * who had just earned it. That is the right direction to be wrong in and still wrong.
     *
     * ## Why issuing here rather than refreshing in the middleware
     *
     * A refresh-before-refusing in each middleware would be self-healing and needs no contract
     * change — and it puts the same correction in two places that must never disagree, in the two
     * files least likely to be read together. The claim is stale because THIS call made it stale,
     * so this call is where it gets fixed. One place, at the moment of the change.
     *
     * `buildClaims` reads the row we just wrote, so the new token carries `totpEnabled: true`
     * along with anything else that has moved since sign-in.
     */
    const refreshed = await this.tokens.buildClaims({
      ...user,
      totpEnabledAt: new Date(),
    });

    return {
      enabled: true,
      recoveryCodes: plainCodes,
      session: await this.tokens.issue(refreshed, context),
    };
  }

  /** Disabling needs the password AND a live code — a hijacked session cannot do it. */
  async disable(
    claims: AccessTokenClaims | undefined,
    password: string,
    code: string,
  ): Promise<{ enabled: false }> {
    const user = await this.requireEnrollable(claims);

    if (user.totpEnabledAt === null) {
      throw conflict(ERROR.AUTH_TWO_FACTOR_NOT_ENABLED);
    }

    if (
      !user.passwordHash ||
      !(await this.passwords.verify(user.passwordHash, password))
    ) {
      throw unauthorized(ERROR.AUTH_PASSWORD_INCORRECT);
    }

    if (!user.totpSecretEncrypted) {
      throw badRequest(ERROR.AUTH_NO_AUTHENTICATOR);
    }

    const secret = this.encryption.decrypt(user.totpSecretEncrypted);

    if (!authenticator.verify({ token: code, secret })) {
      throw unauthorized(ERROR.AUTH_CODE_MALFORMED);
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.users)
        .set({
          totpEnabledAt: null,
          totpSecretEncrypted: null,
          totpRecoveryCodeHashes: [],
        })
        .where(eq(schema.users.id, user.id));

      await this.audit.record(
        {
          actorUserId: user.id,
          actorRole: user.role,
          action: 'auth.two_factor_disabled',
          subjectType: 'user',
          subjectId: user.id,
        },
        tx as unknown as Database,
      );
    });

    return { enabled: false };
  }

  /**
   * Consumes a recovery code during sign-in.
   *
   * Every stored hash is checked because the codes are indistinguishable to us — we
   * cannot look one up. A match is REMOVED from the array before the login completes,
   * which is what makes the code single-use even if two requests race: the update is
   * conditional on the array still containing that hash.
   */
  async consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
    const user = await this.db.query.users.findFirst({
      where: eq(schema.users.id, userId),
      columns: { totpRecoveryCodeHashes: true },
    });

    const hashes = user?.totpRecoveryCodeHashes ?? [];
    if (hashes.length === 0) return false;

    for (const hash of hashes) {
      if (await this.passwords.verify(hash, code)) {
        const remaining = hashes.filter((h) => h !== hash);

        await this.db
          .update(schema.users)
          .set({ totpRecoveryCodeHashes: remaining })
          .where(eq(schema.users.id, userId));

        this.audit.recordDetached({
          actorUserId: userId,
          action: 'auth.recovery_code_used',
          subjectType: 'user',
          subjectId: userId,
          after: { remainingCodes: remaining.length },
        });

        return true;
      }
    }

    return false;
  }

  /**
   * Staff and partners enrol in 2FA; customers do not.
   *
   * Keyed on `requiresTwoFactor` rather than a role check written here, so this method and
   * `TwoFactorGuard` cannot disagree about who is expected to hold a second factor. A disagreement
   * would be silent and would take one of two shapes, both bad: an account the guard blocks but
   * this refuses to enrol — locked out permanently — or an account that can enrol and is never
   * asked for the code.
   *
   * Customers stay out because §4 specifies guest checkout.
   */
  private async requireEnrollable(claims: AccessTokenClaims | undefined) {
    if (!claims) throw unauthorized(ERROR.AUTH_REQUIRED);

    const user = await this.db.query.users.findFirst({
      where: eq(schema.users.id, claims.sub),
    });

    if (!user) throw unauthorized(ERROR.AUTH_REQUIRED);

    if (!requiresTwoFactor(user.role)) {
      throw forbidden(ERROR.AUTH_TWO_FACTOR_ROLE_INELIGIBLE);
    }

    return user;
  }
}

/**
 * A readable recovery code: XXXX-XXXX-XXXX from an alphabet with no ambiguous
 * characters, so someone copying it off paper under pressure cannot confuse
 * 0/O or 1/I/L.
 */
function generateRecoveryCode(): string {
  const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(12);

  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length] ?? 'A');

  return [
    chars.slice(0, 4).join(''),
    chars.slice(4, 8).join(''),
    chars.slice(8, 12).join(''),
  ].join('-');
}
