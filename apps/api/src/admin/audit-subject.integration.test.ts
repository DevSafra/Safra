import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type Database } from '@safra/db';

import { RESOLVABLE_SUBJECT_TYPES, resolveSubjects } from './audit-subject.js';

/**
 * Every kind of thing the platform has written an audit row about, this module can NAME.
 *
 * ## Why it reads the database rather than the source
 *
 * The same blind spot `audit-catalogue.integration.test.ts` was written for. Grepping the source
 * for `subjectType: '…'` finds the literals and misses anything assembled — and it cannot see a
 * type that was written by a migration or by a path nobody grepped. The database has no blind
 * spot: whatever is in `audit_log` is what the console will be asked to render.
 *
 * ## What failure means
 *
 * A subject type present in the data and absent from `SOURCES` is not a crash — the entry resolves
 * to null and the screen prints the raw type and id, which is the honest fallback. But Bashar's
 * rule (2026-08-24) is that an entry NAMES the thing it happened to, so an unresolvable type is a
 * screen that cannot keep that promise, and it should be visible rather than discovered by a super
 * admin reading a uuid.
 *
 * ## Vacuous passes are visible
 *
 * Over an empty `audit_log` this proves nothing, so the row count is asserted and printed — the
 * lesson from `pnpm load:invariants` reporting "all invariants hold" over two empty tables.
 *
 * Read-only: safe against any environment.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('every audited subject can be named', () => {
  let db: Database;

  beforeAll(() => {
    db = createDatabase(DATABASE_URL ?? '', 2);
  });

  afterAll(async () => {
    await db.$client.end();
  });

  it('has written enough for this suite to mean anything', async () => {
    const rows = await db.execute<{ n: string }>(
      sql`SELECT count(*)::text AS n FROM audit_log`,
    );

    console.log(`audit_log rows: ${rows.rows[0]?.n ?? '0'}`);
    expect(Number(rows.rows[0]?.n ?? '0')).toBeGreaterThan(0);
  });

  it('names every subject type the platform has actually written', async () => {
    const rows = await db.execute<{ subject_type: string }>(sql`
      SELECT DISTINCT subject_type FROM audit_log
      WHERE subject_id IS NOT NULL
      ORDER BY 1
    `);

    const written = rows.rows.map((row) => row.subject_type);
    const resolvable = new Set(RESOLVABLE_SUBJECT_TYPES);

    expect(
      written.filter((type) => !resolvable.has(type)),
      'These subject types are in audit_log and cannot be named. A super admin opening one of ' +
        'these entries reads a uuid. Add them to SOURCES in audit-subject.ts.',
    ).toEqual([]);
  });

  /**
   * The resolver actually returns a name for a real row, rather than returning an empty map.
   *
   * Without this the assertion above passes just as well against a module whose every query is
   * broken — the SQL is built from a table name and two expressions per type, and a wrong column
   * would throw at runtime and never at compile time.
   */
  it('resolves a real subject to a label', async () => {
    const row = await db.execute<{ subject_type: string; subject_id: string }>(sql`
      SELECT a.subject_type, a.subject_id::text AS subject_id
      FROM audit_log a
      JOIN partners p ON p.id = a.subject_id
      WHERE a.subject_type = 'partner'
      LIMIT 1
    `);

    const found = row.rows[0];

    if (!found) {
      console.log(
        'no partner-subject audit row on this database; skipping the label check',
      );
      return;
    }

    const resolved = await resolveSubjects(db, [
      { subjectType: found.subject_type, subjectId: found.subject_id },
    ]);
    const subject = resolved.get(`partner:${found.subject_id}`);

    expect(subject).toBeDefined();
    expect(subject?.label).toBeTruthy();
    expect(subject?.reference).toMatch(/^PAR-/);
    expect(subject?.href).toBe(`/partners/${subject?.reference}`);
  });

  /**
   * Every mapped source's SQL runs.
   *
   * A wrong column name in `SOURCES` is a runtime error on a screen, and only for the one subject
   * type that has it. This executes each one against an empty id list, which is enough to make
   * Postgres parse and plan the statement — so a typo fails here rather than in front of a reader.
   */
  it('has a query that runs for every mapped subject type', async () => {
    const broken: string[] = [];

    for (const type of RESOLVABLE_SUBJECT_TYPES) {
      try {
        await resolveSubjects(db, [
          { subjectType: type, subjectId: '00000000-0000-4000-8000-000000000000' },
        ]);
      } catch (error) {
        broken.push(`${type}: ${error instanceof Error ? error.message : 'failed'}`);
      }
    }

    expect(broken).toEqual([]);
  });
});
