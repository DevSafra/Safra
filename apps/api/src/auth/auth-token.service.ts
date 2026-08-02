import { createHash, randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';

import { DATABASE } from '../database/database.module.js';

export type AuthTokenPurpose =
  | 'password_reset'
  | 'email_verification'
  /**
   * A staff invitation (M-5). Distinct from `password_reset` because it is the only
   * token that turns an account with no password into a usable one — the two must not
   * be interchangeable, and `redeem` filters on purpose so they cannot be.
   */
  | 'staff_invitation';

export interface IssuedAuthToken {
  /** The clear token. Returned ONCE, goes into an email, never stored. */
  readonly token: string;
  readonly expiresAt: Date;
}

export interface RedeemedToken {
  readonly userId: string;
  readonly email: string;
  readonly preferredLocale: string;
}

/**
 * Single-use tokens for password reset and email verification (SRS §4).
 *
 * A password-reset token is a CREDENTIAL — it takes over an account without the
 * password — so it is treated like one:
 *
 *  - 256 bits of `randomBytes`, base64url. Not a UUID: a v4 UUID carries 122 bits
 *    and, worse, invites the assumption that any id will do.
 *  - Stored as a SHA-256 digest. A leaked database yields no usable links.
 *  - Single use, enforced by `consumed_at` under a conditional UPDATE, so two
 *    concurrent redemptions cannot both win.
 *  - Short-lived, and every OUTSTANDING token for the same purpose is invalidated
 *    when a new one is issued — otherwise a customer clicking "resend" three times
 *    leaves three live keys to their account.
 *
 * Plain SHA-256 rather than the HMAC used for refresh tokens: these are 256-bit
 * random values with a lifetime measured in hours, so there is no dictionary to
 * pepper against, and no second secret to manage.
 */
@Injectable()
export class AuthTokenService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async issue(
    userId: string,
    purpose: AuthTokenPurpose,
    ttlMs: number,
    context: { ipAddress?: string | undefined; userAgent?: string | undefined } = {},
  ): Promise<IssuedAuthToken> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + ttlMs);

    await this.db.transaction(async (tx) => {
      /**
       * Supersede anything still outstanding for this purpose.
       *
       * Marked consumed rather than deleted, so the trail still shows that a link
       * was issued and replaced — useful when reconstructing an account takeover.
       */
      await tx.execute(sql`
        UPDATE auth_tokens
        SET consumed_at = now()
        WHERE user_id = ${userId}
          AND purpose = ${purpose}::auth_token_purpose
          AND consumed_at IS NULL
      `);

      await tx.execute(sql`
        INSERT INTO auth_tokens
          (user_id, purpose, token_hash, expires_at, ip_address, user_agent)
        VALUES (${userId}, ${purpose}::auth_token_purpose, ${digest(token)},
                ${expiresAt.toISOString()}, ${context.ipAddress ?? null},
                ${context.userAgent ?? null})
      `);
    });

    return { token, expiresAt };
  }

  /**
   * Consumes a token and returns whose it was, or null.
   *
   * The UPDATE is the check: `consumed_at IS NULL` in the WHERE clause means the
   * database decides the winner, so two requests racing the same link produce
   * exactly one success. A read-then-write would let both through — which for a
   * password reset means two different new passwords, and for the loser a
   * confusing failure after their password had in fact changed.
   */
  async redeem(token: string, purpose: AuthTokenPurpose): Promise<RedeemedToken | null> {
    if (!looksLikeToken(token)) return null;

    const rows = await this.db.execute<{
      user_id: string;
      email: string;
      preferred_locale: string;
    }>(sql`
      WITH consumed AS (
        UPDATE auth_tokens
        SET consumed_at = now()
        WHERE token_hash = ${digest(token)}
          AND purpose = ${purpose}::auth_token_purpose
          AND consumed_at IS NULL
          AND expires_at > now()
        RETURNING user_id
      )
      SELECT u.id AS user_id, u.email, u.preferred_locale
      FROM consumed
      JOIN users u ON u.id = consumed.user_id
      WHERE u.deleted_at IS NULL AND u.status = 'active'
    `);

    const row = rows.rows[0];
    if (!row) return null;

    return {
      userId: row.user_id,
      email: row.email,
      preferredLocale: row.preferred_locale,
    };
  }

  /**
   * How many tokens this user has been issued for a purpose in the last window.
   *
   * Backs a PER-ACCOUNT throttle on top of the per-IP rate limit. Without it, an
   * attacker rotating through addresses can flood one person's inbox with reset
   * emails — technically harmless, genuinely distressing, and a good way to bury a
   * real security notification under noise.
   */
  async countRecent(
    userId: string,
    purpose: AuthTokenPurpose,
    windowMs: number,
  ): Promise<number> {
    const rows = await this.db.execute<{ count: string }>(sql`
      SELECT COUNT(*)::text AS count FROM auth_tokens
      WHERE user_id = ${userId}
        AND purpose = ${purpose}::auth_token_purpose
        AND created_at > now() - (${Math.ceil(windowMs / 1000)}::int * INTERVAL '1 second')
    `);

    return Number(rows.rows[0]?.count ?? 0);
  }
}

function digest(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** 32 random bytes as base64url, unpadded. */
const TOKEN_LENGTH = 43;

/**
 * Cheap shape check before touching the database.
 *
 * The lookup is by digest, so a malformed value would simply miss anyway — this
 * only keeps a hash and a query off the path for obviously bogus input (rule 1).
 * Deliberately NOT constant-time: it compares against a fixed public length, not
 * against a secret, so there is nothing for a timing difference to reveal.
 */
function looksLikeToken(value: string): boolean {
  return value.length === TOKEN_LENGTH && /^[A-Za-z0-9_-]+$/.test(value);
}
