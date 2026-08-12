/**
 * Drops and recreates the load-test database.
 *
 * ## Why this needs its own script
 *
 * Two reasons, and neither is convenience. `DROP DATABASE` cannot be issued from a connection to the
 * database being dropped, so it has to connect to `postgres` and rewrite the URL — fiddly to type
 * correctly under time pressure, and the cost of getting it wrong is the development database.
 *
 * And the load tables cannot be emptied any other way: `audit_log`, `ledger_entries`,
 * `wallet_transactions` and their siblings carry `deny_mutation` triggers that refuse TRUNCATE and
 * DELETE, because they are evidence. Recreating the database is the only clean start available.
 *
 * The same name allow-list as the generator guards it, for the same reason: this is a destructive
 * command whose target is one character away from the database everything else uses.
 *
 * Usage:
 *   LOAD_DATABASE_URL=postgresql://…/safra_load pnpm load:reset
 */
import { Pool } from 'pg';

function assertLoadDatabase(name: string): void {
  if (!/(^|_)load(_|$)/.test(name)) {
    throw new Error(
      `Refusing to DROP "${name}". This script only ever targets a database whose name contains ` +
        '"load" — e.g. safra_load.',
    );
  }
}

async function main(): Promise<void> {
  const url = process.env['LOAD_DATABASE_URL'];

  if (!url) throw new Error('LOAD_DATABASE_URL is required.');

  const parsed = new URL(url);
  const name = parsed.pathname.replace(/^\//, '');

  assertLoadDatabase(name);

  /* The maintenance connection. `postgres` always exists and is never the target. */
  const maintenance = new URL(url);
  maintenance.pathname = '/postgres';

  const pool = new Pool({ connectionString: maintenance.toString(), max: 1 });

  try {
    /*
      Identifiers are quoted rather than parameterised: PostgreSQL does not accept a bind parameter
      for a database name. The value has already passed the allow-list above, and it comes from the
      operator's own environment rather than from a request — the same rule `scopeFilter` follows for
      its column name.
    */
    const quoted = `"${name.replace(/"/g, '""')}"`;

    /* Sessions still attached would make the DROP fail with a confusing error. */
    await pool.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [name],
    );

    await pool.query(`DROP DATABASE IF EXISTS ${quoted}`);
    await pool.query(`CREATE DATABASE ${quoted}`);

    console.log(
      `Recreated ${name}. Next:\n` +
        `  DATABASE_URL=$LOAD_DATABASE_URL pnpm db:migrate\n` +
        `  DATABASE_URL=$LOAD_DATABASE_URL pnpm db:seed\n` +
        `  pnpm load:generate\n`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
