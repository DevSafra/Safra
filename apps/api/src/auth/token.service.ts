import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { SignJWT, jwtVerify } from 'jose';
import { v7 as uuidv7 } from 'uuid';

import type { Database } from '@safra/db';
import { schema } from '@safra/db';
import {
  ERROR,
  TOGGLEABLE_GRANT_KEYS,
  UNSCOPED,
  employeePermissions,
  isScopable,
  staffRolePermissions,
  resolvePermissions,
  type StaffScope,
} from '@safra/contracts';
import type { Permission, Role } from '@safra/contracts';

import { findLiveEmployment } from '../partner/live-employment.js';
import { DATABASE } from '../database/database.module.js';
import { ENV, type Env } from '../config/env.js';
import { SettingsService } from '../settings/settings.service.js';
import { unauthorized } from '../common/errors/app-error.js';

export interface AccessTokenClaims {
  sub: string;
  role: Role;
  permissions: Permission[];
  locale: string;
  /**
   * Owning ids for resource-level authorization (see rbac/ownership.ts).
   *
   * Embedded in the token so ownership filtering costs no extra query on the hot
   * path. Exactly one is set in practice: a customer carries customerProfileId, a
   * partner carries partnerId, and staff carry neither because they are scoped by
   * a `*_all` permission instead.
   */
  customerProfileId?: string | undefined;
  partnerId?: string | undefined;
  /**
   * Whether this account has completed 2FA enrolment.
   *
   * Carried in the token so the admin app can route an unenrolled staff member to
   * enrolment without a round trip on every request. It is a UX signal only — the
   * API refuses staff actions on its own authority, never on the strength of what a
   * client did with this flag.
   */
  totpEnabled?: boolean | undefined;
  /**
   * Geographic scope (design handoff §8.2), carried in the token for the same reason the owning
   * ids are: authorization stays off the hot path.
   *
   * ADR 0003 already accepts up to fifteen minutes of permission staleness in the GRANTING
   * direction. Narrowing must be immediate, and it is: `StaffScopeService` revokes the member's
   * refresh tokens whenever their scope is tightened, so the next request cannot be served on a
   * token minted under the wider scope. Same mechanism `AdminGrantsService` uses when a runtime
   * grant is switched off.
   *
   * Absent on a token minted before this claim existed, which resolves to `UNSCOPED` — the
   * pre-existing behaviour, and the only safe default for a claim that cannot be read.
   */
  scope?: StaffScope | undefined;
}

export interface IssuedTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

/**
 * Access tokens are short-lived and stateless; refresh tokens are long-lived and
 * stateful, stored only as a keyed digest.
 *
 * Refresh tokens are hashed, not encrypted, because we never need to read one
 * back — only to recognise one presented to us. A stolen database therefore
 * yields no usable sessions.
 *
 * The digest is HMAC-SHA256 keyed with JWT_REFRESH_SECRET, not a bare SHA-256.
 * The token already carries 256 bits of entropy, so brute force is not the threat;
 * the pepper means a database compromise ALONE is insufficient — an attacker also
 * needs the application secret before any stolen digest can be matched.
 *
 * A fast keyed hash is correct here, unlike for passwords: there is no
 * low-entropy space to protect, and lookup happens on every refresh.
 */
/**
 * How many sessions one account may hold at once (`O-sec-6`, Bashar 2026-08-20).
 *
 * See `retireOldestSessions` for the reasoning and for why the number is soft.
 */
const MAX_CONCURRENT_SESSIONS = 10;

