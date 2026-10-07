import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';

import {
  isConcurrentIndexFile,
  parseConcurrentIndexFile,
} from './concurrent-index-file.js';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/**
 * Migrations run in three ordered stages, and the order is not optional:
 *
 *   pre/   extensions and reference sequences — table DEFAULTs call nextval() on
 *          them, so they must exist before any table is created
 *   (root) Drizzle-generated table DDL
 *   post/  exclusion constraints, CHECKs, immutability and updated_at triggers —
 *          they reference tables, so they must come last
 *
 * Both hand-written stages are idempotent, so re-running a deploy is safe. They are also meant
 * to be CHEAP once applied, because they run on every deploy against a live database: see the
 * header of post/0001 for how each kind of statement checks before it locks.
 */

/*
  How long a post/ statement may WAIT for a table lock before the deploy gives up.

  Postgres queues lock requests: a migration waiting for an ACCESS EXCLUSIVE lock behind one long
  read makes every query that arrives after it wait too, so a two-second statement can stop the
  site for as long as somebody's report runs. Failing the deploy instead is recoverable, because
  every file here is idempotent and the next attempt starts where this one stopped. It bounds the
  wait only, never the work: a constraint that takes a minute to validate still gets its minute.
*/
const LOCK_TIMEOUT = '10s';
async function runSqlStage(pool: Pool, stage: 'pre' | 'post'): Promise<void> {
  const dir = join(migrationsDir, stage);

  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  } catch {
    console.log(`  (no ${stage}/ stage)`);
    return;
  }

  for (const file of files) {
    const sql = await readFile(join(dir, file), 'utf8');

    if (isConcurrentIndexFile(sql)) {
      await runConcurrentIndexFile(pool, `${stage}/${file}`, sql);
      console.log(`  ✓ ${stage}/${file}`);
      continue;
    }

    // One transaction per file: a partially applied constraint file is worse
    // than none at all.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
      await client.query(sql);
      await client.query('COMMIT');
      console.log(`  ✓ ${stage}/${file}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Failed applying ${stage}/${file}: ${(error as Error).message}`, {
        cause: error,
      });
    } finally {
      client.release();
    }
  }
}

/**
 * Builds each index without blocking writes, outside any transaction (see
 * `concurrent-index-file.ts`). An index that already exists and is valid costs one catalogue read.
 */
async function runConcurrentIndexFile(
  pool: Pool,
  file: string,
  sql: string,
): Promise<void> {
  const statements = parseConcurrentIndexFile(file, sql);
  const client = await pool.connect();

  try {
    for (const { name, statement } of statements) {
      const invalid = await client.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM pg_index ix
           JOIN pg_class i ON i.oid = ix.indexrelid
           WHERE i.relname = $1 AND NOT ix.indisvalid
         ) AS exists`,
        [name],
      );

      if (invalid.rows[0]?.exists) {
        console.log(
          `    rebuilding ${name}: a previous concurrent build left it invalid`,
        );
        await client.query(
          `DROP INDEX CONCURRENTLY IF EXISTS ${client.escapeIdentifier(name)}`,
        );
      }

      await client.query(statement);
    }
  } catch (error) {
    throw new Error(`Failed applying ${file}: ${(error as Error).message}`, {
      cause: error,
    });
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required.');
  }

  const pool = new Pool({ connectionString, max: 1 });

  try {
    console.log('1/3 prerequisites (extensions, sequences)');
    await runSqlStage(pool, 'pre');

    console.log('2/3 tables (drizzle)');
    await migrate(drizzle(pool), { migrationsFolder: migrationsDir });
    console.log('  ✓ schema up to date');

    console.log('3/3 constraints, triggers, search indexes');
    await runSqlStage(pool, 'post');

    console.log('\nMigration complete.');
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
