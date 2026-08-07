import { Pool } from 'pg';

/**
 * Clears a DEVELOPMENT database of accumulated test data, keeping the accounts you sign in with.
 *
 * ## Why this exists, and why it is not part of the seed
 *
 * `src/seed/index.ts` says, correctly, that it contains no truncate anywhere — principle P-003
 * forbids destructive operations and a seed that wipes tables is how a production dataset gets
 * lost. This is the opposite kind of tool: a deliberate, guarded, developer-invoked reset, run by
 * hand and never by a deploy. It lives in `scripts/` beside `bootstrap-super-admin.ts` rather than
 * in `seed/` so that distinction is structural rather than remembered.
 *
 * The database it was written for had accumulated 12,297 users, 5,250 bookings and 17,067 audit
 * rows across months of integration-test runs — 2,262 of those users were super admins. That is
 * not a dataset anybody can test against (Bashar, 2026-08-06).
 *
 * ## What it keeps
 *
 * - Every account in `KEEP_EMAILS`, and nothing else with a login.
 * - Reference data — countries, cities, currencies, property and partner types, amenities,
 *   cancellation policies, settings, FX rates, sanctions lists. These are the platform's
 *   vocabulary, not test data, and re-seeding them is slow and pointless.
 *
 * ## TRUNCATE, and a gap it revealed
 *
 * Six tables are append-only, enforced by `BEFORE UPDATE OR DELETE ... FOR EACH ROW` triggers
 * (`post/0001_constraints.sql`). PostgreSQL does NOT fire row-level triggers on TRUNCATE, so this
 * script clears them without touching the triggers at all — which is convenient here and is a real
 * hole in the guarantee everywhere else. `docs/FUTURE-WORK.md` carries it as an open item; the fix
 * is a `BEFORE TRUNCATE` statement trigger on the same six tables.
 *
 * ## Safety
 *
 * Refuses unless the connection string is local AND `--yes` is passed. Everything happens in one
 * transaction, so a failure anywhere leaves the database exactly as it was.
 */

/** The only accounts that survive. Everything else with a login is treated as test debris. */
const KEEP_EMAILS = (process.env['RESET_KEEP_EMAILS'] ?? 'ops@safra.test')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

/**
 * Reference data — the platform's vocabulary, not anybody's test run.
 *
 * `settings` is here deliberately: commission rates, SLA windows and the FX rate are operational
 * configuration, and clearing them would leave an API that refuses to price a booking.
 */
const KEEP_TABLES = new Set([
  'countries',
  'cities',
  'city_images',
  'currencies',
  'fx_rates',
  'property_types',
  'partner_types',
  'amenities',
  'cancellation_policies',
  'settings',
  'sanctions_entries',
  'sanctions_snapshots',
  '__drizzle_migrations',
]);

/**
 * Cleared wholesale. `users` is absent on purpose — it is the one table with rows worth keeping,
 * so it gets a DELETE with a WHERE rather than a TRUNCATE.
 */
const CLEAR_TABLES = [
  'ad_campaigns',
  'advertisers',
  'audit_log',
  'auth_tokens',
  'availability_days',
  'bookings',
  'conversations',
  'coupon_redemptions',
  'coupons',
  'customer_profiles',
  'dispute_evidence',
  'disputes',
  'emergency_modes',
  'gift_card_transactions',
  'gift_cards',
  'idempotency_keys',
  'ledger_entries',
  'messages',
  'notifications',
  'partner_contracts',
  'partner_documents',
  'partner_payout_accounts',
  'partner_payout_items',
  'partner_payouts',
  'partner_violations',
  'partners',
  'payment_provider_events',
  'payments',
  'properties',
  'property_images',
  'refresh_tokens',
  'refunds',
  'settings_history',
  'staff_scope_cities',
  'timeline_events',
  'unit_amenities',
  'units',
  'wallet_transactions',
  'wallets',
];

function assertSafe(connectionString: string): void {
  const local =
    connectionString.includes('@localhost') ||
    connectionString.includes('@127.0.0.1') ||
    connectionString.includes('@db:');

  if (!local) {
    throw new Error(
      'Refusing to run: DATABASE_URL does not point at a local database. This script deletes ' +
        'almost everything and exists only for a development machine.',
    );
  }

  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('Refusing to run with NODE_ENV=production.');
  }

  if (!process.argv.includes('--yes')) {
    throw new Error(
      'Refusing to run without --yes. This deletes every account except: ' +
        KEEP_EMAILS.join(', '),
    );
  }
}

