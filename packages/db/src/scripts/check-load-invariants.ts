/**
 * The business invariants `docs/load-testing.md` requires checking after every run.
 *
 * ## Why these are separate from the k6 thresholds
 *
 * k6 measures responses. These four questions are about the STATE left behind, and no amount of
 * response inspection can answer them:
 *
 *   - zero double-bookings
 *   - every ledger group balanced
 *   - zero orphaned payments
 *   - `notifications` all terminal
 *
 * The first is the entire point of scenario 2: two requests can both answer 201 and only the database
 * knows whether they landed on the same night. Expressing it as a k6 counter would produce a
 * threshold that passes at zero because nothing ever incremented it, which reads as proof and is not.
 *
 * ## These are honest on any hardware
 *
 * A capacity number measured on a laptop is worse than none — the plan says so. An INVARIANT is not
 * like that: an exclusion constraint either held under concurrency or it did not, and a ledger group
 * either balances or it does not. So this script is worth running locally, and its result can be
 * reported without a caveat.
 *
 * Exits non-zero if any invariant is violated, so it can gate a run in CI.
 *
 * Usage:
 *   LOAD_DATABASE_URL=… pnpm load:invariants
 */
import { Pool } from 'pg';

import { INVARIANTS } from './load-invariants.js';

async function main(): Promise<void> {
  /*
    Falls back to DATABASE_URL so the same script can check a real environment after a run there.
    Unlike the generator, this only READS, so it needs no name guard.
  */
  const url = process.env['LOAD_DATABASE_URL'] ?? process.env['DATABASE_URL'];

  if (!url) throw new Error('LOAD_DATABASE_URL or DATABASE_URL is required.');

  const pool = new Pool({ connectionString: url, max: 2 });
  let violated = 0;

  try {
    console.log(`Invariants for ${new URL(url).pathname.slice(1)}:\n`);

    for (const invariant of INVARIANTS) {
      const result = await pool.query(invariant.sql);

      if (result.rows.length === 0) {
        console.log(`  ok    ${invariant.name}`);
        continue;
      }

      violated += 1;
      console.log(`  FAIL  ${invariant.name} — ${result.rows.length} case(s)`);
      console.log(`        ${invariant.consequence}`);

      for (const row of result.rows.slice(0, 5)) {
        console.log(`        ${JSON.stringify(row)}`);
      }
    }

    /* Context, so a passing run is not mistaken for a run over an empty database. */
    const scale = await pool.query<{ t: string; n: string }>(
      `SELECT t, n::text FROM (
         SELECT 'bookings' t, count(*) n FROM bookings
         UNION ALL SELECT 'ledger_entries', count(*) FROM ledger_entries
         UNION ALL SELECT 'payments', count(*) FROM payments
         UNION ALL SELECT 'notifications', count(*) FROM notifications
       ) c`,
    );

    console.log(
      `\nChecked over: ${scale.rows
        .map((row) => `${row.t}=${Number(row.n).toLocaleString('en')}`)
        .join(', ')}`,
    );

    if (violated > 0) {
      console.log(`\n${violated} invariant(s) violated.`);
      process.exitCode = 1;
    } else {
      console.log('\nAll invariants hold.');
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
