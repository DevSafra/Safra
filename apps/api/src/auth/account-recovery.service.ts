import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { ENV, type Env } from '../config/env.js';
import { MailService } from '../mail/mail.service.js';
import {
  accountExistsMail,
  emailVerificationMail,
  passwordResetMail,
} from '../mail/mail.templates.js';
import { PasswordService } from '../common/crypto/password.service.js';
import { WalletService } from '../wallet/wallet.service.js';
import { AuthTokenService } from './auth-token.service.js';
import { TokenService } from './token.service.js';
import { ERROR, WALLET_NOTE } from '@safra/contracts';
import { badRequest } from '../common/errors/app-error.js';

/** §4: long enough to act on, short enough that a leaked link goes stale fast. */
const RESET_TTL_MS = 60 * 60_000;
const VERIFY_TTL_MS = 24 * 60 * 60_000;

/** Per-account throttle, on top of the per-IP rate limit on the routes. */
const REQUEST_WINDOW_MS = 60 * 60_000;
const MAX_REQUESTS_PER_WINDOW = 5;

/**
 * Password reset and email verification (SRS §4).
 *
 * ## Requesting a reset never reveals whether an account exists
 *
 * `requestPasswordReset` returns nothing, always, whatever happened. Every branch —
 * unknown address, suspended account, throttled, sent — is indistinguishable from
 * outside. A "no account with that email" response would turn the endpoint into the
 * customer-list oracle that the login path is carefully built to avoid, and it would
 * be a strictly easier oracle because it needs no password guess at all.
 *
 * ## Resetting ends every other session
 *
 * The realistic reason someone resets a password is that they think somebody else
 * has it. Leaving existing refresh tokens alive would let the intruder keep the
 * account, which makes the reset theatre.
 */
@Injectable()
export class AccountRecoveryService {
  private readonly logger = new Logger(AccountRecoveryService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly authTokens: AuthTokenService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly wallet: WalletService,
  ) {}

  /**
   * Sends a reset link if the address belongs to an account.
   *
   * Returns void on every path on purpose — see the class note. The work is awaited
   * rather than detached so a mail-server stall shows up as a slow response instead
   * of a silently dropped email, and `MailService.send` never throws.
   */
  async requestPasswordReset(
    email: string,
    context: { ipAddress?: string | undefined; userAgent?: string | undefined },
  ): Promise<void> {
    const user = await this.findActiveUser(email);

    if (!user) {
      /**
       * Logged, not returned. Someone probing for valid addresses is worth seeing in
       * the logs (§15), and it is exactly what the response must not disclose.
       */
      this.logger.log(`Password reset requested for an unknown address.`);
      return;
    }

    const recent = await this.authTokens.countRecent(
      user.id,
      'password_reset',
      REQUEST_WINDOW_MS,
    );

    if (recent >= MAX_REQUESTS_PER_WINDOW) {
      /**
       * Silently ignored, and that is the point: an attacker cycling IPs to bury a
       * victim's inbox learns nothing, and the victim stops receiving mail they did
       * not ask for. The per-IP limiter on the route handles volume; this handles
       * one target.
       */
      this.logger.warn(`Password reset throttled for user ${user.id}.`);
      return;
    }

    const issued = await this.authTokens.issue(
      user.id,
      'password_reset',
      RESET_TTL_MS,
      context,
    );

    await this.mail.send(
      passwordResetMail({
        to: user.email,
        url: this.link('reset-password', issued.token, user.preferredLocale),
        locale: user.preferredLocale,
        expiresInMinutes: RESET_TTL_MS / 60_000,
      }),
    );

    await this.audit.record({
      actorUserId: user.id,
      action: 'auth.password_reset_requested',
      subjectType: 'user',
      subjectId: user.id,
      ...context,
    });
  }

