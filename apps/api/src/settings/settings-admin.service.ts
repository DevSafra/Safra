import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { isSanctionsPolicy, type Role } from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { SettingsService } from './settings.service.js';
import { normalise } from './money-settings.service.js';
import { ERROR } from '@safra/contracts';
import { badRequest } from '../common/errors/app-error.js';

export interface EditableSetting {
  readonly key: string;
  readonly value: unknown;
  readonly valueSchema: string;
  readonly descriptionEn: string | null;
  readonly descriptionAr: string | null;
  readonly updatedAt: string | null;
  readonly updatedByEmail: string | null;
}

/**
 * Reading and editing operational settings (SRS §9.3, P-005).
 *
 * P-005 says commissions, SLA windows, fines and the same-day cutoff "must be
 * Configurable" and must not live in code. They have been configurable since the
 * schema was written and editable only by hand — which satisfies the letter of the
 * principle and none of its intent.
 *
 * ## Validation is per `valueSchema`, not free-form
 *
 * Each row declares the shape its value must take. A rate stored as `"7%"` instead of
 * `0.07` would not fail loudly; it would silently make every commission calculation
 * wrong, because `getNumber` would fall back to its default and nothing would say so.
 * So the type is checked here against what the row itself claims to be.
 *
 * ## Every change is recorded twice
 *
 * An audit row (§15) and a `settings_history` row, in the same transaction as the
 * write. The history table exists to answer "what was the commission in March?", and
 * a booking's snapshot is only explicable alongside it.
 */
