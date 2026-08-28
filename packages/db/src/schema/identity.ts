import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  type AnyPgColumn,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { createdAt, foreignId, notDeleted, primaryId, timestamps } from './_shared.js';
import { authTokenPurpose, gender, userRole, userStatus } from './enums.js';
import { cities, currencies } from './geo.js';

/**
 * Authenticatable accounts only. A "Visitor" (§4) has no row here, and a Guest
 * Customer books without one — see customerProfiles.userId being nullable.
 */
/**
 * How widely a staff member's authority reaches (design handoff §8.2, نطاق العمل).
 *
 * `all_cities` is the default and covers every staff member who has no geographic limit —
 * finance, super admins, and any operations manager who works nationally. `cities` narrows them
 * to an explicit list in `staff_scope_cities`.
 *
 * "خارج سوريا" from the design is NOT a third kind: it is a city list containing the non-Syrian
 * cities. Modelling it as a special case would mean a second code path that has to be kept in
 * step with the first, for a distinction the data already expresses.
 */
export const staffScopeKind = pgEnum('staff_scope_kind', ['all_cities', 'cities']);

/**
 * What a scoped staff member may do OUTSIDE their cities (Bashar, 2026-08-04).
 *
 * `none` — the resource does not exist for them. Lists omit it and a detail read returns 404,
 * never 403: a 403 confirms the row exists, which is itself information they are not scoped to
 * have.
 *
 * `read_only` — they can see it and cannot change it.
 *
 * Writes are refused outside scope in BOTH modes. `read_only` is a widening of READ only; there is
 * no mode in which a Latakia-scoped agent edits a Damascus booking. Default is `none`, because
 * deny-by-default is rule 1 and the safer value must be the one you get by forgetting to choose.
 */
export const outsideScopeAccess = pgEnum('outside_scope_access', ['none', 'read_only']);

/**
 * A named role for SAFRA's OWN staff, defined by the super admin (Bashar, 2026-08-23).
 *
 * ## Why a table rather than more enum values
 *
 * "The super admin should have the define roles screen for his own employees" — and he wants to
 * INVENT them: «مشرف حجوزات», «محاسب», whatever the organisation turns out to need. An enum cannot
 * do that; adding a value is a migration, and Postgres cannot remove one at all.
 *
 * So `users.role` stops being the source of a staff member's AUTHORITY and keeps only two jobs it
 * is still good at: admission (`STAFF_ROLES` decides who may open the console) and the second
 * factor. What a staff member may DO comes from the row they point at here.
 *
 * ## `is_system` is the lock, and it exists to stop one specific accident
 *
 * `super_admin` is a system role: it cannot be renamed, reduced, retired, or unassigned from the
 * last account holding it. Without that, a super admin edits their own role, drops `staff.manage`,
 * and there is nobody left who can put it back — an irreversible lockout performed through a form
 * that looks like an ordinary edit.
 *
 * The four roles that exist today are seeded here as ordinary rows, so they can be renamed and
 * adjusted like any other. Only `super_admin` is locked.
 *
 * ## What a custom role may never carry
 *
 * `STAFF_ROLE_MANAGE` is excluded from what any role can be given, and the exclusion is the whole
 * boundary: a role that can define roles can grant itself everything, and «مشرف حجوزات» becomes a
 * super admin in one edit. Same argument as `PARTNER_EMPLOYEE_MANAGE` being absent from what an
 * employee may hold.
 */
export const staffRoles = pgTable(
  'staff_roles',
  {
    id: primaryId(),
    name: text('name').notNull(),
    permissions: text('permissions').array().notNull(),
    /*
      The enum value this role admits its holders as — the ONLY thing `users.role` still decides.

      A custom role still has to be one of the console's admitted roles for `STAFF_ROLES` and the
      2FA list to keep working; what changes is that four names no longer imply four permission
      sets. Defaults to `support_agent`, the least authority a staff account can be admitted with.
    */
    admitsAs: userRole('admits_as').notNull().default('support_agent'),
    /** Locked against edit, retirement and unassignment. True only for `super_admin`. */
    isSystem: boolean('is_system').notNull().default(false),
    /*
      `AnyPgColumn` because the two tables reference each other: a role records who created it, and
      a user records which role they hold. TypeScript cannot infer either type while the other is
      still being inferred, and the annotation is drizzle's documented way out of the cycle.
    */
    createdByUserId: foreignId('created_by_user_id').references(
      (): AnyPgColumn => users.id,
    ),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('staff_roles_name_unique')
      .on(sql`lower(${t.name})`)
      .where(notDeleted),
  ],
);

