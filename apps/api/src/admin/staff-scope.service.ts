import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { ERROR, isScopable, type SetStaffScopeInput } from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import { AuditService } from '../common/audit/audit.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { badRequest, forbidden, notFound } from '../common/errors/app-error.js';

export interface StaffScopeView {
  readonly userId: string;
  readonly email: string;
  readonly role: string;
  readonly kind: string;
  readonly outside: string;
  readonly cities: readonly { readonly slug: string; readonly nameAr: string }[];
}

/**
 * Administering staff scope (design handoff §8.2, Bashar's decision 2026-08-04).
 *
 * ## Narrowing takes effect immediately; widening may lag
 *
 * Scope travels in the access token, which is the same trade ADR 0003 already made for
 * permissions: authorization stays off the hot path in exchange for up to fifteen minutes of
 * staleness. That is only tolerable in the GRANTING direction.
 *
 * So every change that could REMOVE authority revokes the member's refresh tokens, which forces a
 * re-login and a freshly-minted scope claim. Detecting "could remove" conservatively is the point:
 * any change to `kind`, any change to `outside`, and any city leaving the list all count. Widening
 * a city list does not, and neither does a no-op.
 *
 * ## A super admin is never scoped
 *
 * Refused outright. Scoping the only role that can un-scope an account is a lockout whose remedy
 * requires the person locked out — and the fix would be a psql session on production, which is the
 * access pattern the audit log exists to make unnecessary.
 *
 * ## Nobody scopes themselves
 *
 * Also refused. A staff member narrowing their own scope is harmless; widening it is privilege
 * escalation, and the two are the same endpoint. `STAFF_MANAGE` already restricts this to super
 * admins, who cannot be scoped anyway — so this guard exists for the case where that changes.
 */
