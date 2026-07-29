import { sql } from 'drizzle-orm';
import { numeric, timestamp, uuid } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';

/**
 * UUIDv7 primary keys: time-ordered, so B-tree inserts stay local like a sequence,
 * while remaining non-enumerable externally. Random UUIDv4 would scatter writes
 * across the index and degrade badly at the booking volumes this system targets.
 */
export const primaryId = () =>
  uuid('id')
    .primaryKey()
    // App-side generation avoids a round trip on every insert...
    .$defaultFn(() => uuidv7())
    // ...and the database default is the safety net for every OTHER writer: data
    // migrations, admin SQL, bulk imports, test fixtures. Without it those fail
    // with `null value in column "id"`. See migrations/pre/ for the function.
    .default(sql`uuidv7()`);

export const foreignId = (name: string) => uuid(name);

/**
 * SRS §13.3: every important table carries created_at, updated_at, deleted_at.
 * Deletion is always soft — principle P-003 forbids hard deletes outright.
 */
export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
};

/**
 * Append-only tables (ledger, audit log, timeline) intentionally omit updatedAt
 * and deletedAt: a row that can be amended is not an audit trail.
 */
export const createdAt = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
};

/**
 * Money is NEVER a float. numeric(14,2) is exact, and Drizzle surfaces it as a
 * string in TS — which forces callers through @safra/money instead of silently
 * doing IEEE-754 arithmetic on someone's payment.
 */
export const money = (name: string) => numeric(name, { precision: 14, scale: 2 });

/** FX rates need far more precision than money; SYP/USD is ~5 significant digits. */
export const fxRate = (name: string) => numeric(name, { precision: 18, scale: 8 });

/** Translatable text. Arabic, English and German are required from launch (§1.4). */
export const LOCALES = ['ar', 'en', 'de'] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * Predicate for partial unique indexes on soft-deleted tables. Without it, an
 * archived row would reserve its slug/code forever — and since P-003 forbids hard
 * deletes, "forever" is literal.
 */
export const notDeleted = sql`deleted_at IS NULL`;
