import { Body, Controller, Get, Inject, Injectable, Logger, Put } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import type { Database } from '@safra/db';
import {
  PERMISSIONS as P,
  TOGGLEABLE_GRANTS,
  TOGGLEABLE_GRANT_KEYS,
  type ToggleableGrantKey,
} from '@safra/contracts';

import { AuditExempt } from '../common/audit/audit.interceptor.js';
import { AuditService } from '../common/audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { SettingsService } from '../settings/settings.service.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser, RequirePermissions } from '../rbac/decorators.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

const grantUpdateSchema = z
  .object({
    key: z.enum(TOGGLEABLE_GRANT_KEYS as [ToggleableGrantKey, ...ToggleableGrantKey[]]),
    enabled: z.boolean(),
  })
  .strict();

type GrantUpdate = z.infer<typeof grantUpdateSchema>;

/**
 * Turning a runtime permission grant on or off (§4.1).
 *
 * The list of what can be toggled lives in `@safra/contracts`, not here and not in
 * the database. A settings-driven RBAC editor that could grant anything to anyone
 * would destroy the property that makes the permission model reviewable — that
 * "what can this role do?" is answered by reading one file — and it would destroy it
 * quietly, which is worse.
 *
 * `SETTINGS_UPDATE` belongs to `super_admin` alone, so widening a role stays a
 * super-admin decision even though the mechanism is now configuration.
 */
@Injectable()
export class AdminGrantsService {
  private readonly logger = new Logger(AdminGrantsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<
    { key: string; role: string; permission: string; enabled: boolean }[]
  > {
    const rows = [];

    for (const key of TOGGLEABLE_GRANT_KEYS) {
      rows.push({
        key,
        role: TOGGLEABLE_GRANTS[key].role,
        permission: TOGGLEABLE_GRANTS[key].permission,
        enabled: await this.settings.get<boolean>(key, false),
      });
    }

    return rows;
  }

  async set(
    input: GrantUpdate,
    actor: AccessTokenClaims | undefined,
  ): Promise<{ key: string; enabled: boolean; sessionsRevoked: number }> {
    const grant = TOGGLEABLE_GRANTS[input.key];
    const previous = await this.settings.get<boolean>(input.key, false);

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO settings (key, scope, value, value_schema, required_permission,
                              updated_by_user_id, description_en)
        VALUES (${input.key}, 'global', ${JSON.stringify(input.enabled)}::jsonb,
                'boolean', 'settings.update', ${actor?.sub ?? null},
                ${`Grants ${grant.permission} to ${grant.role} while enabled.`})
        ON CONFLICT (key, scope, scope_id) WHERE deleted_at IS NULL DO UPDATE
          SET value = EXCLUDED.value,
              updated_by_user_id = EXCLUDED.updated_by_user_id,
              updated_at = now()
      `);

      await this.audit.record(
        {
          actorUserId: actor?.sub,
          actorRole: actor?.role,
          action: 'rbac.grant_toggled',
          subjectType: 'setting',
          subjectId: null,
          before: { key: input.key, enabled: previous },
          after: {
            key: input.key,
            enabled: input.enabled,
            role: grant.role,
            permission: grant.permission,
          },
        },
        tx as unknown as Database,
      );
    });

    this.settings.invalidate(input.key);

    /**
     * Sessions are revoked when a grant is REMOVED, not when it is added.
     *
     * Permissions live in the access token (ADR 0003), so a change takes up to
     * fifteen minutes to propagate. Waiting is fine for a grant — the person simply
     * gains the ability slightly late. It is not fine for a revocation: an
     * administrator who has just decided finance should no longer set FX rates does
     * not mean "in a quarter of an hour". Adding is lazy, taking away is immediate.
     */
    const sessionsRevoked =
      previous && !input.enabled ? await this.revokeRole(grant.role) : 0;

    this.logger.log(
      `Grant ${input.key} ${input.enabled ? 'enabled' : 'disabled'} by ` +
        `${actor?.sub ?? 'unknown'}; ${sessionsRevoked} session(s) revoked.`,
    );

    return { key: input.key, enabled: input.enabled, sessionsRevoked };
  }

  /** Ends every live session for a role, so a withdrawn grant bites immediately. */
  private async revokeRole(role: string): Promise<number> {
    const result = await this.db.execute<{ count: string }>(sql`
      WITH revoked AS (
        UPDATE refresh_tokens rt
        SET revoked_at = now()
        FROM users u
        WHERE u.id = rt.user_id
          AND u.role = ${role}::user_role
          AND rt.revoked_at IS NULL
        RETURNING rt.id
      )
      SELECT COUNT(*)::text AS count FROM revoked
    `);

    return Number(result.rows[0]?.count ?? 0);
  }
}

@Controller('admin/grants')
export class AdminGrantsController {
  constructor(private readonly grants: AdminGrantsService) {}

  @Get()
  @RequirePermissions(P.SETTINGS_READ)
  async list() {
    return { grants: await this.grants.list() };
  }

  /**
   * `SETTINGS_UPDATE`, which only `super_admin` holds. Widening a role must not be
   * something a role can do to itself.
   */
  @Put()
  @RequirePermissions(P.SETTINGS_UPDATE)
  @AuditExempt(
    'AdminGrantsService records rbac.grant_toggled inside the write transaction.',
  )
  async set(
    @Body(new ZodValidationPipe(grantUpdateSchema)) body: GrantUpdate,
    @CurrentUser() user: AccessTokenClaims | undefined,
  ) {
    return this.grants.set(body, user);
  }
}
