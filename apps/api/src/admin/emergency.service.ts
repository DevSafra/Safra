import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import type { Database } from '@safra/db';
import type { AccessTokenClaims } from '../auth/token.service.js';

import { DATABASE } from '../database/database.module.js';
import { AuditService } from '../common/audit/audit.service.js';
import { ERROR } from '@safra/contracts';
import { forbidden } from '../common/errors/app-error.js';

/**
 * The four levers Emergency Mode pulls (EC-009, design handoff §8.3).
 *
 * Each maps onto a rule the platform enforces elsewhere, and they are independent because a
 * real incident rarely needs all four: a storm closing one coastal city needs bookings stopped
 * and fines waived; a national outage of the payment provider needs the confirmation SLA
 * suspended and nothing else.
 */
export const emergencyFlagsSchema = z
  .object({
    /** Stop accepting new bookings inside the scope. */
    stopBookings: z.boolean(),
    /** Waive partner no-response fines — they did not choose the incident. */
    waiveFines: z.boolean(),
    /** Broadcast to customers holding upcoming bookings in the scope. */
    broadcast: z.boolean(),
    /** Suspend the two-hour partner confirmation deadline. */
    suspendSla: z.boolean(),
  })
  .strict();

export type EmergencyFlags = z.infer<typeof emergencyFlagsSchema>;

export const activateEmergencySchema = z
  .object({
    scope: z.enum(['city', 'country']),
    /** The city or country the scope refers to, by its own slug/code — never a raw uuid. */
    scopeRef: z.string().min(1).max(64),
    flags: emergencyFlagsSchema,
    /**
     * Required, and stored.
     *
     * An emergency declaration with no stated reason is unauditable after the fact, and this
     * is the single most consequential switch in the console — it stops the platform taking
     * money in a region. Whoever reviews it next month needs to know why.
     */
    reason: z.string().min(10).max(500),
  })
  .strict();

export type ActivateEmergencyInput = z.infer<typeof activateEmergencySchema>;

export interface EmergencyModeView {
  readonly id: string;
  readonly scope: string;
  readonly scopeName: string;
  readonly flags: EmergencyFlags;
  readonly reason: string | null;
  readonly activatedBy: string | null;
  readonly activatedAt: string;
  readonly deactivatedAt: string | null;
  readonly deactivatedBy: string | null;
}

/**
 * Emergency Mode (EC-009) — the 19th admin section.
 *
 * ## Super Admin only, and checked here as well as at the route
 *
 * `EMERGENCY_MODE_ACTIVATE` guards the endpoint, but the role is re-checked in this service.
 * That is deliberate duplication: this switch halts commerce in a region, and the cost of a
 * future refactor accidentally widening the guard is far higher than the cost of one redundant
 * comparison. Deny by default, twice.
 *
 * ## Activation is a new row, never an update
 *
 * Deactivating sets `deactivated_at` and activating inserts. Nothing is overwritten, so the
 * history of "what was suspended, where, by whom, and for how long" survives — which is the
 * record a regulator or an insurer asks for, and the one an `UPDATE … SET active = false`
 * would destroy.
 */
