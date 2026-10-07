import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  isConcurrentIndexFile,
  parseConcurrentIndexFile,
} from './concurrent-index-file.js';
import { createRollbackDatabase, type Database } from './index.js';

/**
 * Every post/ file runs on every deploy, so a second run must be FREE: no lock that stops traffic,
 * no row changed.
 *
 * ## The defects this holds (go-live audit, 2026-10-06)
 *
 * Every file here was idempotent and several were expensive anyway. `post/0001` rebuilt a GiST
 * exclusion constraint over all of `bookings` on every deploy and dropped it again; `post/0023`
 * dropped two CHECKs on `partner_payouts` and revalidated them; `post/0010` dropped and rebuilt a
 * unique index; and every `DROP TRIGGER IF EXISTS` took an ACCESS EXCLUSIVE lock on its table,
 * found the trigger, and created it again. Each was correct, and each stopped writes to a live
 * table at every deploy. Separately, `post/0008` and `post/0017` undid decisions staff made in the
 * console.
 *
 * ## How
 *
 * Each file is executed verbatim inside the rollback harness against a database that has already
 * been migrated, which is the state every deploy after the first meets. Then two questions are
 * asked of the transaction itself: which locks does it hold that would make a writer WAIT
 * (anything stronger than ROW EXCLUSIVE), and how many rows did it insert, update or delete
 * (`pg_stat_xact_user_tables`). Both must be none. Locks are held until the transaction ends, so
 * nothing the file did can slip past the question.
 *
 * Needs a database migrated with the files as they are NOW: a database migrated before a change
 * to one of them fails here until `pnpm db:migrate` has run, which is the deploy this describes.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const POST = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations', 'post');
const files = readdirSync(POST)
  .filter((file) => file.endsWith('.sql'))
  .sort()
  .map((file) => ({ file, text: readFileSync(join(POST, file), 'utf8') }));

const transactional = files.filter(({ text }) => !isConcurrentIndexFile(text));
const concurrent = files.filter(({ text }) => isConcurrentIndexFile(text));

/* The lock modes that conflict with ROW EXCLUSIVE, which is what every INSERT, UPDATE and DELETE takes. */
const BLOCKS_WRITERS = [
  'ShareLock',
  'ShareRowExclusiveLock',
  'ExclusiveLock',
  'AccessExclusiveLock',
];

const fileText = (name: string): string => {
  const found = files.find(({ file }) => file === name);
  if (!found) throw new Error(`post/${name} is gone. If it was renamed, rename it here.`);
  return found.text;
};

