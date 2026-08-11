import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import {
  ERROR,
  type PasswordChangeInput,
  type ProfileUpdateInput,
} from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { PasswordService } from '../common/crypto/password.service.js';
import { DATABASE } from '../database/database.module.js';
import { TokenService } from './token.service.js';
import type { AccessTokenClaims } from './token.service.js';
import { badRequest, notFound, unauthorized } from '../common/errors/app-error.js';

/**
 * What the customer account screens need about the person reading them.
 *
 * Handoff §6 asks for two things this answers together: a greeting by NAME («أهلاً رامي») and badges
 * on three of the eight sidebar items. Neither was reachable before — the session cookie carries
 * `id`, `email`, `role` and `permissions` but no name, and `GET /auth/me` echoes the token's claims
 * rather than reading `customer_profiles`.
 *
 * ## Why profile and counters in ONE answer
 *
 * The sidebar is on every account page, so whatever feeds it is fetched on every account page. Three
 * separate reads per navigation is what the console rejected on cost, and this project has already
 * been bitten by per-render request volume against a shared rate limit. One row, one round trip,
 * everything the frame needs — the same bargain the partner portal strikes with its profile read.
 *
 * ## It takes no id
 *
 * The customer profile id comes from the VERIFIED token, never from the request. "Show me somebody
 * else's account summary" is a question this endpoint cannot be asked — the same reasoning the
 * console's preferences endpoint records.
 */