@Injectable()
export class SettingsAdminService {
  private readonly logger = new Logger(SettingsAdminService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<EditableSetting[]> {
    const rows = await this.db.execute<{
      key: string;
      value: unknown;
      value_schema: string;
      description_en: string | null;
      description_ar: string | null;
      updated_at: string | null;
      updated_by_email: string | null;
    }>(sql`
      SELECT s.key, s.value, s.value_schema, s.description_en, s.description_ar,
             s.updated_at::text, u.email AS updated_by_email
      FROM settings s
      LEFT JOIN users u ON u.id = s.updated_by_user_id
      WHERE s.scope = 'global' AND s.deleted_at IS NULL
      ORDER BY s.key
    `);

    return rows.rows.map((row) => ({
      key: row.key,
      value: row.value,
      valueSchema: row.value_schema,
      descriptionEn: row.description_en,
      descriptionAr: row.description_ar,
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      updatedByEmail: row.updated_by_email,
    }));
  }

  /**
   * Updates one setting.
   *
   * Deliberately one at a time rather than a bulk save. A screen that posts every
   * setting on every save turns an unrelated concurrent edit into a silent revert,
   * and it makes the audit trail read as though one person changed everything.
   */
  async update(
    key: string,
    value: unknown,
    reason: string | undefined,
    actor: { userId?: string | undefined; role?: Role | undefined },
  ): Promise<EditableSetting> {
    const existing = await this.db.execute<{
      id: string;
      value: unknown;
      value_schema: string;
    }>(sql`
      SELECT id, value, value_schema FROM settings
      WHERE key = ${key} AND scope = 'global' AND deleted_at IS NULL
    `);

    const row = existing.rows[0];

    /**
     * Only EXISTING keys can be edited. Creating one here would let a typo introduce
     * `commision.partner_rate`, which reads plausibly, is never consulted, and leaves
     * the real setting silently in force.
     */
    if (!row) {
      throw badRequest(ERROR.SETTING_UNKNOWN);
    }

    const validated = validate(value, row.value_schema, key);

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE settings
        SET value = ${JSON.stringify(validated)}::jsonb,
            updated_by_user_id = ${actor.userId ?? null},
            updated_at = now()
        WHERE id = ${row.id}
      `);

      /**
       * `settings_history` is the record that makes a past booking explicable: its
       * snapshot says the fee was 1.99, and only this says when that stopped being
       * true. Written in the same transaction, so a change can never exist without it.
       */
      await tx.execute(sql`
        INSERT INTO settings_history
          (setting_id, key, previous_value, new_value, changed_by_user_id, reason)
        VALUES (${row.id}, ${key}, ${JSON.stringify(row.value)}::jsonb,
                ${JSON.stringify(validated)}::jsonb, ${actor.userId ?? null},
                ${reason ?? null})
      `);

      await this.audit.record(
        {
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: 'setting.updated',
          subjectType: 'setting',
          subjectId: row.id,
          before: { key, value: row.value },
          after: { key, value: validated },
          reason: reason ?? null,
        },
        tx as unknown as Database,
      );
    });

    /**
     * Invalidated immediately rather than left to the 30-second TTL. An operator who
     * has just closed the same-day cutoff should see it take effect, not wonder
     * whether the save worked.
     */
    this.settings.invalidate(key);

    this.logger.log(
      `Setting ${key} changed by ${actor.userId ?? 'unknown'}: ` +
        `${JSON.stringify(row.value)} → ${JSON.stringify(validated)}.`,
    );

    const refreshed = await this.list();
    const updated = refreshed.find((setting) => setting.key === key);

    if (!updated) throw new Error('Setting vanished during update.');

    return updated;
  }

  /** The change history for one setting, newest first (§9.3). */
  async history(key: string, limit = 50) {
    const rows = await this.db.execute<{
      previous_value: unknown;
      new_value: unknown;
      reason: string | null;
      changed_by_email: string | null;
      created_at: string;
    }>(sql`
      SELECT h.previous_value, h.new_value, h.reason,
             u.email AS changed_by_email, h.created_at::text
      FROM settings_history h
      LEFT JOIN users u ON u.id = h.changed_by_user_id
      WHERE h.key = ${key}
      ORDER BY h.created_at DESC
      LIMIT ${limit}
    `);

    return rows.rows.map((row) => ({
      previousValue: row.previous_value,
      newValue: row.new_value,
      reason: row.reason,
      changedByEmail: row.changed_by_email,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }
}

/**
 * Checks a value against the shape its own row declares.
 *
 * The failure this prevents is silent: `SettingsService.getNumber` falls back to its
 * caller's default when a value is not a number, so a rate saved as a string would
 * leave every commission calculation quietly using the hardcoded fallback while the
 * admin screen showed the new figure.
 */
function validate(value: unknown, valueSchema: string, key: string): unknown {
  switch (valueSchema) {
    case 'rate': {
      const rate = Number(value);

      if (typeof value !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 1) {
        throw badRequest(ERROR.SETTING_VALUE_RATE, { key });
      }

      return rate;
    }

    case 'percent': {
      if (typeof value !== 'number' || value < 0 || value > 100) {
        throw badRequest(ERROR.SETTING_VALUE_PERCENT_RANGE, { key });
      }

      return value;
    }

    case 'positiveInt': {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
        throw badRequest(ERROR.SETTING_VALUE_POSITIVE_INT, { key });
      }

      return value;
    }

    case 'hourOfDay': {
      if (
        typeof value !== 'number' ||
        !Number.isInteger(value) ||
        value < 0 ||
        value > 23
      ) {
        throw badRequest(ERROR.SETTING_VALUE_HOUR_OF_DAY, { key });
      }

      return value;
    }

    case 'money': {
      /**
       * Accepts both money shapes — a bare number meaning USD, or
       * `{ amount, currency }` — and rejects anything `normalise` cannot read,
       * including negatives. A negative fine inverts who owes whom.
       */
      const money = normalise(value);

      if (!money) {
        throw new BadRequestException(
          `${key} must be a positive amount, either a number or ` +
            `{ "amount": "10.00", "currency": "USD" }.`,
        );
      }

      return value;
    }

    case 'boolean': {
      if (typeof value !== 'boolean') {
        throw badRequest(ERROR.SETTING_VALUE_BOOLEAN, { key });
      }

      return value;
    }

    case 'feeMode': {
      if (value !== 'flat' && value !== 'percent') {
        throw badRequest(ERROR.SETTING_VALUE_FLAT_OR_PERCENT, { key });
      }

      return value;
    }

    /**
     * How hard sanctions screening bites — see `@safra/contracts/compliance`.
     *
     * Validated against the contract's own list rather than a copy of it. This one is worth being
     * strict about beyond the usual reason: an unrecognised value here would fall back to
     * `DEFAULT_SANCTIONS_POLICY` at every read, so a typo would silently change a compliance
     * control's severity and nothing would say so.
     */
    case 'sanctionsPolicy': {
      if (!isSanctionsPolicy(value)) {
        throw badRequest(ERROR.SETTING_VALUE_SANCTIONS_POLICY, { key });
      }

      return value;
    }

    default: {
      /**
       * An unrecognised schema is not waved through.
       *
       * `payment.provider_routing` is the live example: a nested object whose shape
       * this function cannot check. Editing it from a generic form would be a good
       * way to break payment routing with a typo, so it is refused here and stays a
       * deliberate, reviewed change.
       */
      throw new BadRequestException(
        `${key} has schema "${valueSchema}", which this editor cannot validate. ` +
          `It must be changed deliberately rather than through the settings form.`,
      );
    }
  }
}