export const users = pgTable(
  'users',
  {
    id: primaryId(),
    email: text('email').notNull(),
    /**
     * The name of the PERSON holding this account (Bashar, 2026-08-23).
     *
     * ## Why on `users` and not somewhere staff-specific
     *
     * A staff member's only row is this one. A customer's name lives on `customer_profiles` and a
     * partner employee's on `partner_employees`, because both of those are records ABOUT a
     * relationship — a person can be a customer and somebody's receptionist at once, and the two
     * names belong to the two roles. Staff have no such record, so صفحة الموظف could only ever
     * identify a colleague by `staff12@safra.test`, which is what Bashar was looking at when he
     * asked for this.
     *
     * ## Nullable, and the reason is honesty rather than convenience
     *
     * 165 accounts exist with no name and there is nothing true to backfill them with. Deriving one
     * from the address — `staff12` — would put a fabricated name on a colleague's record, and the
     * console would render it as fact. So it is null until somebody types the real one, and every
     * surface falls back to the email, which is at least true.
     *
     * Required going forward: `staffInviteSchema` demands it, so no account created from now on
     * arrives without one.
     */
    fullName: text('full_name'),
    phone: text('phone'),
    /** Argon2id. Null for accounts that exist but cannot yet sign in. */
    passwordHash: text('password_hash'),
    role: userRole('role').notNull(),
    /*
      The role row this staff member holds, and the source of their permissions.

      Nullable, because customers and partners have no staff role and every account seeded before
      this existed has none either. A staff account with no role resolves to the permissions its
      `role` enum value implies — the pre-2026-08-23 behaviour — so nothing breaks while the
      backfill happens, and a console that has not assigned roles yet keeps working.
    */
    staffRoleId: foreignId('staff_role_id').references(() => staffRoles.id),
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
    /**
     * Geographic scope (design handoff §8.2). Enforced server-side, never only rendered.
     *
     * `all_cities` for everybody by default, so adding the column changed nobody's authority. A
     * super_admin is never scoped — the API refuses it, because scoping the only account that can
     * un-scope an account is a lockout waiting to happen.
     */
    scopeKind: staffScopeKind('scope_kind').notNull().default('all_cities'),
    /** Only meaningful when `scopeKind = 'cities'`. See the enum for why writes ignore it. */
    outsideScopeAccess: outsideScopeAccess('outside_scope_access')
      .notNull()
      .default('none'),
    /**
     * How many rows this person wants per page, per console registry — `{ bookings: 50 }`.
     *
     * Every table starts at ten rows (Bashar, 2026-08-06) and remembers a change against the
     * ACCOUNT rather than the browser, so the choice survives a new laptop and a cleared cache.
     * Per registry rather than one number: ten bookings is a queue you scan and a hundred audit
     * rows is a log you search, and one setting cannot be right for both.
     *
     * A map rather than fourteen columns because the set of registries changes with the product
     * and a column per table would mean a migration every time one is added. The keys ARE
     * validated — `tablePageSizeSchema` in `@safra/contracts` — so this is not a place a client
     * can write arbitrary JSON.
     *
     * Missing keys are the norm, not an error: an absent entry means "never changed it", which is
     * exactly the default. Nothing writes a key equal to the default.
     */
    tablePageSizes: jsonb('table_page_sizes')
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    /**
     * When this staff member last OPENED each registry — «what is new since I last looked».
     *
     * Beside `table_page_sizes` and for the same reasons: a `jsonb` map rather than a column per
     * section, keys validated against a closed allow-list (`SEEN_SECTIONS`) because this row is
     * read on every authenticated request, and a missing key meaning «never looked».
     *
     * A missing key deliberately counts NOTHING as new. The alternative — treating «never looked»
     * as «everything since the beginning» — would greet a new operator with a badge counting every
     * customer the platform has ever had, which is noise wearing the clothes of a queue.
     */
    sectionSeenAt: jsonb('section_seen_at')
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
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
 * The one-time code emailed to a partner at every sign-in (Bashar, 2026-08-20).
 *
 * ## Why a table and not Redis
 *
 * Redis holds this platform's rate-limit counters, and the note on `RedisThrottlerStorage` is
 * explicit that losing them costs a few minutes of throttling — it is a store the design is allowed
 * to lose. A sign-in code is not: losing it mid-flight means a partner who has already typed their
 * password is told their code is wrong, with no way to tell that from an attack. It is also a
 * CREDENTIAL, and §15 wants credentials to leave evidence.
 *
 * ## Hashed, like every other credential here
 *
 * Argon2id rather than the SHA-256 `refresh_tokens` uses, and the difference is the entropy. A
 * refresh token is 256 random bits, so a fast digest is fine; this is six digits, and a fast digest
 * over a leaked table is a million guesses a second. The verify costs ~11 ms, which is nothing
 * against a code that is attempted at most five times.
 *
 * ## `consumedAt` rather than a delete
 *
 * The same reasoning as the tokens below: a code that was used leaves the fact that it was used,
 * and "this code was redeemed at 14:02 from this address" is what an account-takeover investigation
 * asks for. `attempts` is here for the same reason — a code with four failures against it is a
 * story even after it expires.
 */
export const loginCodes = pgTable(
  'login_codes',
  {
    id: primaryId(),
    userId: foreignId('user_id')
      .notNull()
      .references(() => users.id),
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    /** Wrong guesses against THIS code. Five and it is dead, whatever the clock says. */
    attempts: integer('attempts').notNull().default(0),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    ...createdAt,
  },
  (t) => [
    /**
     * "The newest live code for this person", which is the only question asked of this table on
     * the sign-in path. ASCENDING on `created_at` so PostgreSQL reads it backward — see the note
     * on `partner_application_contacts_application_idx` for why `.desc()` is the wrong instrument.
     */
    index('login_codes_user_idx').on(t.userId, t.createdAt),
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
      .default(sql`'CUS-' || reference_number(nextval('customer_reference_seq'))`),
    /** Null = guest checkout. Set when the guest later registers. */
    userId: foreignId('user_id').references(() => users.id),
    fullName: text('full_name').notNull(),
    email: text('email').notNull(),
    phone: text('phone').notNull(),
    preferredLocale: text('preferred_locale').notNull().default('ar'),
    /**
     * How to address this person. Optional at registration and after it.
     *
     * `undisclosed` by default rather than nullable — see the enum. Nothing in the platform
     * BRANCHES on it: it is used to address somebody correctly and for nothing else, which is what
     * keeps collecting it proportionate.
     */
    gender: gender('gender').notNull().default('undisclosed'),
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

/**
 * Inverse sides, required by Drizzle.
 *
 * A `many()` without its matching `one()` throws at QUERY time, not compile time —
 * see `schema/relations.test.ts`, which now runs every relation to keep this class
 * of bug from shipping again.
 */
export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, { fields: [refreshTokens.userId], references: [users.id] }),
}));

