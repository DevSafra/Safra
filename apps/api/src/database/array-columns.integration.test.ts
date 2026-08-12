import { afterAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { createRollbackDatabase, type Database } from '@safra/db';

/**
 * Which array columns the DRIVER hands back as JavaScript arrays, and which arrive as text.
 *
 * ## The bug that made this necessary
 *
 * `cities.categories` is `city_category[]` — an array of a Postgres ENUM. node-postgres parses an
 * array only when it has a built-in parser for the ELEMENT type, and a user-defined enum is never
 * one. Selected bare through `db.execute`, that column arrived as the literal string `'{historic}'`
 * while the call's type generic declared `string[]`. A generic on `db.execute` is an assertion, not
 * a check, so nothing failed — and the public home page rendered no cities for about two weeks.
 * See O-web-4 in `docs/FUTURE-WORK.md`.
 *
 * ## Why this is a schema sweep rather than one more assertion about cities
 *
 * `catalog.integration.test.ts` holds the fixed reader. This holds the CLASS: it asks the database
 * which array columns exist, and fails when one appears whose element type the driver cannot parse
 * and which nobody has decided how to handle. The next enum array is the one that will be written by
 * somebody who has never heard of this, and a test is the only thing that will be there to tell them.
 *
 * ## Data-independent on purpose
 *
 * Every check runs against an EMPTY array literal cast to the element type, not against a row. It
 * exercises exactly the parser path a real column takes, works on a freshly migrated database, and
 * cannot start passing for the accidental reason that a table happened to be empty.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/**
 * Element types the driver does NOT parse, so every raw-SQL reader must convert in the query —
 * `to_jsonb(col)`, or `array_to_string(col, …)` where a string is what the screen wants.
 *
 * Adding a row here is a decision, not a formality: it means auditing every `db.execute` that
 * selects such a column. If the test below names a type that is not here, that audit has not
 * happened yet.
 */
const CAST_REQUIRED = new Set(['city_category']);

type ArrayColumn = {
  table_name: string;
  column_name: string;
  element_type: string;
  /** `b` base, `e` enum, `c` composite, `d` domain — see `pg_type.typtype`. */
  element_kind: string;
};

describeIfDb('array columns and the driver', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  beforeEach(async () => {
    await harness.begin();
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  /** Every array column in the live schema, with the kind of thing it holds. */
  const arrayColumns = async (): Promise<ArrayColumn[]> => {
    const rows = await db.execute<ArrayColumn>(sql`
      SELECT c.table_name, c.column_name,
             t.typname  AS element_type,
             t.typtype::text AS element_kind
      FROM information_schema.columns c
      JOIN pg_type arr ON arr.typname = c.udt_name
      JOIN pg_type t   ON t.oid = arr.typelem
      WHERE c.table_schema = 'public' AND c.data_type = 'ARRAY'
      ORDER BY c.table_name, c.column_name
    `);

    return rows.rows;
  };

  /** What the driver makes of an empty array of this element type. */
  const parsesAsArray = async (elementType: string): Promise<boolean> => {
    /*
      `sql.raw` on a type name read from `pg_type`, never from a request — the same rule
      `scopeFilter` follows for its city column.
    */
    const rows = await db.execute<{ v: unknown }>(
      sql`SELECT ${sql.raw(`'{}'::${elementType}[]`)} AS v`,
    );

    return Array.isArray(rows.rows[0]?.v);
  };

  it('finds the array columns at all, so the sweep is not vacuous', async () => {
    const columns = await arrayColumns();

    expect(columns.length).toBeGreaterThan(5);
  });

  /**
   * The sweep. Every element type in use is either one the driver parses, or one somebody has
   * explicitly decided to convert in SQL.
   */
  it('parses every array element type in use, or the type is on the cast-required list', async () => {
    const columns = await arrayColumns();
    const unhandled: string[] = [];

    for (const type of new Set(columns.map((column) => column.element_type))) {
      if (await parsesAsArray(type)) continue;
      if (CAST_REQUIRED.has(type)) continue;

      unhandled.push(type);
    }

    expect(
      unhandled,
      'the driver returns these as TEXT, not as arrays: cast them in SQL with to_jsonb(...) ' +
        'in every raw-SQL reader, then add the element type to CAST_REQUIRED',
    ).toStrictEqual([]);
  });

  /**
   * And the list must stay honest in the other direction.
   *
   * If a cast-required type starts parsing — a driver upgrade, a column changed to `text[]` — the
   * entry becomes a permanent excuse for a cast nobody needs. Deleting it is how that gets noticed.
   */
  it('keeps the cast-required list accurate, with nothing on it that now parses', async () => {
    for (const type of CAST_REQUIRED) {
      expect(
        await parsesAsArray(type),
        `${type} now parses as an array — remove it from CAST_REQUIRED`,
      ).toBe(false);
    }
  });

  /**
   * The trap, stated as an assertion.
   *
   * Reading `city_category[]` bare gives a STRING wearing braces. This is what the mistyped generic
   * in `CatalogService.cities()` was actually receiving, and it is why a `string[]` annotation over
   * `db.execute` proves nothing.
   */
  it('hands an enum array back as a braced string when it is not cast', async () => {
    const bare = await db.execute<{ v: unknown }>(sql`
      SELECT '{historic}'::city_category[] AS v
    `);

    expect(typeof bare.rows[0]?.v).toBe('string');
    expect(bare.rows[0]?.v).toBe('{historic}');

    /* And the fix, in the same breath, so the remedy is not left to memory. */
    const cast = await db.execute<{ v: unknown }>(sql`
      SELECT to_jsonb('{historic}'::city_category[]) AS v
    `);

    expect(cast.rows[0]?.v).toStrictEqual(['historic']);
  });
});
