import { sql } from 'drizzle-orm';

import type { Database, Transaction } from '@safra/db';

/**
 * Whether `db:testbed`'s cleanup cascade still covers every relationship the database has.
 *
 * ## Why this is its own module
 *
 * So a TEST can ask the same question. `seed-testbed.ts` calls `main()` at module scope — importing
 * it seeds a database — and the list of tables that script has to clear is exactly the kind of
 * hand-maintained thing that rots between the day it is written and the day somebody runs it. It
 * had rotted by TEN tables when this was extracted, on 2026-08-27.
 *
 * `testbed-cascade.integration.test.ts` runs the same check inside `pnpm verify`, so a table added
 * with a foreign key to something the testbed deletes fails on the commit that adds it rather than
 * weeks later, on a reset somebody needed at the time.
 */

/** Either a pool or a transaction on one — the script runs its whole cascade inside one. */
type Handle = Database | Transaction;

/**
 * The tables this script deletes as PARENTS — the roots of its cleanup cascade.
 *
 * `users` is deliberately not one: accounts are reused rather than deleted, because signing in
 * writes an append-only `audit_log` row that pins them. See the note beside `DELETE FROM partners`.
 */
export const CASCADE_ROOTS = [
  'bookings',
  'properties',
  'units',
  'customer_profiles',
  'partners',
  'payments',
  'refunds',
  'wallets',
  'gift_cards',
  'conversations',
  'disputes',
  'partner_payouts',
  'partner_applications',
  'coupons',
] as const;

/**
 * Every table the cascade below clears, listed so the database can be asked whether that is enough.
 *
 * A root appears here too: a root of one relationship is a child of another — `bookings` is deleted
 * as a parent AND references `customer_profiles`, `properties` and `units`.
 */
export const CASCADE_HANDLES = new Set<string>([
  ...CASCADE_ROOTS,
  'availability_days',
  'booking_internal_notes',
  'booking_verifications',
  'coupon_redemptions',
  'dispute_evidence',
  'favourites',
  'gift_card_transactions',
  'ledger_entries',
  'messages',
  'notifications',
  'partner_application_contacts',
  'partner_contract_signatures',
  'partner_contracts',
  'partner_documents',
  'partner_employee_roles',
  'partner_employees',
  'partner_payout_accounts',
  'partner_payout_items',
  'partner_violations',
  'payment_provider_events',
  'property_images',
  'reviews',
  'unit_amenities',
  'wallet_transactions',
]);

/**
 * Every table that references one this script deletes and is NOT in its cascade.
 *
 * ## Why this exists
 *
 * The cascade is a hand-written list of twenty-eight tables in foreign-key order, and it has to
 * stay in step with every relationship anyone adds. It does not: on 2026-08-27 TEN were missing —
 * `booking_verifications` and `booking_internal_notes` and `coupon_redemptions` off a booking,
 * `unit_amenities` off a unit, and six off a partner including the contract, its signatures, the
 * employee roster and the payout account. Each arrived with a feature; none had a row on a fixture
 * yet, so the reset kept working until one did.
 *
 * The failure mode is what makes it worth a guard rather than a note. Postgres answers with a
 * constraint name, drizzle truncates the query, and the seed's own transaction rolls back — so the
 * symptom is «a reset that reported something and changed nothing», hours before anybody connects
 * it to a table added last week. This is the third time that exact sentence has been written into
 * this file.
 *
 * Asked of the DATABASE rather than of the schema files, because the database is what will refuse
 * the delete. Run BEFORE the first statement, so the answer is a sentence naming the table instead
 * of a rollback naming a constraint.
 *
 * ## It reports what is MISSING, never what is unused
 *
 * A stale entry in `CASCADE_HANDLES` is harmless — the delete simply matches nothing. A missing one
 * stops the script. Only the direction that can break anything is enforced, so this cannot become
 * the kind of exemption list that decays into hiding things.
 */ export async function findUnhandledReferences(
  db: Handle,
): Promise<{ child: string; parent: string }[]> {
  /*
    An IN list built with `sql.join`, not `${array}`. A JS array inside a drizzle template expands
    to a positional tuple, which is a documented trap in this codebase.
  */
  const roots = sql.join(
    CASCADE_ROOTS.map((table) => sql`${table}`),
    sql`, `,
  );

  const rows = await db.execute<{ child: string; parent: string }>(sql`
    SELECT DISTINCT c.conrelid::regclass::text AS child,
                    c.confrelid::regclass::text AS parent
    FROM pg_constraint c
    WHERE c.contype = 'f'
      AND c.confrelid::regclass::text IN (${roots})
    ORDER BY 1`);

  return rows.rows.filter((row) => !CASCADE_HANDLES.has(row.child));
}

/** The same question, as a refusal — what `db:testbed` calls before its first delete. */
export async function assertCascadeIsComplete(db: Handle): Promise<void> {
  const missing = await findUnhandledReferences(db);

  if (missing.length > 0) {
    throw new Error(
      `db:testbed cannot run: ${missing.length} table(s) reference something this script ` +
        'deletes and are not in its cleanup cascade — ' +
        missing.map((row) => `${row.child} → ${row.parent}`).join(', ') +
        '. Add a DELETE for each in `build()`, before the parent it points at, and add its name ' +
        'to `CASCADE_HANDLES`. Deleting first and discovering this from a foreign-key error is ' +
        'what this check exists to replace.',
    );
  }
}