  /**
   * Applies a new password and ends every session.
   *
   * A bad token is a 400 with a deliberately unhelpful message: expired, already
   * used, and never valid are the same answer, because distinguishing them tells a
   * guesser which of their attempts got closer.
   */
  async confirmPasswordReset(
    token: string,
    newPassword: string,
    context: { ipAddress?: string | undefined; userAgent?: string | undefined },
  ): Promise<void> {
    const redeemed = await this.authTokens.redeem(token, 'password_reset');

    if (!redeemed) {
      throw badRequest(ERROR.AUTH_RESET_LINK_INVALID);
    }

    const passwordHash = await this.passwords.hash(newPassword);

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE users
        SET password_hash = ${passwordHash},
            -- A successful reset clears a lockout. The person who was locked out by
            -- someone else's guessing is exactly who is resetting, and leaving them
            -- locked out of the password they just chose would be absurd.
            failed_login_attempts = 0,
            locked_until = NULL,
            updated_at = now()
        WHERE id = ${redeemed.userId}
      `);

      await this.audit.record(
        {
          actorUserId: redeemed.userId,
          action: 'auth.password_reset_completed',
          subjectType: 'user',
          subjectId: redeemed.userId,
          ...context,
        },
        tx as unknown as Database,
      );
    });

    /**
     * Every existing session dies. Someone resets a password because they believe
     * another person has it; leaving that person's refresh tokens alive would hand
     * them the account back.
     */
    await this.tokens.revokeAllForUser(redeemed.userId);

    this.logger.log(`Password reset completed for user ${redeemed.userId}.`);
  }

  /** Sends a verification link. Safe to call repeatedly; issuing supersedes. */
  async requestEmailVerification(
    userId: string,
    context: { ipAddress?: string | undefined; userAgent?: string | undefined } = {},
  ): Promise<void> {
    const rows = await this.db.execute<{
      email: string;
      preferred_locale: string;
      verified: boolean;
    }>(sql`
      SELECT email, preferred_locale, (email_verified_at IS NOT NULL) AS verified
      FROM users WHERE id = ${userId} AND deleted_at IS NULL
    `);

    const user = rows.rows[0];
    if (!user || user.verified) return;

    const recent = await this.authTokens.countRecent(
      userId,
      'email_verification',
      REQUEST_WINDOW_MS,
    );

    if (recent >= MAX_REQUESTS_PER_WINDOW) {
      this.logger.warn(`Email verification throttled for user ${userId}.`);
      return;
    }

    const issued = await this.authTokens.issue(
      userId,
      'email_verification',
      VERIFY_TTL_MS,
      context,
    );

    await this.mail.send(
      emailVerificationMail({
        to: user.email,
        url: this.link('verify-email', issued.token, user.preferred_locale),
        locale: user.preferred_locale,
        expiresInHours: VERIFY_TTL_MS / 3_600_000,
      }),
    );
  }

  /**
   * Marks the address verified and claims any guest bookings made with it.
   *
   * The claim is gated on verification precisely because it is a transfer of access:
   * without it, registering with a stranger's address would hand over every booking
   * they had made as a guest — their travel dates, their addresses, their totals.
   * Proving control of the inbox is the minimum bar for that, and it is why this
   * lives here rather than in `register`.
   */
  async confirmEmailVerification(token: string): Promise<{ claimedBookings: number }> {
    const redeemed = await this.authTokens.redeem(token, 'email_verification');

    if (!redeemed) {
      throw badRequest(ERROR.AUTH_CONFIRMATION_LINK_INVALID);
    }

    return this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE users
        SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now()
        WHERE id = ${redeemed.userId}
      `);

      const claimed = await this.claimGuestProfiles(
        tx as unknown as Database,
        redeemed.userId,
        redeemed.email,
      );

      await this.audit.record(
        {
          actorUserId: redeemed.userId,
          action: 'auth.email_verified',
          subjectType: 'user',
          subjectId: redeemed.userId,
          after: { claimedBookings: claimed },
        },
        tx as unknown as Database,
      );

