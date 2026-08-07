import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema/index.js';

export type Database = ReturnType<typeof createDatabase>;

/**
 * The handle inside `db.transaction(...)`.
 *
 * Derived from `Database` rather than imported from drizzle's internals so it cannot drift from
 * whatever `drizzle()` actually returns here. It exists so a function can declare that it works
 * against either — which is what makes a multi-step routine wrappable in a transaction without a
 * cast, and a cast is exactly what would hide the day the two stop being interchangeable.
 */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Connection pooling is not optional at this scale: PostgreSQL forks a backend per
 * connection, so uncapped clients exhaust the server long before CPU or IO do.
 * In production this pool sits behind pgBouncer in transaction mode.
 */
export function createDatabase(connectionString: string, max = 20) {
  const pool = new Pool({
    connectionString,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Fail fast rather than hanging a request behind a dead socket.
    statement_timeout: 15_000,
    query_timeout: 15_000,
  });

  return drizzle(pool, { schema, casing: 'snake_case' });
}
