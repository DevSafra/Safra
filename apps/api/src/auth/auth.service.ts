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
  requiresAuthenticator,
  requiresTwoFactor,
} from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import { FieldEncryptionService } from '../common/crypto/field-encryption.service.js';
import { PasswordService } from '../common/crypto/password.service.js';
import { LoginCodeService } from './login-code.service.js';
import { TokenService, type IssuedTokens } from './token.service.js';
import { TwoFactorService } from './two-factor.service.js';
import { unauthorized, unavailable } from '../common/errors/app-error.js';

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

/**
 * Thrown when the password was accepted and a code has been EMAILED (Bashar, 2026-08-20).
 *
 * A sibling of `SecondFactorRequiredException`, not a reuse of it, because the two send the reader
 * to completely different places: one to an authenticator app, one to their inbox. A single
 * exception would make the sign-in form guess, and it would guess wrong for whichever kind of
 * partner is not the majority.
 */
export class EmailCodeSentException extends UnauthorizedException {
  constructor() {
    super({
      statusCode: HttpStatus.UNAUTHORIZED,
      code: ERROR.AUTH_EMAIL_CODE_SENT,
      message: errorMessage(ERROR.AUTH_EMAIL_CODE_SENT, 'en'),
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

/**
 * What registration did, for the CONTROLLER's eyes only.
 *
 * Never serialised. The controller uses it to decide which email to send and which audit row to
 * write, and answers the caller with the same generic body either way — see the note on
 * `register` about why.
 */
export interface RegistrationOutcome {
  created: boolean;
  userId: string;
  locale: string;
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
    private readonly loginCodes: LoginCodeService,
  ) {}

  /**
   * Customer self-registration. The role is hardcoded to 'customer' and is NOT
   * taken from the payload — the request schema is .strict() so a `role` field is
   * rejected outright, and even if it slipped through it would be ignored here.
   * Two independent barriers, because privilege escalation via mass assignment is
   * the single most common way registration endpoints are broken.
   */
  async register(input: RegisterInput): Promise<RegistrationOutcome> {
    /*
      The password is hashed BEFORE the existence check, always, and the result is discarded when
      the address is taken.

      Argon2id dominates the cost of this endpoint — tens of milliseconds against a sub-millisecond
      indexed lookup — so hashing only on the create path would make "taken" measurably faster than
      "new". That is the same oracle the status code used to be, expressed as a stopwatch, and it
      would survive any amount of care taken over the response body.
    */
    const passwordHash = await this.passwords.hash(input.password);

    const existing = await this.db.query.users.findFirst({
      where: and(eq(schema.users.email, input.email), isNull(schema.users.deletedAt)),
      columns: { id: true, preferredLocale: true },
    });

    /*
      An address that is already registered gets the SAME answer as a new one (Bashar, 2026-08-07).

      This used to be `409 auth.email_taken`, justified on the grounds that a registration form
      reveals this by design. It does not have to: one request, no side effects and a definitive
      answer is the cheapest enumeration oracle a system can offer — cheaper than the lockout one
      closed the same day, which at least cost five requests and a denial of service.

      The difference moves into the inbox, where only the owner of the address can see it. The
      caller learns nothing; the owner learns they already have an account and gets links to sign
      in or reset. Nothing about their account changes, so a stranger triggering it is harmless.
    */
    if (existing) {
      return {
        created: false,
        userId: existing.id,
        locale: existing.preferredLocale ?? input.preferredLocale,
      };
    }

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
          /* Required by the schema, so it is always a choice the person actually made. */
          gender: input.gender,
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

    /*
      No tokens, and this is the price of the change.

      Registration used to sign the customer straight in. It cannot any more: the response has to
      be identical for a taken address, and returning a session for THAT address would sign the
      caller in as somebody else. So both paths answer "check your email", and the new customer
      signs in after verifying — one extra step, in exchange for the endpoint no longer answering
      "does this person have an account".
    */
    return { created: true, userId: result.id, locale: result.preferredLocale };
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

    /*
      The password is checked BEFORE the lock, and the order is a security decision (2026-08-07).

      `auth.locked` is a deliberate disclosure — somebody who cannot get in has to be told to wait
      rather than left retyping. But answering it to a caller who has NOT proved the password made
      it an account-enumeration oracle: five wrong guesses lock a real account and a sixth returns
      `auth.locked`, while an address that does not exist answers the generic message forever. Six
      requests to confirm anybody's registration, at the cost of denying them service.

      That oracle predates the throttling change and was made roughly four times faster by it — the
      per-IP ceiling on auth routes went from ten a minute to forty so a NAT'd office would stop
      starving itself, which also widened this. Rather than narrow the ceiling back and reintroduce
      the NAT problem, the oracle is closed: `auth.locked` now requires knowing the password, which
      is exactly the legitimate user who needs to hear it.

      The lockout itself is unchanged. A locked account still cannot sign in with the correct
      password, and a wrong guess against one still counts and extends it.
    */
    const passwordValid = await this.passwords.verify(user.passwordHash, input.password);

    if (!passwordValid) {
      await this.registerFailedAttempt(user.id);
      throw genericFailure;
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw unauthorized(ERROR.AUTH_LOCKED);
    }

    if (user.status !== 'active') {
      // Deliberately generic: a suspended account should not be confirmable.
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
    /**
     * A second factor the account did NOT have to enrol (Bashar, 2026-08-20).
     *
     * Reached by anyone who must prove a second factor and has no authenticator — in practice
     * every partner, since staff are still made to enrol one and customers are not asked for a
     * factor at all. A six-digit code goes to their inbox and the sign-in pauses exactly where it
     * pauses for TOTP.
     *
     * BELOW the password check and the lock check, so a code is never sent to an address on the
     * strength of a wrong password. That is not politeness — an endpoint that emails on a failed
     * guess is a way to post mail at anybody whose address you know.
     *
     * The branch is skipped once `emailCode` is present, because that request is the second half
     * of a sign-in already in progress; re-issuing here would invalidate the code being submitted.
     */
    if (
      requiresTwoFactor(user.role) &&
      !requiresAuthenticator(user.role) &&
      !user.totpEnabledAt
    ) {
      if (!input.emailCode) {
        await this.loginCodes.issue(
          user.id,
          user.email,
          user.preferredLocale ?? 'ar',
          context,
        );

        throw new EmailCodeSentException();
      }

      /* Throws on a wrong, spent or expired code — and counts the attempt against that code. */
      await this.loginCodes.verify(user.id, input.emailCode);
    }

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

  /**
   * Issues another sign-in code, or quietly does nothing.
   *
   * ## Every refusal is silent
   *
   * A wrong password, an unknown address, a customer, a partner with an authenticator — all return
   * without sending anything and without saying why. The caller learns nothing about who has an
   * account, which is the property `O-sec-2` established on registration and this endpoint would
   * otherwise give straight back.
   *
   * The one thing a caller CAN observe is the rate limit inside `LoginCodeService`, and that is
   * counted per ACCOUNT — so it only ever fires for somebody who has already proved the password.
   *
   * ## A failed attempt here counts toward the lockout
   *
   * It must. See the note on the check itself: without it this route is a password oracle the
   * lockout cannot see.
   */
  async resendLoginCode(
    input: { email: string; password: string },
    context: RequestContext,
  ): Promise<void> {
    const user = await this.db.query.users.findFirst({
      where: and(eq(schema.users.email, input.email), isNull(schema.users.deletedAt)),
    });

    if (!user?.passwordHash) {
      /* Same CPU as a real verification, so the silence is silent to a stopwatch too. */
      await this.passwords.verifyDummy(input.password);

      return;
    }

    /**
     * A wrong password here COUNTS toward the lockout, exactly as it does on `/auth/login`.
     *
     * The first version of this did not, reasoned as "a resend button should not be able to lock
     * somebody out of their own account". That reasoning was backwards, and it left a hole: this
     * endpoint verifies a password, so without the counter it is a password oracle that the
     * five-failure lockout — the control that does the heavy lifting against a targeted attack —
     * cannot see. An attacker could sit here guessing for ever.
     *
     * The button cannot lock anybody out, because a legitimate resend is pressed from step two by
     * somebody whose password was ALREADY accepted. A wrong password at this endpoint is never a
     * real partner; it is somebody guessing.
     */
    if (!(await this.passwords.verify(user.passwordHash, input.password))) {
      await this.registerFailedAttempt(user.id);

      return;
    }

    /* A locked account gets no code — the sign-in it would finish is refused anyway. */
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) return;

    if (user.status !== 'active') return;

    /* Only the accounts whose second factor IS an emailed code. */
    if (
      !requiresTwoFactor(user.role) ||
      requiresAuthenticator(user.role) ||
      user.totpEnabledAt
    ) {
      return;
    }

    await this.loginCodes.issue(
      user.id,
      user.email,
      user.preferredLocale ?? 'ar',
      context,
    );
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