@Injectable()
export class CustomerAccountService {
  private readonly logger = new Logger(CustomerAccountService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  async summary(claims: AccessTokenClaims | undefined) {
    if (!claims) throw unauthorized(ERROR.AUTH_REQUIRED);

    /*
      A customer, identified by the profile id the token carries.

      A staff member holds no `customerProfileId`, so they get the same 404 as a deleted profile —
      there is no customer account behind a staff token, and saying so in different words would only
      tell a caller which kind of principal they are.
    */
    const profileId = claims.customerProfileId;

    if (!profileId) throw notFound(ERROR.CUSTOMER_NOT_FOUND);

    /*
      One statement, three counters as scalar subqueries.

      Both counts are over ONE customer's rows through `bookings_customer_idx`
      (`customer_profile_id, created_at`), so neither grows with the size of the table — which is what
      rule 2 is about. An uncapped `count(*)` over a whole registry would be a different matter, and
      that is why the console caps its own.
    */
    const found = await this.db.execute<{
      reference: string;
      full_name: string;
      email: string;
      phone: string;
      preferred_locale: string;
      bookings_count: string;
      pending_reviews: string;
      wallet_balance: string | null;
      wallet_currency: string | null;
    }>(sql`
      SELECT cp.reference,
             cp.full_name,
             cp.email,
             cp.phone,
             cp.preferred_locale,
             (SELECT count(*) FROM bookings b
               WHERE b.customer_profile_id = cp.id
                 AND b.deleted_at IS NULL)::text        AS bookings_count,
             -- The same predicate pendingForCustomer uses, so the badge cannot disagree with the list.
             (SELECT count(*) FROM bookings b
               WHERE b.customer_profile_id = cp.id
                 AND b.status = 'completed'
                 AND b.deleted_at IS NULL
                 AND NOT EXISTS (
                   SELECT 1 FROM reviews r WHERE r.booking_id = b.id
                 ))::text                               AS pending_reviews,
             w.balance::text                            AS wallet_balance,
             cur.code                                   AS wallet_currency
      FROM customer_profiles cp
      LEFT JOIN wallets w      ON w.customer_profile_id = cp.id AND w.deleted_at IS NULL
      LEFT JOIN currencies cur ON cur.id = w.currency_id
      WHERE cp.id = ${profileId}
        AND cp.deleted_at IS NULL
      LIMIT 1
    `);

    const row = found.rows[0];

    if (!row) throw notFound(ERROR.CUSTOMER_NOT_FOUND);

    return {
      reference: row.reference,
      fullName: row.full_name,
      email: row.email,
      phone: row.phone,
      preferredLocale: row.preferred_locale,
      counters: {
        bookings: Number(row.bookings_count),
        pendingReviews: Number(row.pending_reviews),
        /*
          Absent rather than zero when there is no wallet row. A customer who has never been
          compensated has no wallet, which is not the same statement as a balance of nothing — and
          the badge should be missing rather than reading «0».
        */
        walletBalance: row.wallet_balance,
        walletCurrency: row.wallet_currency,
      },
    };
  }

  /**
   * Editing your own name and phone (handoff §6).
   *
   * ## It takes no id, and writes only the row the token names
   *
   * Same shape as the read above: the profile comes from `claims.customerProfileId`, so "rename that
   * person" is a request this cannot express. The `WHERE` carries the profile id as well as the update,
   * so even a wrong id in the claim could only ever touch its own row.
   *
   * ## Only the supplied fields
   *
   * `COALESCE(supplied, existing)` per column, so a PATCH with just a phone leaves the name alone. The
   * contract already refuses an empty body, which is what keeps this from being a no-op that reports
   * success.
   */
  async updateProfile(claims: AccessTokenClaims | undefined, input: ProfileUpdateInput) {
    if (!claims) throw unauthorized(ERROR.AUTH_REQUIRED);

    const profileId = claims.customerProfileId;

    if (!profileId) throw notFound(ERROR.CUSTOMER_NOT_FOUND);

    const updated = await this.db.execute<{ full_name: string; phone: string }>(sql`
      UPDATE customer_profiles
      SET full_name = COALESCE(${input.fullName ?? null}, full_name),
          phone     = COALESCE(${input.phone ?? null}, phone),
          updated_at = now()
      WHERE id = ${profileId} AND deleted_at IS NULL
      RETURNING full_name, phone
    `);

    const row = updated.rows[0];

    if (!row) throw notFound(ERROR.CUSTOMER_NOT_FOUND);

    /*
      Audited, unlike the reads. A change of the name on an account is the kind of thing a support
      conversation later turns on — "it did not say that yesterday" needs an answer.
    */
    await this.audit.record({
      actorUserId: claims.sub,
      actorRole: claims.role,
      action: 'customer.profile_updated',
      subjectType: 'customer_profile',
      subjectId: profileId,
      after: {
        ...(input.fullName === undefined ? {} : { fullName: input.fullName }),
        /* The phone is recorded as CHANGED, not as its value — an audit row is not a contact list. */
        ...(input.phone === undefined ? {} : { phoneChanged: true }),
      },
    });

    return { fullName: row.full_name, phone: row.phone };
  }

  /**
   * Changing your own password.
   *
   * ## The current password is the point
   *
   * A leaked access token — a shared machine, a stolen phone — must not be enough to lock the owner out
   * of their own account. Knowing the present password is the second factor this operation has, and it
   * is verified against the stored Argon2id digest before anything is written.
   *
   * ## Every other session dies
   *
   * The same call `confirmPasswordReset` makes, for the same reason: people change a password because
   * they believe somebody else has it, and leaving that person's refresh tokens alive hands the account
   * straight back. The CALLER is signed out too — their access token still works until it expires, but
   * their refresh family is gone, so the browser they are holding will have to sign in again. That is
   * the honest outcome of "end every session".
   *
   * ## A wrong current password is a 400, not a 401
   *
   * 401 would tell a proxy or a client that the SESSION is invalid, and some of them respond by
   * clearing it — signing somebody out for a typo. The session is fine; the field is wrong.
   */
  async changePassword(
    claims: AccessTokenClaims | undefined,
    input: PasswordChangeInput,
    context: { ipAddress?: string | undefined; userAgent?: string | undefined } = {},
  ): Promise<void> {
    if (!claims) throw unauthorized(ERROR.AUTH_REQUIRED);

    const found = await this.db.execute<{ password_hash: string | null }>(sql`
      SELECT password_hash FROM users
      WHERE id = ${claims.sub} AND deleted_at IS NULL
      LIMIT 1
    `);

    const digest = found.rows[0]?.password_hash;

    /*
      No row, or an account that has never had a password — a guest profile that was claimed, say.
      Both answer the same way: there is no current password to prove.
    */
    if (!digest) throw badRequest(ERROR.AUTH_PASSWORD_INCORRECT);

    if (!(await this.passwords.verify(digest, input.currentPassword))) {
      /*
        Recorded on FAILURE too. Repeated failures here are somebody sitting at an unlocked screen
        guessing, which is exactly the pattern an audit trail should be able to show.
      */
      await this.audit.record({
        actorUserId: claims.sub,
        actorRole: claims.role,
        action: 'auth.password_change_refused',
        subjectType: 'user',
        subjectId: claims.sub,
        ...context,
      });

      throw badRequest(ERROR.AUTH_PASSWORD_INCORRECT);
    }

    const passwordHash = await this.passwords.hash(input.newPassword);

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE users
        SET password_hash = ${passwordHash},
            -- A deliberate change by somebody who proved the old password clears a lockout, exactly
            -- as a reset does: they are demonstrably the owner.
            failed_login_attempts = 0,
            locked_until = NULL,
            updated_at = now()
        WHERE id = ${claims.sub}
      `);

      await tx.execute(sql`
        UPDATE customer_profiles SET updated_at = now() WHERE user_id = ${claims.sub}
      `);

      await this.audit.record(
        {
          actorUserId: claims.sub,
          actorRole: claims.role,
          action: 'auth.password_changed',
          subjectType: 'user',
          subjectId: claims.sub,
          ...context,
        },
        tx as unknown as Database,
      );
    });

    /* Outside the transaction: revocation touches Redis as well, and must not hold a write open. */
    await this.tokens.revokeAllForUser(claims.sub);

    this.logger.log(`Password changed for user ${claims.sub}.`);
  }
}