export const authTokensRelations = relations(authTokens, ({ one }) => ({
  user: one(users, { fields: [authTokens.userId], references: [users.id] }),
}));

export const customerProfilesRelations = relations(customerProfiles, ({ one }) => ({
  user: one(users, { fields: [customerProfiles.userId], references: [users.id] }),
  preferredCurrency: one(currencies, {
    fields: [customerProfiles.preferredCurrencyId],
    references: [currencies.id],
  }),
}));

/**
 * Which cities a scoped staff member covers (design handoff §8.2).
 *
 * A join table rather than a `city_ids uuid[]` column on `users`, for one reason that matters: a
 * foreign key. An array cannot reference `cities`, so a city that was renamed or archived would
 * leave a dangling uuid in somebody's scope — and a scope with a uuid nobody recognises fails
 * open or closed unpredictably. Here the database refuses to delete a city that is still somebody's
 * scope.
 *
 * Composite primary key: a member covers a city once or not at all.
 */
export const staffScopeCities = pgTable(
  'staff_scope_cities',
  {
    userId: foreignId('user_id')
      .notNull()
      .references(() => users.id),
    cityId: foreignId('city_id')
      .notNull()
      .references(() => cities.id),
    ...createdAt,
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.cityId] }),
    index('staff_scope_cities_user_idx').on(t.userId),
  ],
);

export const staffScopeCitiesRelations = relations(staffScopeCities, ({ one }) => ({
  user: one(users, { fields: [staffScopeCities.userId], references: [users.id] }),
  city: one(cities, { fields: [staffScopeCities.cityId], references: [cities.id] }),
}));
