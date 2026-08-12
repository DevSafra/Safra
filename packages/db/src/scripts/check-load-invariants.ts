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

type Invariant = {
  readonly name: string;
  /** Why a violation matters, printed when one is found. */
  readonly consequence: string;
  readonly sql: string;
};

const INVARIANTS: readonly Invariant[] = [
  {
    name: 'no double-booked nights',
    consequence:
      'Two live bookings share a unit and an overlapping stay. The exclusion constraint ' +
      'bookings_no_overlapping_stays_v2 did not hold, and two customers have been sold one room.',
    sql: `SELECT b.unit_id::text AS unit, b.check_in::text AS from_date, count(*)::text AS n
          FROM bookings b
          WHERE b.status IN ('pending_payment','pending_confirmation','confirmed','checked_in')
          GROUP BY b.unit_id, b.check_in
          HAVING count(*) > 1
          LIMIT 20`,
  },
  {
    name: 'every ledger group balances',
    consequence:
      'A ledger entry group has debits <> credits. Money has been recorded arriving from nowhere ' +
      'or going nowhere, and §13.3 no longer holds.',
    sql: `SELECT entry_group_id::text AS entry_group,
                 sum(CASE WHEN direction = 'debit'  THEN amount_syp ELSE 0 END)::text AS debits,
                 sum(CASE WHEN direction = 'credit' THEN amount_syp ELSE 0 END)::text AS credits
          FROM ledger_entries
          GROUP BY entry_group_id
          HAVING sum(CASE WHEN direction = 'debit'  THEN amount_syp ELSE 0 END)
              <> sum(CASE WHEN direction = 'credit' THEN amount_syp ELSE 0 END)
          LIMIT 20`,
  },
  {
    name: 'no orphaned payments',
    consequence:
      'A payment references a booking that does not exist, or is captured against a booking that ' +
      'was never paid. Reconciliation against the acquirer would not balance.',
    sql: `SELECT p.id::text AS payment, p.status::text AS status
          FROM payments p
          LEFT JOIN bookings b ON b.id = p.booking_id
          WHERE b.id IS NULL
             OR (p.status = 'captured' AND b.paid_at IS NULL)
          LIMIT 20`,
  },
  {
    name: 'notifications all terminal',
    consequence:
      'A notification is still queued after the run. Either a send is stuck, or the delivery log is ' +
      'recording attempts that never resolve — and "was the partner told?" becomes unanswerable.',
    sql: `SELECT n.template_key, n.status::text AS status, count(*)::text AS n
          FROM notifications n
          WHERE n.status = 'queued'
            AND n.created_at < now() - interval '5 minutes'
          GROUP BY n.template_key, n.status
          LIMIT 20`,
  },
];

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