async function main(): Promise<void> {
  const connectionString = process.env['DATABASE_URL'];

  if (!connectionString) throw new Error('DATABASE_URL is required.');

  assertSafe(connectionString);

  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();

  try {
    await assertEveryTableIsAccountedFor(client);

    const before = await counts(client);

    await client.query('BEGIN');

    /*
      One statement, so PostgreSQL resolves the order itself. TRUNCATE takes an ACCESS EXCLUSIVE
      lock on every named table at once, which also means it cannot deadlock against itself the
      way a sequence of DELETEs in a guessed order can.

      No CASCADE: every table that references these is either in the list or is `users`, which is
      handled below. If that stops being true the statement FAILS, which is the right outcome —
      silently truncating a table nobody listed is how a reset script becomes a data-loss story.
    */
    await client.query(`TRUNCATE TABLE ${CLEAR_TABLES.join(', ')} RESTART IDENTITY`);

    const kept = await client.query<{ email: string }>(
      'DELETE FROM users WHERE lower(email) <> ALL($1::text[]) RETURNING email',
      [KEEP_EMAILS],
    );

    await client.query('COMMIT');

    const after = await counts(client);

    console.log(`\nRemoved ${kept.rowCount ?? 0} user accounts.\n`);
    console.log('table                     before      after');

    for (const [table, n] of Object.entries(before)) {
      const now = after[table] ?? 0;

      if (n !== now || n > 0) {
        console.log(
          `${table.padEnd(24)} ${String(n).padStart(7)} ${String(now).padStart(10)}`,
        );
      }
    }

    await assertTriggersIntact(client);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

/**
 * Every table must be a deliberate choice: cleared, kept, or `users`.
 *
 * A new table that nobody adds to either list is not caught by the TRUNCATE — it simply survives,
 * and a reset that leaves data behind is worse than one that fails, because the next seed builds on
 * rows the developer believes are gone. `partner_payouts` and `partner_payout_items` did exactly
 * that: they were added with the payout ledger, missed here, and the leftovers then blocked the
 * testbed from deleting the bookings they referenced.
 *
 * Checked BEFORE the transaction, so an unlisted table stops the run rather than aborting it
 * halfway. The message names the table, which is the whole fix.
 */
async function assertEveryTableIsAccountedFor(client: {
  query: (sql: string) => Promise<{ rows: { table_name: string }[] }>;
}): Promise<void> {
  const { rows } = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `);

  const known = new Set([...CLEAR_TABLES, ...KEEP_TABLES, 'users']);
  const unlisted = rows.map((r) => r.table_name).filter((name) => !known.has(name));

  if (unlisted.length > 0) {
    throw new Error(
      `Refusing to run: ${unlisted.join(', ')} ${unlisted.length === 1 ? 'is' : 'are'} in the ` +
        'database but in neither CLEAR_TABLES nor KEEP_TABLES. Decide which, then re-run — a ' +
        'reset that quietly leaves a table populated is a worse outcome than this error.',
    );
  }
}

async function counts(client: {
  query: (sql: string) => Promise<{ rows: { n: number }[] }>;
}): Promise<Record<string, number>> {
  const out: Record<string, number> = {};

  for (const table of [...CLEAR_TABLES, 'users', ...KEEP_TABLES].filter(
    (t) => t !== '__drizzle_migrations',
  )) {
    const result = await client.query(`SELECT count(*)::int AS n FROM ${table}`);

    out[table] = result.rows[0]?.n ?? 0;
  }

  return out;
}

/**
 * The append-only triggers must still be there afterwards.
 *
 * TRUNCATE does not fire them and does not drop them, so this should always pass — it is here
 * because "should always pass" is exactly the kind of assumption that stops being true, and a
 * reset script that quietly disarmed the P-003 guarantee would be a bad way to find out.
 */
async function assertTriggersIntact(client: {
  query: (sql: string) => Promise<{ rows: { tgname: string }[] }>;
}): Promise<void> {
  /* Seven, not six — `messages` carries the same trigger and was missed on the first pass. */
  const expected = [
    'audit_log',
    'ledger_entries',
    'timeline_events',
    'wallet_transactions',
    'gift_card_transactions',
    'settings_history',
    'messages',
  ];

  const result = await client.query(
    `SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE '%_immutable'`,
  );
  const present = new Set(result.rows.map((row) => row.tgname));
  const missing = expected.filter((table) => !present.has(`${table}_immutable`));

  if (missing.length > 0) {
    throw new Error(
      `The append-only triggers are missing after the reset: ${missing.join(', ')}. ` +
        'Run `pnpm db:migrate` to restore them before using this database.',
    );
  }

  console.log(`\nAppend-only triggers intact on all ${expected.length} tables.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
