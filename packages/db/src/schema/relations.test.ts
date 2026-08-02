import { createTableRelationsHelpers, getTableName } from 'drizzle-orm';
import type { Table } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createDatabase, type Database } from '../client.js';
import * as schema from './index.js';

/**
 * Every declared relation must actually be queryable.
 *
 * Drizzle needs BOTH halves of a relation declared. A `many()` without its matching
 * `one()` compiles, type-checks, and then throws "not enough information to infer
 * relation" the first time anyone runs the query — which may be months later, in
 * production, on a screen nobody had built yet.
 *
 * That is not hypothetical. `partners.documents` shipped in exactly that state and
 * the §8.1 verification queue returned a 500 on every call from day one; nothing
 * caught it because nothing called it until the admin console existed.
 *
 * So this walks the relation graph and runs a real (LIMIT 0) query for each edge. It
 * costs a second and it makes the whole class of bug impossible to ship again —
 * which a hand-written list of relations, or a regex over the schema, would not.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('schema relations', () => {
  /**
   * Discovered from the schema rather than listed by hand.
   *
   * A hardcoded list would pass forever while a newly added relation went untested —
   * the exact failure mode this file exists to prevent.
   */
  /**
   * `as Record<string, unknown>` because `import * as schema` types the values as a
   * 90-member union of tables, enums and relations — too wide for a type predicate to
   * narrow from. Widening to `unknown` first is what lets `isRelations` do its job.
   */
  const edges = Object.values(schema as Record<string, unknown>)
    .filter(isRelations)
    .flatMap((relation) => {
      /**
       * Drizzle's own helpers, not stand-ins.
       *
       * It post-processes whatever `config` returns (`withFieldName`), so hand-rolled
       * fakes throw. Using the real ones also means this introspection stays correct
       * if the relation API changes shape.
       */
      const config = relation.config(createTableRelationsHelpers(relation.table));

      // `getTableName` is Drizzle's public accessor; the internals behind it are
      // symbol-keyed and not reachable from a plain property read.
      return Object.keys(config).map((field) => ({
        table: getTableName(relation.table),
        field,
      }));
    });

  it('discovers relations to check', () => {
    // A guard on the guard: if introspection silently returned nothing, every
    // assertion below would vacuously pass and the file would be worthless.
    expect(edges.length).toBeGreaterThan(20);
  });

  it.each(edges)('$table.$field resolves', async ({ table, field }) => {
    const db: Database = createDatabase(DATABASE_URL as string, 1);

    try {
      const queries = db.query as unknown as Record<
        string,
        { findMany: (args: unknown) => Promise<unknown> }
      >;

      // Drizzle's query keys are camelCase table names; find the one that matches.
      const key = Object.keys(queries).find((candidate) => toSnake(candidate) === table);

      expect(key, `no query builder for table ${table}`).toBeDefined();

      /**
       * LIMIT 0 — the row data is irrelevant. What is being asserted is that the
       * relational query can be BUILT, which is precisely where a missing inverse
       * throws.
       */
      await queries[key as string]?.findMany({ with: { [field]: true }, limit: 0 });
    } finally {
      await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
    }
  });
});

function toSnake(value: string): string {
  return value.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/**
 * Narrows a schema export to a Drizzle `Relations` object.
 *
 * `import * as schema` gives tables, enums and relations mixed together, and only the
 * last carry `table` + `config`. Checking for both is what distinguishes them.
 */
interface SchemaRelations {
  table: Table;
  config: (
    helpers: ReturnType<typeof createTableRelationsHelpers>,
  ) => Record<string, unknown>;
}

function isRelations(value: unknown): value is SchemaRelations {
  return (
    typeof value === 'object' &&
    value !== null &&
    'table' in value &&
    'config' in value &&
    typeof (value as { config: unknown }).config === 'function'
  );
}