describeIfDb('the post/ stage on an already-migrated database', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  beforeEach(() => harness.begin());
  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  /* Fixed files from the repository, never caller input: the one place `sql.raw` is the tool. */
  const run = (text: string) => db.execute(sql.raw(text));

  it('finds the files it is meant to sweep', () => {
    expect(transactional.length).toBeGreaterThan(20);
    expect(concurrent.map(({ file }) => file)).toContain('0028_request_path_indexes.sql');
  });

  it.each(transactional.map(({ file, text }) => [file, text] as const))(
    '%s takes no lock that would make a writer wait, and changes no row',
    async (_file, text) => {
      await db.execute(sql`SET LOCAL lock_timeout = '2s'`);
      await run(text);

      const locks = await db.execute<{ relation: string; mode: string }>(sql`
        SELECT l.relation::regclass::text AS relation, l.mode
        FROM pg_locks l
        JOIN pg_class c ON c.oid = l.relation
        WHERE l.pid = pg_backend_pid()
          AND l.locktype = 'relation'
          AND c.relpersistence = 'p'
          AND l.mode IN (${sql.join(
            BLOCKS_WRITERS.map((mode) => sql`${mode}`),
            sql`, `,
          )})
        ORDER BY 1, 2
      `);
      expect(locks.rows).toEqual([]);

      const changed = await db.execute<{ relname: string; n: string }>(sql`
        SELECT relname, (n_tup_ins + n_tup_upd + n_tup_del)::text AS n
        FROM pg_stat_xact_user_tables
        WHERE n_tup_ins + n_tup_upd + n_tup_del > 0
        ORDER BY 1
      `);
      expect(changed.rows).toEqual([]);
    },
  );

  /**
   * The concurrent file cannot run inside a transaction at all, so it is asked a different
   * question: did `db:migrate` leave every index it names present and VALID. An invalid one is
   * what a failed concurrent build leaves behind, and `IF NOT EXISTS` alone would skip it forever.
   */
  it.each(concurrent.map(({ file, text }) => [file, text] as const))(
    '%s left every index it names valid',
    async (file, text) => {
      const names = parseConcurrentIndexFile(file, text).map(({ name }) => name);

      const found = await db.execute<{ name: string }>(sql`
        SELECT i.relname AS name
        FROM pg_index ix
        JOIN pg_class i ON i.oid = ix.indexrelid
        WHERE ix.indisvalid AND i.relname IN (${sql.join(
          names.map((name) => sql`${name}`),
          sql`, `,
        )})
        ORDER BY 1
      `);

      expect(found.rows.map((row) => row.name)).toEqual([...names].sort());
    },
  );

  /**
   * The same file, over a trigger somebody disabled. Re-enabling the immutability triggers on every
   * deploy was a guarantee the old drop-and-recreate gave for free, and skipping an existing trigger
   * must not lose it.
   */
  it('re-enables an immutability trigger somebody disabled', async () => {
    await db.execute(sql`SET LOCAL lock_timeout = '2s'`);
    await db.execute(
      sql`ALTER TABLE settings_history DISABLE TRIGGER settings_history_immutable`,
    );

    await run(fileText('0001_constraints.sql'));

    const state = await db.execute<{ tgenabled: string }>(sql`
      SELECT tgenabled FROM pg_trigger
      WHERE tgrelid = 'settings_history'::regclass AND tgname = 'settings_history_immutable'
    `);
    expect(state.rows[0]?.tgenabled).toBe('O');
  });

  /** And a trigger whose definition changed under its name is replaced, not skipped. */
  it('replaces a trigger whose definition differs from the file', async () => {
    await db.execute(sql`
      SET LOCAL lock_timeout = '2s';
      DROP TRIGGER emergency_modes_touch_updated_at ON emergency_modes;
      CREATE TRIGGER emergency_modes_touch_updated_at AFTER UPDATE ON emergency_modes
        FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
    `);

    await run(fileText('0001_constraints.sql'));

    const def = await db.execute<{ def: string }>(sql`
      SELECT pg_get_triggerdef(oid) AS def FROM pg_trigger
      WHERE tgrelid = 'emergency_modes'::regclass AND tgname = 'emergency_modes_touch_updated_at'
    `);
    expect(def.rows[0]?.def).toMatch(/BEFORE UPDATE ON public\.emergency_modes/);
  });
});

/**
 * `post/0008` seeds the four starting roles, and the console lets staff rename and retire them.
 * `ON CONFLICT DO NOTHING` sees only a LIVE row of the same name, so both decisions were undone by
 * the next deploy: the retired role came back, and the renamed one returned under its old name
 * beside the new.
 */
