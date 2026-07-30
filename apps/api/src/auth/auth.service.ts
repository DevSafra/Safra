import {
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { authenticator } from 'otplib';

import type { Database } from '@safra/db';
import { schema } from '@safra/db';
import {
  type AuthUser,
  type LoginInput,
  type RegisterInput,
  isStaffRole,
} from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import { FieldEncryptionService } from '../common/crypto/field-encryption.service.js';
import { PasswordService } from '../common/crypto/password.service.js';
import { TokenService, type IssuedTokens } from './token.service.js';
import { TwoFactorService } from './two-factor.service.js';

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
      throw new ConflictException('An account with this email already exists.');
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
    const genericFailure = new UnauthorizedException('Invalid email or password.');

    const user = await this.db.query.users.findFirst({
      where: and(eq(schema.users.email, input.email), isNull(schema.users.deletedAt)),
    });

    if (!user || !user.passwordHash) {
      // Spend the same CPU as a real verification before failing.
      await this.passwords.verifyDummy(input.password);
      throw genericFailure;
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new UnauthorizedException(
        'Account temporarily locked after repeated failed attempts. Try again later.',
      );
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

    // Staff 2FA (rule 1). Checked AFTER the password so a valid TOTP alone is
    // never sufficient, and so TOTP state does not leak for a wrong password.
    if (isStaffRole(user.role) && user.totpEnabledAt && user.totpSecretEncrypted) {
      if (!input.totpCode && !input.recoveryCode) {
        throw new UnauthorizedException('Authenticator code required.');
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
          throw new UnauthorizedException('Invalid recovery code.');
        }
      } else {
        const secret = this.encryption.decrypt(user.totpSecretEncrypted);

        if (!authenticator.verify({ token: input.totpCode as string, secret })) {
          await this.registerFailedAttempt(user.id);
          throw new UnauthorizedException('Invalid authenticator code.');
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
      throw new UnauthorizedException('Session expired. Please sign in again.');
    }

    const user = await this.db.query.users.findFirst({
      where: eq(schema.users.id, rotated.claims.sub),
      columns: { id: true, email: true, role: true, preferredLocale: true },
    });

    if (!user) {
      throw new UnauthorizedException('Session expired. Please sign in again.');
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