      return { claimedBookings: claimed };
    });
  }

  /**
   * Moves guest bookings — and any guest wallet balance — onto the verified account.
   *
   * A guest checkout creates a `customer_profiles` row with no `user_id`. The
   * profiles are NOT merged: `customer_profiles_user_unique` allows exactly one
   * profile per user, so the account's own profile is the only possible destination.
   * The guest row stays where it is, emptied — it is referenced by timeline events
   * and audit rows that must keep resolving, and its `CUS-` reference may already
   * have been quoted to support.
   *
   * Re-running is harmless: the second pass finds no bookings and no balance left to
   * move, so the count is zero without needing a "claimed" flag.
   */
  private async claimGuestProfiles(
    tx: Database,
    userId: string,
    email: string,
  ): Promise<number> {
    const target = await tx.execute<{ id: string }>(sql`
      SELECT id FROM customer_profiles
      WHERE user_id = ${userId} AND deleted_at IS NULL
      LIMIT 1
    `);

    const destination = target.rows[0]?.id;

    // A staff or partner account has no customer profile, so there is nothing to
    // move bookings onto. Not an error — just not applicable.
    if (!destination) return 0;

    const orphans = await tx.execute<{ id: string }>(sql`
      SELECT id FROM customer_profiles
      WHERE user_id IS NULL
        AND is_guest = true
        AND lower(email) = lower(${email})
        AND deleted_at IS NULL
        AND id <> ${destination}
    `);

    if (orphans.rows.length === 0) return 0;

    /**
     * One statement per orphan rather than a single `= ANY(array)`.
     *
     * Drizzle's `sql` template does not bind a JavaScript array as a PostgreSQL
     * array literal, and the set here is tiny — a customer has one guest profile per
     * address in all but pathological cases. Looping is clearer than the casting
     * gymnastics an array bind would need.
     */
    let count = 0;

    for (const orphan of orphans.rows) {
      const moved = await tx.execute<{ count: string }>(sql`
        WITH relinked AS (
          UPDATE bookings
          SET customer_profile_id = ${destination}, updated_at = now()
          WHERE customer_profile_id = ${orphan.id}
          RETURNING id
        )
        SELECT COUNT(*)::text AS count FROM relinked
      `);

      count += Number(moved.rows[0]?.count ?? 0);

      await this.moveGuestBalance(tx, orphan.id, destination);
    }

    if (count > 0) {
      this.logger.log(`Claimed ${count} guest booking(s) for user ${userId}.`);
    }

    return count;
  }

  /**
   * Carries a guest wallet balance across to the claimed account.
   *
   * Easy to overlook and expensive to get wrong: §6.4 credits SLA compensation to
   * whichever profile made the booking, INCLUDING a guest one. Moving the bookings
   * but not the money would leave real compensation sitting on a profile the
   * customer can no longer reach — the same "money you cannot get at" problem the
   * wallet endpoints were built to end.
   *
   * Done as a debit and a matching credit rather than by repointing the wallet row,
   * so both statements explain themselves and the append-only trail stays intact.
   */
  private async moveGuestBalance(
    tx: Database,
    orphanId: string,
    destination: string,
  ): Promise<void> {
    const rows = await tx.execute<{ balance: string; currency_id: string }>(sql`
      SELECT balance::text AS balance, currency_id
      FROM wallets
      WHERE customer_profile_id = ${orphanId}
        AND deleted_at IS NULL
        AND balance > 0
    `);

    const wallet = rows.rows[0];
    if (!wallet) return;

    await this.wallet.debit(tx, {
      customerProfileId: orphanId,
      amount: wallet.balance,
      currencyId: wallet.currency_id,
      reason: 'profile_claim',
      note: WALLET_NOTE.CLAIMED_FROM_GUEST,
    });

    await this.wallet.credit(tx, {
      customerProfileId: destination,
      amount: wallet.balance,
      currencyId: wallet.currency_id,
      reason: 'profile_claim',
      note: WALLET_NOTE.CARRIED_TO_ACCOUNT,
    });

    this.logger.log(
      `Carried ${wallet.balance} from guest profile ${orphanId} to ${destination}.`,
    );
  }

  private async findActiveUser(
    email: string,
  ): Promise<{ id: string; email: string; preferredLocale: string } | null> {
    const rows = await this.db.execute<{
      id: string;
      email: string;
      preferred_locale: string;
    }>(sql`
      SELECT id, email, preferred_locale FROM users
      WHERE lower(email) = lower(${email})
        AND deleted_at IS NULL
        AND status = 'active'
        -- An account with no password cannot have one "reset"; it has never had one.
        AND password_hash IS NOT NULL
      LIMIT 1
    `);

    const row = rows.rows[0];
    if (!row) return null;

    return { id: row.id, email: row.email, preferredLocale: row.preferred_locale };
  }

  /**
   * Built from configured `APP_URL`, never from the request.
   *
   * A reset link assembled from a Host header is the classic host-header injection:
   * the attacker triggers a reset for the victim, the email arrives from the real
   * SAFRA with a link pointing at the attacker's domain, and the victim's token is
   * handed over by their own click.
   */
  /**
   * Tells the owner of an already-registered address that somebody tried to sign up with it.
   *
   * ## Why this is a mail and not a response
   *
   * `POST /auth/register` answers the same generic body for every address (Bashar, 2026-08-07), so
   * the only channel that can carry "you already have an account" is one that reaches the OWNER of
   * the address and nobody else. The caller learns nothing either way.
   *
   * ## No token, and nothing changes
   *
   * This mail carries plain links to sign in and to reset — no token of any kind. A stranger
   * triggering it therefore achieves nothing except sending somebody an email, and the recipient
   * has nothing to act on urgently, which is what the copy says.
   *
   * ## Not rate-limited HERE
   *
   * The register endpoint's own limits do that work: forty a minute per address and ten per
   * (address, account). Adding a second budget in this method would make the taken path measurably
   * different from the new one under load, which is the timing oracle the whole change exists to
   * close.
   */
  async notifyAccountExists(email: string, locale: string): Promise<void> {
    await this.mail.send(
      accountExistsMail({
        to: email,
        signInUrl: new URL(`/${locale}/login`, this.env.APP_URL).toString(),
        resetUrl: new URL(`/${locale}/forgot-password`, this.env.APP_URL).toString(),
        locale,
      }),
    );
  }

  private link(path: string, token: string, locale: string): string {
    const url = new URL(`/${locale}/${path}`, this.env.APP_URL);
    url.searchParams.set('token', token);

    return url.toString();
  }
}
