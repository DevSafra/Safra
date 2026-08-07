import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { authenticator } from 'otplib';

import { errorMessage } from '@safra/i18n';
import type { Database } from '@safra/db';
import { schema } from '@safra/db';
import {
  ERROR,
  type AuthUser,
  type LoginInput,
  type RegisterInput,
  requiresTwoFactor,
} from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import { FieldEncryptionService } from '../common/crypto/field-encryption.service.js';
import { PasswordService } from '../common/crypto/password.service.js';
import { TokenService, type IssuedTokens } from './token.service.js';
import { TwoFactorService } from './two-factor.service.js';
import { conflict, unauthorized, unavailable } from '../common/errors/app-error.js';

/**
 * Thrown when credentials were ACCEPTED and only the second factor is outstanding.
 *
 * A distinct type rather than a message the caller matches on, because two callers now
 * need to tell this apart from a real failure: the sign-in form, which advances to its
 * second step, and the controller, which must NOT audit it as a failed login. It is an
 * incomplete attempt, not a rejected one — the password was right.
 */
export class SecondFactorRequiredException extends UnauthorizedException {
  /**
   * Carries the standard error body, so the sign-in form can advance on a CODE.
   *
   * It used to take a message and pass it to `super(message)`, which produced
   * `{ message, error, statusCode }` and no `code` — so the console detected "credentials
   * were right, now ask for the code" by regex-matching the English prose. This is the one
   * error in the product where getting that wrong means nobody can sign in at all, and it
   * was the only exception the code migration missed, because it is a custom subclass rather
   * than one of Nest's.
   */
  constructor() {
    super({
      statusCode: HttpStatus.UNAUTHORIZED,
      code: ERROR.AUTH_CODE_REQUIRED,
      message: errorMessage(ERROR.AUTH_CODE_REQUIRED, 'en'),
    });
  }
}

/** Rule 1: lock out after repeated failures rather than allowing endless guesses. */
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

export interface AuthResult {
  tokens: IssuedTokens;
  user: AuthUser;
}

