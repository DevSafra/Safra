import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { createdAt, foreignId, notDeleted, primaryId, timestamps } from './_shared.js';
import { authTokenPurpose, userRole, userStatus } from './enums.js';
import { currencies } from './geo.js';

/**
 * Authenticatable accounts only. A "Visitor" (§4) has no row here, and a Guest
 * Customer books without one — see customerProfiles.userId being nullable.
 */
export const users = pgTable(
  'users',
  {
    id: primaryId(),
    email: text('email').notNull(),
    phone: text('phone'),
    /** Argon2id. Null for accounts that exist but cannot yet sign in. */
    passwordHash: text('password_hash'),
    role: userRole('role').notNull(),
    status: userStatus('status').notNull().default('active'),
    preferredLocale: text('preferred_locale').notNull().default('ar'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    phoneVerifiedAt: timestamp('phone_verified_at', { withTimezone: true }),
    /**
     * TOTP seed for staff 2FA, AES-256-GCM encrypted at rest with
     * FIELD_ENCRYPTION_KEY. Never returned by any API.
     */
    totpSecretEncrypted: text('totp_secret_encrypted'),
    totpEnabledAt: timestamp('totp_enabled_at', { withTimezone: true }),
    /**
     * Single-use recovery codes, stored as Argon2id hashes.
     *
     * A recovery code bypasses 2FA entirely, so it is a credential of equal weight
     * to the password and is never stored in clear. Codes are removed from the array
     * as they are consumed, which is what makes them single-use.
     */
    totpRecoveryCodeHashes: text('totp_recovery_code_hashes')
      .array()
      .notNull()
      .default([]),
    /** Per-user grants layered on top of the role, for CASL. */
    permissionOverrides: jsonb('permission_overrides').$type<string[]>(),
    /** Lockout state after repeated failed sign-ins (§1 rate limiting). */
    failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('users_email_unique').on(t.email).where(notDeleted),
    index('users_role_status_idx').on(t.role, t.status),
  ],
);

/**
 * Refresh-token rotation with reuse detection. Tokens are stored hashed, never in
 * plaintext: a leaked database must not yield usable sessions. If a token from an
 * already-rotated family is presented, the whole family is revoked — that is the
 * signature of a stolen token being replayed.
 */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: primaryId(),
    userId: foreignId('user_id')
      .notNull()
      .references(() => users.id),
    tokenHash: text('token_hash').notNull().unique(),
    familyId: foreignId('family_id').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    replacedByTokenHash: text('replaced_by_token_hash'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    ...createdAt,
  },
  (t) => [
    index('refresh_tokens_user_idx').on(t.userId),
    index('refresh_tokens_family_idx').on(t.familyId),
  ],
);

/**
 * Single-use tokens for password reset and email verification (SRS §4).
 *
 * Stored as a digest, never in clear — same reasoning as `refreshTokens`. A password
 * reset token IS a credential: whoever holds it can take over the account without
 * knowing the password, so a leaked database must not hand out live ones.
 *
 * `consumedAt` rather than a delete, so a redeemed token leaves evidence. "This reset
 * link was used at 14:02 from this address" is exactly what an account-takeover
 * investigation needs, and a deleted row says nothing at all.
 */
export const authTokens = pgTable(
  'auth_tokens',
  {
    id: primaryId(),
    userId: foreignId('user_id')
      .notNull()
      .references(() => users.id),
    purpose: authTokenPurpose('purpose').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    ...createdAt,
  },
  (t) => [
    /**
     * Supports both hot paths: "how many has this user requested lately?" for
     * throttling, and "invalidate their outstanding ones" when a reset succeeds.
     */
    index('auth_tokens_user_purpose_idx').on(t.userId, t.purpose, t.createdAt),
    index('auth_tokens_expiry_idx').on(t.expiresAt),
  ],
);

/**
 * SRS §4 + §13.2 (CUS-000001). Separate from `users` because a Guest Customer
 * completes a booking with no account at all, yet still needs an identity to
 * attach bookings, a wallet and a support thread to.
 */
export const customerProfiles = pgTable(
  'customer_profiles',
  {
    id: primaryId(),
    reference: text('reference')
      .notNull()
      .unique()
      .default(sql`'CUS-' || lpad(nextval('customer_reference_seq')::text, 6, '0')`),
    /** Null = guest checkout. Set when the guest later registers. */
    userId: foreignId('user_id').references(() => users.id),
    fullName: text('full_name').notNull(),
    email: text('email').notNull(),
    phone: text('phone').notNull(),
    preferredLocale: text('preferred_locale').notNull().default('ar'),
    preferredCurrencyId: foreignId('preferred_currency_id').references(
      () => currencies.id,
    ),
    isGuest: boolean('is_guest').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('customer_profiles_user_unique').on(t.userId).where(notDeleted),
    index('customer_profiles_email_idx').on(t.email),
    index('customer_profiles_phone_idx').on(t.phone),
  ],
);

export const usersRelations = relations(users, ({ one, many }) => ({
  customerProfile: one(customerProfiles, {
    fields: [users.id],
    references: [customerProfiles.userId],
  }),
  refreshTokens: many(refreshTokens),
}));

export const customerProfilesRelations = relations(customerProfiles, ({ one }) => ({
  user: one(users, { fields: [customerProfiles.userId], references: [users.id] }),
  preferredCurrency: one(currencies, {
    fields: [customerProfiles.preferredCurrencyId],
    references: [currencies.id],
  }),
}));
