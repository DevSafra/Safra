import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';

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
 * Both hand-written stages are idempotent, so re-running a deploy is safe.
 */
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
    // One transaction per file: a partially applied constraint file is worse
    // than none at all.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
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
