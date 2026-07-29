import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { SignJWT, jwtVerify } from 'jose';
import { v7 as uuidv7 } from 'uuid';

import type { Database } from '@safra/db';
import { schema } from '@safra/db';
import { resolvePermissions } from '@safra/contracts';
import type { Permission, Role } from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import { ENV, type Env } from '../config/env.js';

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
    const accessToken = await new SignJWT({
      role: claims.role,
      permissions: claims.permissions,
      locale: claims.locale,
      customerProfileId: claims.customerProfileId,
      partnerId: claims.partnerId,
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
      };
    } catch {
      throw new UnauthorizedException('Invalid or expired token.');
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
      permissions: resolvePermissions(user.role, user.permissionOverrides ?? []),
      locale: user.preferredLocale,
    };

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