export interface RequestContext {
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly encryption: FieldEncryptionService,
    private readonly twoFactor: TwoFactorService,
  ) {}

  /**
   * Customer self-registration. The role is hardcoded to 'customer' and is NOT
   * taken from the payload — the request schema is .strict() so a `role` field is
   * rejected outright, and even if it slipped through it would be ignored here.
   * Two independent barriers, because privilege escalation via mass assignment is
   * the single most common way registration endpoints are broken.
   */
  async register(input: RegisterInput, context: RequestContext): Promise<AuthResult> {
    const existing = await this.db.query.users.findFirst({
      where: and(eq(schema.users.email, input.email), isNull(schema.users.deletedAt)),
      columns: { id: true },
    });

    if (existing) {
      // An honest 409 here is a deliberate trade-off: the registration form
      // already reveals whether an email is taken by design, so pretending
      // otherwise adds no privacy while making the UX incoherent. The LOGIN path
      // stays strictly non-committal — that is where enumeration actually matters.
      throw conflict(ERROR.AUTH_EMAIL_TAKEN);
    }

    const passwordHash = await this.passwords.hash(input.password);

    const result = await this.db.transaction(async (tx) => {
      const [user] = await tx
        .insert(schema.users)
        .values({
          email: input.email,
          phone: input.phone,
          passwordHash,
          role: 'customer',
          preferredLocale: input.preferredLocale,
        })
        .returning();

      if (!user) {
        throw new Error('User insert returned no row.');
      }

      const [profile] = await tx
        .insert(schema.customerProfiles)
        .values({
          userId: user.id,
          fullName: input.fullName,
          email: input.email,
          phone: input.phone,
          preferredLocale: input.preferredLocale,
          isGuest: false,
        })
        .returning({ id: schema.customerProfiles.id });

      if (!profile) {
        throw new Error('Customer profile insert returned no row.');
      }

      // Every customer gets a wallet up front, so SLA compensation (§6.4) never
      // has to create one mid-incident.
      await tx.insert(schema.wallets).values({
        customerProfileId: profile.id,
        balance: '0',
        currencyId: await resolveDefaultCurrencyId(tx),
      });

      return user;
    });

    return this.completeLogin(result, context);
  }

  /**
   * Sign-in.
   *
   * Every failure path returns the SAME message and takes comparable time. The
   * response never distinguishes "no such account" from "wrong password" —
   * otherwise the endpoint becomes a customer-list oracle.
   */
  async login(input: LoginInput, context: RequestContext): Promise<AuthResult> {
    const genericFailure = unauthorized(ERROR.AUTH_CREDENTIALS_INVALID);

    const user = await this.db.query.users.findFirst({
      where: and(eq(schema.users.email, input.email), isNull(schema.users.deletedAt)),
    });

    if (!user || !user.passwordHash) {
      // Spend the same CPU as a real verification before failing.
      await this.passwords.verifyDummy(input.password);
      throw genericFailure;
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw unauthorized(ERROR.AUTH_LOCKED);
    }

    if (user.status !== 'active') {
      // Deliberately generic: a suspended account should not be confirmable.
      throw genericFailure;
    }

    const passwordValid = await this.passwords.verify(user.passwordHash, input.password);

    if (!passwordValid) {
      await this.registerFailedAttempt(user.id);
      throw genericFailure;
    }

    /*
      Second factor (rule 1), for staff and — since 2026-08-07 — partners. Checked AFTER the
      password so a valid TOTP alone is never sufficient, and so TOTP state does not leak for a
      wrong password.

      Still conditional on the account HAVING enrolled, which is what lets an existing partner sign
      in at all on the day the requirement lands. The session they receive is gated by
      `TwoFactorGuard` down to enrolment and nothing else, so "may sign in" and "may act" are two
      different questions with two different answers.
    */
    if (requiresTwoFactor(user.role) && user.totpEnabledAt && user.totpSecretEncrypted) {
      if (!input.totpCode && !input.recoveryCode) {
        throw new SecondFactorRequiredException();
      }

      if (input.recoveryCode) {
        // A recovery code is single-use and consumed here, whether or not the rest
        // of the login succeeds — a code that has been transmitted is spent.
        const accepted = await this.twoFactor.consumeRecoveryCode(
          user.id,
          input.recoveryCode,
        );

        if (!accepted) {
          await this.registerFailedAttempt(user.id);
          throw unauthorized(ERROR.AUTH_RECOVERY_CODE_INVALID);
        }
      } else {
        let secret: string;

        try {
          const decrypted = this.encryption.decryptForRotation(user.totpSecretEncrypted);
          secret = decrypted.plaintext;

          /**
           * Migrated opportunistically (S-6). The secret still lives under the retired
           * key, so it is rewritten under the current one now that we hold the
           * plaintext. Rotation therefore completes by itself for anyone who signs in,
           * and `pnpm rotate:encryption-key` only has to sweep up the dormant accounts.
           *
           * Not awaited into the login path's critical section — a failed re-encrypt
           * must never turn a valid sign-in into an error. The next login retries it.
           */
          if (decrypted.needsReEncryption) {
            void this.reEncryptTotpSecret(user.id, secret);
          }
        } catch (error) {
          /**
           * The stored secret cannot be decrypted — which means the key is wrong, not
           * that the person is.
           *
           * Almost always `FIELD_ENCRYPTION_KEY` differing from the one that encrypted
           * the row: a mistyped secret, an environment promoted with the wrong value,
           * or a rotation performed without re-encrypting. Left unhandled it surfaced
           * as a bare 500 with "Internal server error", identical for every staff
           * account, and nothing anywhere named the key. An operator would reasonably
           * conclude the database or the API was broken.
           *
           * Logged loudly and named precisely; the client gets 503 rather than 401,
           * because "try again with the right code" is wrong advice — no code will
           * ever work until the configuration is fixed.
           */
          this.logger.error(
            `Cannot decrypt the stored TOTP secret for user ${user.id}. This is a ` +
              `configuration fault, not a bad code: FIELD_ENCRYPTION_KEY does not ` +
              `match the key the secret was encrypted with. Every staff sign-in will ` +
              `fail until it does. ` +
              `(${error instanceof Error ? error.message : String(error)})`,
          );

          throw unavailable(ERROR.AUTH_UNAVAILABLE);
        }

        if (!authenticator.verify({ token: input.totpCode as string, secret })) {
          await this.registerFailedAttempt(user.id);
          throw unauthorized(ERROR.AUTH_CODE_INVALID);
        }
      }
    }

    await this.db
      .update(schema.users)
      .set({ failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() })
      .where(eq(schema.users.id, user.id));

    return this.completeLogin(user, context);
  }

  async refresh(refreshToken: string, context: RequestContext): Promise<AuthResult> {
    const rotated = await this.tokens.rotate(refreshToken, context);

    if (!rotated) {
      throw unauthorized(ERROR.AUTH_SESSION_EXPIRED);
    }

    const user = await this.db.query.users.findFirst({
      where: eq(schema.users.id, rotated.claims.sub),
      columns: { id: true, email: true, role: true, preferredLocale: true },
    });

    if (!user) {
      throw unauthorized(ERROR.AUTH_SESSION_EXPIRED);
    }

    return {
      tokens: rotated.tokens,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        preferredLocale: user.preferredLocale as AuthUser['preferredLocale'],
        permissions: rotated.claims.permissions,
      },
    };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (refreshToken) {
      await this.tokens.revoke(refreshToken);
    }
  }

  private async completeLogin(
    user: typeof schema.users.$inferSelect,
    context: RequestContext,
  ): Promise<AuthResult> {
    const claims = await this.tokens.buildClaims(user);
    const tokens = await this.tokens.issue(claims, context);

    return {
      tokens,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        preferredLocale: user.preferredLocale as AuthUser['preferredLocale'],
        permissions: claims.permissions,
      },
    };
  }

  /**
   * Counter increments in SQL rather than read-modify-write, so concurrent
   * guesses cannot race each other into an undercount.
   */
  /**
   * Rewrites a TOTP secret under the current key.
   *
   * Failure is logged and swallowed: this runs alongside a successful sign-in, and
   * the person signing in has nothing to do with it. The value stays readable via the
   * retired key until it succeeds, so the only cost of a failure is that rotation is
   * not yet finished for this account.
   */
  private async reEncryptTotpSecret(userId: string, secret: string): Promise<void> {
    try {
      await this.db
        .update(schema.users)
        .set({ totpSecretEncrypted: this.encryption.encrypt(secret) })
        .where(eq(schema.users.id, userId));

      this.logger.log(`Re-encrypted the TOTP secret for user ${userId} (key rotation).`);
    } catch (error) {
      this.logger.error(
        `Could not re-encrypt the TOTP secret for user ${userId}; it remains under ` +
          `the previous key and will be retried on the next sign-in. ` +
          `(${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }

  private async registerFailedAttempt(userId: string): Promise<void> {
    await this.db
      .update(schema.users)
      .set({
        failedLoginAttempts: sql`${schema.users.failedLoginAttempts} + 1`,
        lockedUntil: sql`
          CASE WHEN ${schema.users.failedLoginAttempts} + 1 >= ${MAX_FAILED_ATTEMPTS}
               THEN now() + interval '${sql.raw(String(LOCKOUT_MINUTES))} minutes'
               ELSE ${schema.users.lockedUntil}
          END
        `,
      })
      .where(eq(schema.users.id, userId));
  }
}

/**
 * The platform's accounting currency (§1.4). Read from the database rather than
 * hardcoded so an admin can add currencies without a deploy (P-005).
 */
async function resolveDefaultCurrencyId(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
): Promise<string> {
  const currency = await tx.query.currencies.findFirst({
    where: eq(schema.currencies.code, 'USD'),
    columns: { id: true },
  });

  if (!currency) {
    throw new Error('Default currency USD is missing. Run the database seed first.');
  }

  return currency.id;
}