@Injectable()
export class TokenService {
  private readonly accessSecret: Uint8Array;
  /** Pepper for the refresh-token HMAC — see the class comment. */
  private readonly refreshPepper: string;
  private readonly accessTtlSeconds: number;
  private readonly refreshTtlSeconds: number;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DATABASE) private readonly db: Database,
    private readonly settings: SettingsService,
  ) {
    this.accessSecret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
    this.refreshPepper = env.JWT_REFRESH_SECRET;
    this.accessTtlSeconds = parseDuration(env.ACCESS_TOKEN_TTL);
    this.refreshTtlSeconds = parseDuration(env.REFRESH_TOKEN_TTL);
  }

  private digest(token: string): string {
    return createHmac('sha256', this.refreshPepper).update(token).digest('base64url');
  }

  async issue(
    claims: AccessTokenClaims,
    context: {
      ipAddress?: string | undefined;
      userAgent?: string | undefined;
      familyId?: string | undefined;
    },
  ): Promise<IssuedTokens> {
    /*
      Every claim is enumerated here explicitly, and that is a trap as well as a safeguard.

      `verify` already carries a note about the opposite mistake — a claim signed in and not read
      back out. This is the mirror, and it cost a live test to find: `scope` was resolved in
      `buildClaims`, never listed here, and therefore never signed. Enforcement looked complete in
      every unit test and did nothing at all against a real token, because the guard read
      `claims.scope` as `undefined` and defaulted to unrestricted.

      Anything added to `AccessTokenClaims` must be added here AND in `verify`. There is no
      spread-the-object shortcut on purpose: a spread would carry whatever happens to be on the
      object, which is how a claim nobody intended to publish ends up in a token clients can read.
    */
    const accessToken = await new SignJWT({
      role: claims.role,
      permissions: claims.permissions,
      locale: claims.locale,
      customerProfileId: claims.customerProfileId,
      partnerId: claims.partnerId,
      totpEnabled: claims.totpEnabled,
      scope: claims.scope,
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(claims.sub)
      .setIssuedAt()
      .setIssuer('safra-api')
      .setAudience('safra')
      .setExpirationTime(`${this.accessTtlSeconds}s`)
      .sign(this.accessSecret);

    // 256 bits of entropy. The token is returned once and never recoverable.
    const refreshToken = randomBytes(32).toString('base64url');
    const refreshExpiresAt = new Date(Date.now() + this.refreshTtlSeconds * 1000);

    // A family spans one login session across every rotation, so detecting reuse
    // lets us revoke the whole lineage rather than a single token.
    /* Absent on a sign-in, present on a rotation — which is what makes this a NEW session. */
    const isNewSession = !context.familyId;
    const familyId = context.familyId ?? uuidv7();

    await this.db.insert(schema.refreshTokens).values({
      userId: claims.sub,
      tokenHash: this.digest(refreshToken),
      familyId,
      expiresAt: refreshExpiresAt,
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null,
    });

    /*
      Retire the oldest sessions past the cap — but only when this IS a new one.

      A rotation carries its family forward, so counting it would retire a session every fifteen
      minutes for anybody signed in.
    */
    if (isNewSession) await this.retireOldestSessions(claims.sub);

    return {
      accessToken,
      expiresIn: this.accessTtlSeconds,
      refreshToken,
      refreshExpiresAt,
    };
  }

  /**
   * Keeps at most `MAX_CONCURRENT_SESSIONS` live sessions per account, newest kept.
   *
   * ## Why there is a cap at all
   *
   * `refresh_tokens` had no ceiling of any kind: an account could hold unlimited live sessions, and
   * nothing ever ended one except its own expiry (`O-sec-6`). Two consequences, and the second is
   * the one that matters. A table that only grows is what `CredentialRetentionService` now bounds.
   * A session list that only grows is a blast radius — every stale session on a shared machine, an
   * old phone, or a browser somebody forgot about is a live way in, for as long as the refresh
   * token lives, and nobody can see it.
   *
   * ## Ten, and why the number is soft
   *
   * A person with a phone, a laptop, an office desktop and a tablet is at four; add a second
   * browser and a private window and they are at six. Ten leaves room for that and still bounds
   * the tail. It is a product judgement rather than a security threshold — nothing breaks at
   * eleven — so it is one named constant, and moving it is a one-line decision rather than a
   * redesign.
   *
   * ## The oldest go, and they go as FAMILIES
   *
   * A family is one sign-in and every rotation descended from it, so revoking a family ends a
   * session; revoking a single row would end one fifteen-minute slice of it and leave the rest
   * usable. Ordered by when each family STARTED, so a session that is merely old is retired before
   * one that is merely quiet — the alternative, ordering by last use, would retire the tablet
   * somebody uses monthly ahead of a browser an attacker refreshes hourly.
   */
  private async retireOldestSessions(userId: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE refresh_tokens
      SET revoked_at = now()
      WHERE family_id IN (
        SELECT family_id
        FROM refresh_tokens
        WHERE user_id = ${userId}::uuid
          AND revoked_at IS NULL
          AND expires_at > now()
        GROUP BY family_id
        ORDER BY min(created_at) DESC
        OFFSET ${MAX_CONCURRENT_SESSIONS}
      )
        AND revoked_at IS NULL
    `);
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    try {
      const { payload } = await jwtVerify(token, this.accessSecret, {
        issuer: 'safra-api',
        audience: 'safra',
        algorithms: ['HS256'], // Pinned: prevents algorithm-confusion attacks.
      });

      return {
        sub: payload.sub as string,
        role: payload['role'] as Role,
        permissions: (payload['permissions'] as Permission[]) ?? [],
        locale: (payload['locale'] as string) ?? 'ar',
        customerProfileId: payload['customerProfileId'] as string | undefined,
        partnerId: payload['partnerId'] as string | undefined,
        // Read back explicitly. A claim that is signed into the token but dropped
        // here is worse than one that never existed: the guard sees `undefined` and
        // every consumer quietly treats an enrolled account as unenrolled.
        totpEnabled: payload['totpEnabled'] === true,
        /*
          Parsed, not cast. A malformed or absent scope claim resolves to UNSCOPED rather than
          throwing: an unreadable scope must not lock a staff member out of the console, and the
          write guards check the row's city against the resolved scope regardless.
        */
        scope: readScope(payload['scope']),
      };
    } catch {
      throw unauthorized(ERROR.AUTH_TOKEN_INVALID);
    }
  }

  /**
   * The ONE place access claims are constructed.
   *
   * Both login and refresh route through here, so a rotated token can never carry
   * more authority than the original login granted — a class of bug that appears
   * whenever the two paths build claims independently and then drift.
   */
  async buildClaims(user: typeof schema.users.$inferSelect): Promise<AccessTokenClaims> {
    const claims: AccessTokenClaims = {
      sub: user.id,
      role: user.role,
      permissions: await this.staffPermissions(user),
      locale: user.preferredLocale,
      totpEnabled: user.totpEnabledAt !== null,
      scope: await this.resolveScope(user),
    };

    return this.attachOwningIds(claims, user);
  }

  /**
   * What a staff member may do — their NAMED ROLE if they hold one (Bashar, 2026-08-23).
   *
   * ## Assigned, never merged, and that is the whole safety of it
   *
   * A named role's set REPLACES what `ROLE_PERMISSIONS[user.role]` would have given. Merging would
   * mean a role with three ticked capabilities silently carrying all of `operations_manager`'s as
   * well, because `admits_as` decides which enum value its holders are admitted under — so a
   * naming screen would become a privilege-escalation surface through a field nobody looks at.
   *
   * `staffRolePermissions` narrows on the way out, so a row that captured a since-forbidden
   * permission cannot still grant it. The one permission no named role may ever carry is
   * `STAFF_ROLE_MANAGE`: a role that can define roles can grant itself everything.
   *
   * ## No role means the old behaviour, unchanged
   *
   * `staff_role_id` is null for every account seeded before this existed and for every customer and
   * partner. Those resolve exactly as they did — the role enum plus overrides plus toggled grants —
   * so nothing breaks while roles are assigned, and a console that has not adopted them keeps
   * working.
   */
  private async staffPermissions(
    user: typeof schema.users.$inferSelect,
  ): Promise<Permission[]> {
    if (user.staffRoleId) {
      const rows = await this.db
        .select({ permissions: schema.staffRoles.permissions })
        .from(schema.staffRoles)
        .where(
          and(
            eq(schema.staffRoles.id, user.staffRoleId),
            isNull(schema.staffRoles.deletedAt),
          ),
        )
        .limit(1);

      /*
        A withdrawn role grants NOTHING rather than falling back to the enum. Fails closed: the
        alternative is that retiring a role silently restores whatever its holders' enum value
        implied, which is the opposite of what withdrawing it meant.
      */
      return staffRolePermissions(rows[0]?.permissions ?? []);
    }

    return resolvePermissions(
      user.role,
      user.permissionOverrides ?? [],
      await this.enabledGrants(),
    );
  }

  /**
   * Reads a staff member's scope for the token.
   *
   * A super admin is never scoped — see `isScopable`. Anybody with `all_cities` gets `UNSCOPED`
   * without touching `staff_scope_cities`, which is every account today and keeps the common path
   * at zero extra queries.
   */
  private async resolveScope(
    user: typeof schema.users.$inferSelect,
  ): Promise<StaffScope> {
    if (!isScopable(user.role) || user.scopeKind === 'all_cities') return UNSCOPED;

    const rows = await this.db
      .select({ cityId: schema.staffScopeCities.cityId })
      .from(schema.staffScopeCities)
      .where(eq(schema.staffScopeCities.userId, user.id));

    return {
      kind: 'cities',
      cityIds: rows.map((row) => row.cityId),
      outside: user.outsideScopeAccess,
    };
  }

  /**
   * Which runtime permission toggles are currently on.
   *
   * Read here, at token-mint time, rather than in the guard on every request: ADR
   * 0003 already accepts up to fifteen minutes of permission staleness in exchange
   * for keeping authorization off the hot path, and a settings read per request
   * would trade that away for a toggle almost nobody flips.
   *
   * The staleness is only tolerable in the granting direction. `SettingsService`
   * exposes the flip so the caller can revoke the affected role's sessions when a
   * grant is turned OFF — see `AdminGrantsService`; taking authority away must be
   * immediate even though giving it need not be.
   */
  private async enabledGrants(): Promise<string[]> {
    const enabled: string[] = [];

    for (const key of TOGGLEABLE_GRANT_KEYS) {
      if (await this.settings.get<boolean>(key, false)) enabled.push(key);
    }

    return enabled;
  }

  private async attachOwningIds(
    claims: AccessTokenClaims,
    user: typeof schema.users.$inferSelect,
  ): Promise<AccessTokenClaims> {
    /*
      A customer profile is resolved whenever one EXISTS — not only when the role says `customer`.
      (Bashar, 2026-08-23; found by the security session.)

      This was gated on the role, and that made a person's identity a function of their job. A
      hotel invites its receptionist; she happens to book with SAFRA herself; she clicks the
      invitation and her role becomes `partner_employee` — and her own trips, wallet and gift cards
      become unreachable in the same instant. The `customer_profiles` row was never deleted; there
      was simply nothing left pointing at it.

      A person can genuinely be both a customer and somebody's receptionist. `role` answers what
      they are DOING for a business; the profile belongs to the person and outlives the job. What
      they may do with it is still decided by permissions, so widening this grants nothing — the
      customer permissions come from the role and an employee does not have them.
    */
    const profile = await this.db.query.customerProfiles.findFirst({
      where: and(
        eq(schema.customerProfiles.userId, user.id),
        isNull(schema.customerProfiles.deletedAt),
      ),
      columns: { id: true },
    });

    claims.customerProfileId = profile?.id;

    if (user.role === 'partner') {
      const partner = await this.db.query.partners.findFirst({
        where: and(
          eq(schema.partners.userId, user.id),
          isNull(schema.partners.deletedAt),
          /*
            Suspension counts here too, and it did not until 2026-08-23.

            The employee branch below filtered `suspendedAt` from the start, and this one did not —
            so suspending a business would have silenced every receptionist while leaving the OWNER,
            who holds the listings, the calendar and the guest list, trading exactly as before. The
            same column load-bearing in one branch and absent in the other is how two branches
            drift apart, and this was the wrong half to enforce.

            Latent rather than live when it was found: `partners.suspended_at` is read in three
            places and written by no route yet — `P.PARTNER_SUSPEND` exists with nothing behind it.
            The point of fixing it now is that whoever wires up the suspend button will be reading
            the column and reasonably assuming the enforcement is already there, because for
            employees it was.
          */
          isNull(schema.partners.suspendedAt),
        ),
        columns: { id: true },
      });
      claims.partnerId = partner?.id;
    }

    /*
      An employee's authority comes from their EMPLOYER and their assigned role (Bashar,
      2026-08-23), and both are resolved here rather than at any call site.

      ## Why the permissions are replaced rather than added to

      `ROLE_PERMISSIONS.partner_employee` is deliberately empty, and `resolvePermissions` has
      already run — so `claims.permissions` currently holds whatever the account's own
      `permission_overrides` granted. Those exist for STAFF, and an override on an employee account
      would be a way to hand a receptionist `PAYOUT_EXECUTE` without going near the roles screen.
      Assigning the intersected role set, rather than merging into it, closes that path: an
      employee's permissions are exactly what their named role carries and nothing else.

      ## Why `partnerId` is the EMPLOYER's

      Every partner-scoped query filters on `claims.partnerId`. Setting it to the employer means an
      employee sees precisely what the business sees and nothing of any other business — the scope
      machinery needs no new case, which is the point.

      ## A suspended employment yields no partner and no permissions

      Two switches with two owners: the platform suspends the ACCOUNT, the partner suspends the
      EMPLOYMENT. A suspended employee whose account is still active gets a token with no partner
      id and no permissions, so every scoped read answers as if there were nothing there.
    */
    if (user.role === 'partner_employee') {
      const row = await findLiveEmployment(this.db, user.id);

      /*
        Fails CLOSED. No live employment means no partner and no permissions — never a fallback
        derived from the ABSENCE of a row.

        A derived fallback to the customer set was written here and reverted within the hour. The
        argument against it is the one `readFile` taught this codebase earlier today: granting
        anything because a row is missing is exactly how deny-by-default inverts, and a permission
        set is the last place to accept that shape. What an account may do is stored, not inferred.

        The stranding this looks like it leaves — an activated employee whose employment ends is
        `partner_employee` with nothing to resolve — is closed at the WRITE instead, which is where
        it belongs: `PartnerEmployeesService.remove` puts `users.role` back to `customer`, so the
        stored row matches reality. Suspension deliberately does not, because a suspension is meant
        to be reversible and the job still exists.

        What remains is an employment that stops being live WITHOUT going through `remove` — the
        employer soft-deleted, the role withdrawn. Those accounts need a staff action to restore,
        and that is recorded as open work rather than papered over with an inferred grant.
      */
      claims.partnerId = row?.partnerId;
      claims.permissions = employeePermissions(row?.permissions ?? []);
    }

    return claims;
  }

  /**
   * Rotates a refresh token, detecting replay.
   *
   * If a token that has ALREADY been rotated is presented again, that means two
   * parties hold it — the legitimate user and a thief. We cannot tell which is
   * which, so the entire family is revoked and both must re-authenticate. Logging
   * the user out is the correct outcome; leaving a thief with a valid session is
   * not.
   */
  async rotate(
    presentedToken: string,
    context: { ipAddress?: string | undefined; userAgent?: string | undefined },
  ): Promise<{ tokens: IssuedTokens; claims: AccessTokenClaims } | null> {
    const tokenHash = this.digest(presentedToken);

    const existing = await this.db.query.refreshTokens.findFirst({
      where: eq(schema.refreshTokens.tokenHash, tokenHash),
    });

    if (!existing) {
      return null;
    }

    // Replay of an already-rotated or revoked token: burn the whole family.
    if (existing.revokedAt !== null) {
      await this.revokeFamily(existing.familyId);
      return null;
    }

    if (existing.expiresAt.getTime() <= Date.now()) {
      return null;
    }

    const user = await this.db.query.users.findFirst({
      where: and(eq(schema.users.id, existing.userId), isNull(schema.users.deletedAt)),
    });

    if (!user || user.status !== 'active') {
      await this.revokeFamily(existing.familyId);
      return null;
    }

    const claims = await this.buildClaims(user);

    const tokens = await this.issue(claims, {
      ...context,
      familyId: existing.familyId,
    });

    await this.db
      .update(schema.refreshTokens)
      .set({
        revokedAt: new Date(),
        replacedByTokenHash: this.digest(tokens.refreshToken),
      })
      .where(eq(schema.refreshTokens.id, existing.id));

    return { tokens, claims };
  }

  async revoke(presentedToken: string): Promise<void> {
    await this.db
      .update(schema.refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(schema.refreshTokens.tokenHash, this.digest(presentedToken)));
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.db
      .update(schema.refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.refreshTokens.familyId, familyId),
          isNull(schema.refreshTokens.revokedAt),
        ),
      );
  }

  /** Used when suspending an account or after a password change. */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.db
      .update(schema.refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.refreshTokens.userId, userId),
          isNull(schema.refreshTokens.revokedAt),
        ),
      );
  }

  get refreshCookieMaxAge(): number {
    return this.refreshTtlSeconds * 1000;
  }

  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }
}

/** Constant-time comparison, for any future opaque-token comparisons. */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/** Parses `15m`, `30d`, `12h`, `45s` into seconds. */
function parseDuration(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value.trim());

  if (!match) {
    throw new Error(`Invalid duration "${value}". Use forms like 15m, 12h or 30d.`);
  }

  const amount = Number(match[1]);
  const multipliers = { s: 1, m: 60, h: 3600, d: 86_400 } as const;

  return amount * multipliers[match[2] as keyof typeof multipliers];
}

/**
 * Reads the scope claim back out of a verified token.
 *
 * Parsed defensively and defaulting to `UNSCOPED`, for two reasons. A token minted before this
 * claim existed has no `scope` at all, and must keep working. And an unreadable claim must not lock
 * a staff member out of the console — the write guards compare a row's city against the resolved
 * scope on every mutation regardless, so a widened READ from a malformed claim cannot become a
 * widened WRITE.
 */
function readScope(raw: unknown): StaffScope {
  if (typeof raw !== 'object' || raw === null) return UNSCOPED;

  const value = raw as Record<string, unknown>;

  if (value['kind'] !== 'cities') return UNSCOPED;

  const cityIds = Array.isArray(value['cityIds'])
    ? value['cityIds'].filter((id): id is string => typeof id === 'string')
    : [];

  return {
    kind: 'cities',
    cityIds,
    outside: value['outside'] === 'read_only' ? 'read_only' : 'none',
  };
}