@Injectable()
export class EmergencyService {
  private readonly logger = new Logger(EmergencyService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /** Every declaration, newest first. Small by nature — an incident is rare. */
  async history(limit = 20): Promise<EmergencyModeView[]> {
    const result = await this.db.execute<EmergencyRowSql>(sql`
      SELECT e.id, e.scope, e.flags, e.reason,
             coalesce(ci.name_ar, co.name_ar, '—') AS scope_name,
             au.email AS activated_by,
             du.email AS deactivated_by,
             to_char(e.activated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
               AS activated_at,
             to_char(e.deactivated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
               AS deactivated_at
      FROM emergency_modes e
      LEFT JOIN cities ci    ON ci.id = e.scope_id AND e.scope = 'city'
      LEFT JOIN countries co ON co.id = e.scope_id AND e.scope = 'country'
      LEFT JOIN users au     ON au.id = e.activated_by_user_id
      LEFT JOIN users du     ON du.id = e.deactivated_by_user_id
      WHERE e.deleted_at IS NULL
      ORDER BY e.activated_at DESC
      LIMIT ${limit}
    `);

    return result.rows.map(toView);
  }

  /** The currently-active declarations. Drives the console-wide banner. */
  async active(): Promise<EmergencyModeView[]> {
    const result = await this.db.execute<EmergencyRowSql>(sql`
      SELECT e.id, e.scope, e.flags, e.reason,
             coalesce(ci.name_ar, co.name_ar, '—') AS scope_name,
             au.email AS activated_by,
             NULL::text AS deactivated_by,
             to_char(e.activated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
               AS activated_at,
             NULL::text AS deactivated_at
      FROM emergency_modes e
      LEFT JOIN cities ci    ON ci.id = e.scope_id AND e.scope = 'city'
      LEFT JOIN countries co ON co.id = e.scope_id AND e.scope = 'country'
      LEFT JOIN users au     ON au.id = e.activated_by_user_id
      WHERE e.deactivated_at IS NULL AND e.deleted_at IS NULL
      ORDER BY e.activated_at DESC
    `);

    return result.rows.map(toView);
  }

  async activate(
    actor: AccessTokenClaims | undefined,
    input: ActivateEmergencyInput,
  ): Promise<EmergencyModeView> {
    this.requireSuperAdmin(actor);

    /**
     * The scope is resolved from a slug or country code, and a miss is a 403-shaped refusal
     * rather than a 404 — the endpoint must not become a way to enumerate which cities exist.
     */
    const target = await this.resolveScope(input.scope, input.scopeRef);

    if (!target) {
      throw forbidden(ERROR.EMERGENCY_ACTIVATION_FAILED);
    }

    const inserted = await this.db.execute<{ id: string }>(sql`
      INSERT INTO emergency_modes
        (scope, scope_id, flags, activated_by_user_id, activated_at, reason)
      VALUES (${input.scope}, ${target.id}::uuid, ${JSON.stringify(input.flags)}::jsonb,
              ${actor?.sub}::uuid, now(), ${input.reason})
      RETURNING id
    `);

    const id = inserted.rows[0]?.id;

    /*
      Logged at WARN, not INFO. This is the one console action that should page somebody, and
      an alerting rule can key on the level without parsing the message.

      The actor is identified by USER ID, not email: rule 1 forbids full PII in logs, and the
      audit row written just below carries the identity properly.
    */
    this.logger.warn(
      `Emergency mode ACTIVATED for ${input.scope} ${input.scopeRef} ` +
        `by user ${actor?.sub ?? 'unknown'}: ${input.reason}`,
    );

    await this.audit.record({
      actorUserId: actor?.sub,
      actorRole: actor?.role,
      action: 'emergency_mode.activated',
      subjectType: 'emergency_mode',
      subjectId: id ?? null,
      after: { scope: input.scope, scopeRef: input.scopeRef, flags: input.flags },
      reason: input.reason,
    });

    const [view] = await this.active();

    /*
      The freshly-inserted row is re-read rather than synthesised from the input, so what the
      console shows is what the database holds — including any default the schema applied.
    */
    if (!view) throw forbidden(ERROR.EMERGENCY_ACTIVATION_FAILED);

    return view;
  }

  async deactivate(
    actor: AccessTokenClaims | undefined,
    id: string,
    reason: string,
  ): Promise<void> {
    this.requireSuperAdmin(actor);

    await this.db.execute(sql`
      UPDATE emergency_modes
      SET deactivated_at = now(), deactivated_by_user_id = ${actor?.sub}::uuid
      WHERE id = ${id}::uuid AND deactivated_at IS NULL
    `);

    this.logger.warn(
      `Emergency mode DEACTIVATED (${id}) by user ${actor?.sub ?? 'unknown'}: ${reason}`,
    );

    await this.audit.record({
      actorUserId: actor?.sub,
      actorRole: actor?.role,
      action: 'emergency_mode.deactivated',
      subjectType: 'emergency_mode',
      subjectId: id,
      reason,
    });
  }

  /** Cities and countries that can be a scope, for the two selects in the design. */
  async scopes(): Promise<{
    cities: { ref: string; name: string }[];
    countries: { ref: string; name: string }[];
  }> {
    const [cities, countries] = await Promise.all([
      this.db.execute<{ ref: string; name: string }>(sql`
        SELECT ci.slug AS ref, ci.name_ar || ' — ' || coalesce(co.name_ar, '') AS name
        FROM cities ci
        LEFT JOIN countries co ON co.id = ci.country_id
        WHERE ci.is_active AND ci.deleted_at IS NULL
        ORDER BY ci.name_ar
      `),
      this.db.execute<{ ref: string; name: string }>(sql`
        SELECT code AS ref, name_ar AS name FROM countries
        WHERE is_active AND deleted_at IS NULL ORDER BY name_ar
      `),
    ]);

    return { cities: cities.rows, countries: countries.rows };
  }

  private async resolveScope(
    scope: 'city' | 'country',
    ref: string,
  ): Promise<{ id: string } | null> {
    const result =
      scope === 'city'
        ? await this.db.execute<{ id: string }>(
            sql`SELECT id FROM cities WHERE slug = ${ref} AND deleted_at IS NULL LIMIT 1`,
          )
        : await this.db.execute<{ id: string }>(
            sql`SELECT id FROM countries WHERE code = ${ref} AND deleted_at IS NULL LIMIT 1`,
          );

    return result.rows[0] ?? null;
  }

  private requireSuperAdmin(actor: AccessTokenClaims | undefined): void {
    if (actor?.role !== 'super_admin') {
      // Generic to the client; the guard already logged the specifics.
      throw forbidden(ERROR.EMERGENCY_ACTIVATION_FAILED);
    }
  }
}

interface EmergencyRowSql extends Record<string, unknown> {
  id: string;
  scope: string;
  scope_name: string;
  flags: unknown;
  reason: string | null;
  activated_by: string | null;
  deactivated_by: string | null;
  activated_at: string;
  deactivated_at: string | null;
}

/**
 * `flags` is `jsonb` and therefore `unknown` at the boundary — parsed, not cast.
 *
 * A row written before a flag existed simply lacks the key, so an unparseable payload falls
 * back to all-false rather than throwing: the screen must still be able to show that an
 * emergency is active even if one of its options cannot be read.
 */
function toView(row: EmergencyRowSql): EmergencyModeView {
  const parsed = emergencyFlagsSchema.safeParse(row.flags);

  return {
    id: row.id,
    scope: row.scope,
    scopeName: row.scope_name,
    flags: parsed.success
      ? parsed.data
      : { stopBookings: false, waiveFines: false, broadcast: false, suspendSla: false },
    reason: row.reason,
    activatedBy: row.activated_by,
    activatedAt: row.activated_at,
    deactivatedAt: row.deactivated_at,
    deactivatedBy: row.deactivated_by,
  };
}