describeIfDb('post/0008, the starting staff roles', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  beforeEach(() => harness.begin());
  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  const run = () => db.execute(sql.raw(fileText('0008_seed_staff_roles.sql')));

  const liveNamed = async (name: string): Promise<number> => {
    const rows = await db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM staff_roles WHERE name = ${name} AND deleted_at IS NULL
    `);
    return rows.rows[0]?.n ?? 0;
  };

  it('does not bring back a role staff retired', async () => {
    await db.execute(sql`
      UPDATE staff_roles SET deleted_at = now() WHERE name = 'وكيل الدعم' AND deleted_at IS NULL
    `);

    await run();

    expect(await liveNamed('وكيل الدعم')).toBe(0);
  });

  it('does not recreate a role staff renamed under its old name', async () => {
    await db.execute(sql`
      UPDATE staff_roles SET name = 'الشؤون المالية' WHERE name = 'مسؤول مالي' AND deleted_at IS NULL
    `);

    await run();

    expect(await liveNamed('مسؤول مالي')).toBe(0);
    expect(await liveNamed('الشؤون المالية')).toBe(1);
  });

  /**
   * The control: on a database meeting it for the first time the file still seeds all four. A TEMP
   * table of the same shape shadows the real one, so the empty table needs no rows deleted from a
   * table other rows point at.
   */
  it('seeds all four roles into an empty table', async () => {
    await db.execute(
      sql`CREATE TEMP TABLE staff_roles (LIKE public.staff_roles INCLUDING ALL)`,
    );

    await run();

    const rows = await db.execute<{ admits_as: string; is_system: boolean }>(sql`
      SELECT admits_as::text, is_system FROM pg_temp.staff_roles ORDER BY admits_as::text
    `);
    expect(rows.rows).toEqual([
      { admits_as: 'finance_officer', is_system: false },
      { admits_as: 'operations_manager', is_system: false },
      { admits_as: 'super_admin', is_system: true },
      { admits_as: 'support_agent', is_system: false },
    ]);
  });
});

/**
 * `post/0017` retired JOD and LBP and moved Jordan to USD, on every deploy. The geography screen
 * can reinstate a retired code and set a country's currency, so both were undone by the next
 * deploy. Run over TEMP copies of `currencies` and `countries`, which carry no `touch_updated_at`
 * trigger, so a row can be dated before the file existed.
 */
describeIfDb('post/0017, the retired currencies', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  beforeEach(async () => {
    await harness.begin();
    await db.execute(sql`
      CREATE TEMP TABLE currencies (LIKE public.currencies INCLUDING ALL);
      CREATE TEMP TABLE countries (LIKE public.countries INCLUDING ALL);
    `);
  });
  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  const run = () => db.execute(sql.raw(fileText('0017_currencies_syp_usd_eur.sql')));

  /** A currency and Jordan pointing at it, both last touched at `at`. */
  const jordanIn = async (code: string, at: string): Promise<void> => {
    await db.execute(sql`
      INSERT INTO pg_temp.currencies (code, name_ar, name_en, name_de, symbol, decimals, is_active, updated_at)
      VALUES ('USD', 'دولار', 'Dollar', 'Dollar', '$', 2, true, ${at}::timestamptz),
             (${code}, 'دينار', 'Dinar', 'Dinar', 'د.أ', 3, true, ${at}::timestamptz)
    `);
    await db.execute(sql`
      INSERT INTO pg_temp.countries (code, name_ar, name_en, name_de, display_currency_id, updated_at)
      SELECT 'JO', 'الأردن', 'Jordan', 'Jordanien', id, ${at}::timestamptz
      FROM pg_temp.currencies WHERE code = ${code}
    `);
  };

  const state = async () => {
    const rows = await db.execute<{ retired: boolean; jordan: string }>(sql`
      SELECT (cur.deleted_at IS NOT NULL) AS retired,
             (SELECT c2.code FROM pg_temp.currencies c2 WHERE c2.id = co.display_currency_id) AS jordan
      FROM pg_temp.currencies cur, pg_temp.countries co
      WHERE cur.code = 'JOD' AND co.code = 'JO'
    `);
    return rows.rows[0];
  };

  it('leaves JOD alone when staff reinstated it, and Jordan in it', async () => {
    await jordanIn('JOD', '2026-09-20T10:00:00Z');

    await run();

    expect(await state()).toEqual({ retired: false, jordan: 'JOD' });
  });

  /** The control: a database older than the file is still corrected, once. */
  it('retires JOD and moves Jordan to USD on a database older than the file', async () => {
    await jordanIn('JOD', '2026-08-01T10:00:00Z');

    await run();

    expect(await state()).toEqual({ retired: true, jordan: 'USD' });
  });
});
