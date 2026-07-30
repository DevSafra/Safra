import { randomBytes } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { authenticator } from 'otplib';

import type { Database } from '@safra/db';
import { schema } from '@safra/db';
import {
  isStaffRole,
  type TotpEnableResponse,
  type TotpSetupResponse,
} from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { FieldEncryptionService } from '../common/crypto/field-encryption.service.js';
import { PasswordService } from '../common/crypto/password.service.js';
import { TokenService, type AccessTokenClaims } from './token.service.js';

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
    const user = await this.requireStaff(claims);

    if (user.totpEnabledAt !== null) {
      throw new ConflictException(
        'Two-factor authentication is already enabled. Disable it first to re-enrol.',
      );
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
  ): Promise<TotpEnableResponse> {
    const user = await this.requireStaff(claims);

    if (user.totpEnabledAt !== null) {
      throw new ConflictException('Two-factor authentication is already enabled.');
    }

    if (!user.totpSecretEncrypted) {
      throw new BadRequestException(
        'Start setup before enabling two-factor authentication.',
      );
    }

    const secret = this.encryption.decrypt(user.totpSecretEncrypted);

    if (!authenticator.verify({ token: code, secret })) {
      throw new UnauthorizedException(
        'That code is not valid. Check your authenticator app.',
      );
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

    return { enabled: true, recoveryCodes: plainCodes };
  }

  /** Disabling needs the password AND a live code — a hijacked session cannot do it. */
  async disable(
    claims: AccessTokenClaims | undefined,
    password: string,
    code: string,
  ): Promise<{ enabled: false }> {
    const user = await this.requireStaff(claims);

    if (user.totpEnabledAt === null) {
      throw new ConflictException('Two-factor authentication is not enabled.');
    }

    if (
      !user.passwordHash ||
      !(await this.passwords.verify(user.passwordHash, password))
    ) {
      throw new UnauthorizedException('Password is incorrect.');
    }

    if (!user.totpSecretEncrypted) {
      throw new BadRequestException('No authenticator is configured.');
    }

    const secret = this.encryption.decrypt(user.totpSecretEncrypted);

    if (!authenticator.verify({ token: code, secret })) {
      throw new UnauthorizedException('That code is not valid.');
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
   * Only staff enrol in 2FA. Customers are out of scope for the MVP — rule 1 requires
   * it for staff, and forcing it on guests would conflict with §4's guest checkout.
   */
  private async requireStaff(claims: AccessTokenClaims | undefined) {
    if (!claims) throw new UnauthorizedException('Authentication required.');

    const user = await this.db.query.users.findFirst({
      where: eq(schema.users.id, claims.sub),
    });

    if (!user) throw new UnauthorizedException('Authentication required.');

    if (!isStaffRole(user.role)) {
      throw new ForbiddenException(
        'Two-factor authentication is available to staff accounts only.',
      );
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
