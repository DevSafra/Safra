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
 * Money is NEVER a float. `numeric` is exact, and Drizzle surfaces it as a string
 * in TS — which forces callers through the money helpers instead of silently
 * doing IEEE-754 arithmetic on someone's payment.
 *
 * ## Scale 3, because two is not enough for every currency SAFRA lists
 *
 * This was `numeric(14, 2)` and the scale was the COLUMN's rather than the
 * currency's. `currencies.decimals` already said JOD has three, and the column
 * could not hold the third: 10.125 JOD stored as 10.13, silently, at every step
 * of a booking. Nothing has lost money only because no JOD row has ever existed —
 * checked on 2026-08-26, every booking, unit and payment is USD or SYP.
 *
 * Three rather than four. It covers every currency SAFRA holds and the whole ISO
 * three-decimal set (JOD, KWD, BHD, OMR, TND); the four-decimal currencies are
 * two obscure index units nobody prices accommodation in. More scale is not free
 * — it widens every rounding decision and buys nothing real.
 *
 * Precision goes to 15 so the integer side keeps its twelve digits: 14,2 held
 * 999,999,999,999.99, and 14,3 would have quietly cost an order of magnitude on
 * a platform that settles in SYP, where one booking is already in the millions.
 *
 * ## Three decimals on the wire, and the currency's on the screen
 *
 * Postgres renders numeric(15,3) with three decimals always, so a USD amount
 * reads `109.000` from the database. That is the same VALUE and it is uniform —
 * a Drizzle read and a raw `::text` read agree, which a trimming column mapper
 * could not deliver because most of this codebase reads money through raw SQL.
 *
 * How many decimals a PERSON sees is a display decision made from the currency:
 * `amount(value, currency)` renders `$109.00` and `10.125 JOD` from the same
 * column. What is never allowed is INVENTING precision — a computed USD amount is
 * rounded to two before it is stored, by `quantise` in the API's money helpers.
 */
export const money = (name: string) => numeric(name, { precision: 15, scale: 3 });

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
