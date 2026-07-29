import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { createdAt, foreignId, primaryId, timestamps } from './_shared.js';
import { users } from './identity.js';

/**
 * Principle P-005, stated twice in the SRS: commissions, confirmation windows,
 * fines, same-day cutoff and refund policies "must be Configurable" and must NOT
 * live in the code (§0.1, §2.1, §3).
 *
 * This table is that promise. `scope` allows a global default to be overridden per
 * country, city or partner type without schema changes — resolution walks from the
 * most specific scope to the global default.
 *
 * Values are cached in Redis and invalidated on write; a settings read must never
 * cost a database round trip on the booking hot path.
 *
 * Bookings SNAPSHOT the values they used (see bookings.customerFeeRate). Changing
 * a setting must never retroactively alter a completed booking's arithmetic.
 */
export const settings = pgTable(
  'settings',
  {
    id: primaryId(),
    /** e.g. "commission.customer_rate", "booking.confirmation_window_minutes". */
    key: text('key').notNull(),
    /** "global" | "country" | "city" | "partner_type" */
    scope: text('scope').notNull().default('global'),
    /** Null when scope = global. */
    scopeId: foreignId('scope_id'),
    value: jsonb('value').notNull(),
    /** Zod schema name used to validate `value` before it is accepted. */
    valueSchema: text('value_schema').notNull(),
    descriptionAr: text('description_ar'),
    descriptionEn: text('description_en'),
    /** Editing this key requires this CASL permission (§4.1). */
    requiredPermission: text('required_permission').notNull().default('settings.update'),
    updatedByUserId: foreignId('updated_by_user_id').references(() => users.id),
    ...timestamps,
  },
  (t) => [
    index('settings_lookup_idx').on(t.key, t.scope, t.scopeId),
    index('settings_key_idx').on(t.key),
  ],
);

/** Append-only history, so "who changed the commission, and when" is answerable. */
export const settingsHistory = pgTable(
  'settings_history',
  {
    id: primaryId(),
    settingId: foreignId('setting_id')
      .notNull()
      .references(() => settings.id),
    key: text('key').notNull(),
    previousValue: jsonb('previous_value'),
    newValue: jsonb('new_value').notNull(),
    changedByUserId: foreignId('changed_by_user_id').references(() => users.id),
    reason: text('reason'),
    ...createdAt,
  },
  (t) => [index('settings_history_setting_idx').on(t.settingId, t.createdAt)],
);

/**
 * SRS §16 EC-009: Emergency Mode can be switched on for a city or a country to
 * halt bookings, waive fines, or broadcast a message during force majeure.
 */
export const emergencyModes = pgTable(
  'emergency_modes',
  {
    id: primaryId(),
    /** "global" | "country" | "city" */
    scope: text('scope').notNull(),
    scopeId: foreignId('scope_id'),
    flags: jsonb('flags')
      .$type<{
        haltNewBookings: boolean;
        waivePartnerFines: boolean;
        allowFreeCancellation: boolean;
      }>()
      .notNull(),
    messageAr: text('message_ar'),
    messageEn: text('message_en'),
    messageDe: text('message_de'),
    activatedByUserId: foreignId('activated_by_user_id')
      .notNull()
      .references(() => users.id),
    activatedAt: timestamp('activated_at', { withTimezone: true }).notNull().defaultNow(),
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
    deactivatedByUserId: foreignId('deactivated_by_user_id').references(() => users.id),
    reason: text('reason').notNull(),
    ...timestamps,
  },
  (t) => [index('emergency_modes_active_idx').on(t.scope, t.scopeId, t.deactivatedAt)],
);
