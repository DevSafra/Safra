import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { SignJWT, jwtVerify } from 'jose';
import { v7 as uuidv7 } from 'uuid';

import type { Database } from '@safra/db';
import { schema } from '@safra/db';
import {
  ERROR,
  TOGGLEABLE_GRANT_KEYS,
  UNSCOPED,
  isScopable,
  resolvePermissions,
  type StaffScope,
} from '@safra/contracts';
import type { Permission, Role } from '@safra/contracts';

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
    const familyId = context.familyId ?? uuidv7();

    await this.db.insert(schema.refreshTokens).values({
      userId: claims.sub,
      tokenHash: this.digest(refreshToken),
      familyId,
      expiresAt: refreshExpiresAt,
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null,
    });

    return {
      accessToken,
      expiresIn: this.accessTtlSeconds,
      refreshToken,
      refreshExpiresAt,
    };
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
      permissions: resolvePermissions(
        user.role,
        user.permissionOverrides ?? [],
        await this.enabledGrants(),
      ),
      locale: user.preferredLocale,
      totpEnabled: user.totpEnabledAt !== null,
      scope: await this.resolveScope(user),
    };

    return this.attachOwningIds(claims, user);
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
    if (user.role === 'customer') {
      const profile = await this.db.query.customerProfiles.findFirst({
        where: and(
          eq(schema.customerProfiles.userId, user.id),
          isNull(schema.customerProfiles.deletedAt),
        ),
        columns: { id: true },
      });
      claims.customerProfileId = profile?.id;
    }

    if (user.role === 'partner') {
      const partner = await this.db.query.partners.findFirst({
        where: and(
          eq(schema.partners.userId, user.id),
          isNull(schema.partners.deletedAt),
        ),
        columns: { id: true },
      });
      claims.partnerId = partner?.id;
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