@Injectable()
export class StaffScopeService {
  private readonly logger = new Logger(StaffScopeService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /** Every staff member's scope, for the الموظفون table's النطاق column. */
  async list(): Promise<StaffScopeView[]> {
    const result = await this.db.execute<{
      user_id: string;
      email: string;
      role: string;
      kind: string;
      outside: string;
      cities: { slug: string; nameAr: string }[] | null;
    }>(sql`
      SELECT u.id AS user_id, u.email, u.role::text AS role,
             u.scope_kind::text           AS kind,
             u.outside_scope_access::text AS outside,
             -- Aggregated in SQL rather than a second query per member: the staff table renders
             -- every row's scope, so a per-row lookup would be an N+1 on the page that shows it.
             (
               SELECT json_agg(json_build_object('slug', ci.slug, 'nameAr', ci.name_ar)
                               ORDER BY ci.name_ar)
               FROM staff_scope_cities sc
               JOIN cities ci ON ci.id = sc.city_id
               WHERE sc.user_id = u.id
             ) AS cities
      FROM users u
      WHERE u.deleted_at IS NULL
        AND u.role IN ('support_agent','finance_officer','operations_manager','super_admin')
      ORDER BY u.email
    `);

    return result.rows.map((row) => ({
      userId: row.user_id,
      email: row.email,
      role: row.role,
      kind: row.kind,
      outside: row.outside,
      cities: row.cities ?? [],
    }));
  }

  async set(
    actor: AccessTokenClaims | undefined,
    userId: string,
    input: SetStaffScopeInput,
  ): Promise<StaffScopeView> {
    if (actor?.sub === userId) {
      throw forbidden(ERROR.STAFF_CANNOT_CHANGE_OWN_SCOPE);
    }

    const found = await this.db.execute<{
      id: string;
      email: string;
      role: string;
      kind: string;
      outside: string;
    }>(sql`
      SELECT id, email, role::text AS role,
             scope_kind::text AS kind, outside_scope_access::text AS outside
      FROM users WHERE id = ${userId}::uuid AND deleted_at IS NULL
      LIMIT 1
    `);

    const user = found.rows[0];

    if (!user) throw notFound(ERROR.STAFF_NOT_FOUND);

    if (!isScopable(user.role as never)) {
      throw badRequest(ERROR.STAFF_ROLE_NOT_SCOPABLE);
    }

    /*
      Resolve slugs to ids BEFORE writing anything, and refuse the whole request if any slug is
      unknown. Silently dropping an unrecognised city would produce a narrower scope than the
      administrator asked for and tell them it succeeded.
    */
    const cityIds: string[] = [];

    if (input.kind === 'cities' && input.citySlugs.length > 0) {
      const cities = await this.db.execute<{ id: string; slug: string }>(sql`
        SELECT id, slug FROM cities
        WHERE slug = ANY(${input.citySlugs}::text[]) AND deleted_at IS NULL
      `);

      if (cities.rows.length !== new Set(input.citySlugs).size) {
        throw badRequest(ERROR.STAFF_CITIES_UNRECOGNISED);
      }

      cityIds.push(...cities.rows.map((row) => row.id));
    }

    const before = await this.cityIdsOf(userId);

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE users
        SET scope_kind = ${input.kind}::staff_scope_kind,
            outside_scope_access = ${input.outside}::outside_scope_access
        WHERE id = ${userId}::uuid
      `);

      /*
        Replace the whole set rather than diffing it. The join table is small, the transaction makes
        it atomic, and a diff would be three statements that can each be wrong — for no measurable
        gain on a table with at most a few rows per member.
      */
      await tx.execute(
        sql`DELETE FROM staff_scope_cities WHERE user_id = ${userId}::uuid`,
      );

      if (cityIds.length > 0) {
        await tx.execute(sql`
          INSERT INTO staff_scope_cities (user_id, city_id)
          SELECT ${userId}::uuid, unnest(${cityIds}::uuid[])
        `);
      }

      await this.audit.record(
        {
          actorUserId: actor?.sub,
          actorRole: actor?.role,
          action: 'staff.scope_changed',
          subjectType: 'user',
          subjectId: userId,
          before: { kind: user.kind, outside: user.outside, cityCount: before.length },
          after: {
            kind: input.kind,
            outside: input.outside,
            citySlugs: input.citySlugs,
          },
          reason: input.reason ?? null,
        },
        tx as unknown as Database,
      );
    });

    if (this.narrows(user, input, before, cityIds)) {
      /*
        Revoke every refresh token so the next request cannot be served on a token minted under the
        wider scope. The access token itself stays valid until it expires — same window ADR 0003
        already accepts — but it cannot be renewed, and the member is forced back through login.
      */
      await this.db.execute(sql`
        UPDATE refresh_tokens SET revoked_at = now()
        WHERE user_id = ${userId}::uuid AND revoked_at IS NULL
      `);

      this.logger.warn(
        `Scope narrowed for user ${userId} by ${actor?.sub ?? 'unknown'}; sessions revoked.`,
      );
    }

    const view = (await this.list()).find((row) => row.userId === userId);

    if (!view) throw notFound(ERROR.STAFF_NOT_FOUND);

    return view;
  }

  private async cityIdsOf(userId: string): Promise<string[]> {
    const result = await this.db.execute<{ city_id: string }>(sql`
      SELECT city_id FROM staff_scope_cities WHERE user_id = ${userId}::uuid
    `);

    return result.rows.map((row) => row.city_id);
  }

  /**
   * Whether this change could take authority away.
   *
   * Conservative on purpose: it answers "might this remove something", not "does it definitely".
   * A false positive costs one re-login; a false negative leaves somebody operating under a scope
   * that was revoked.
   */
  private narrows(
    user: { kind: string; outside: string },
    input: SetStaffScopeInput,
    beforeCities: readonly string[],
    afterCities: readonly string[],
  ): boolean {
    if (user.kind !== input.kind) return true;
    if (user.outside !== input.outside) return true;

    const after = new Set(afterCities);

    return beforeCities.some((id) => !after.has(id));
  }
}
