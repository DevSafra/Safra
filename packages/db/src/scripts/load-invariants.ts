/**
 * The four business invariants `docs/load-testing.md` requires checking after every load-test run.
 *
 * ## Why they live in their own module
 *
 * `check-load-invariants.ts` is a CLI: importing it runs it. These queries are the part worth
 * TESTING — a check that cannot see the violation it names is worse than no check, because it
 * reports "ok" and is believed. `load-invariants.integration.test.ts` drops the exclusion
 * constraint inside a rolled-back transaction, writes the overlap the constraint would have
 * refused, and requires the query to find it.
 *
 * ## These are honest on any hardware
 *
 * A capacity number measured on a laptop is worse than none — the plan says so. An INVARIANT is not
 * like that: an exclusion constraint either held under concurrency or it did not, and a ledger group
 * either balances or it does not. So they are worth running locally, and the result can be reported
 * without a caveat.
 */
export type Invariant = {
  readonly name: string;
  /** Why a violation matters, printed when one is found. */
  readonly consequence: string;
  readonly sql: string;
};

export const INVARIANTS: readonly Invariant[] = [
  {
    name: 'no double-booked nights',
    consequence:
      'Two live bookings share a unit and an overlapping stay. The exclusion constraint ' +
      'bookings_no_overlapping_stays_v3 did not hold, and two customers have been sold one room.',
    /*
      Overlap, not equality.

      This was `GROUP BY unit_id, check_in HAVING count(*) > 1`, which detects only the case where two
      live bookings share an identical CHECK-IN DATE. The constraint it is checking is
      `EXCLUDE USING gist (unit_id WITH =, daterange(check_in, check_out, '[)') WITH &&)` — it forbids
      any OVERLAP. Aug 1–5 and Aug 3–7 on one unit is two customers in one room for two nights, is
      exactly what the constraint exists to prevent, and the old query returned nothing for it. The
      invariant would have printed "ok" over a genuinely double-booked database.

      That is the failure mode `docs/load-testing.md` warns about in its own words — "a counter nothing
      increments passes at zero and reads as proof".

      ## Why a window function and not a self-join on `&&`

      `a JOIN b ON … daterange(…) && daterange(…)` is the direct translation and it would lean on the
      gist index the exclusion constraint itself creates. That is the wrong thing to depend on: the
      most likely reason this invariant ever fires is that the constraint was dropped or its WHERE
      clause narrowed, and a check whose speed comes from the artifact whose absence it detects
      degrades exactly when it is needed.

      Sorted by start, overlaps exist if and only if some ADJACENT pair overlaps — if every adjacent
      pair is clear then `end(i) <= start(i+1) <= start(j)` for every later j, so nothing can reach
      across. One ordered pass per unit, no index required, and exact for the half-open `[)` range the
      constraint uses: `[1,3)` and `[3,5)` share no night and must not be reported, which is why the
      test is `prev_check_out > check_in` and not `>=`.
    */
    sql: `SELECT unit_id::text AS unit,
                 prev_reference AS booking_a, reference AS booking_b,
                 prev_check_in::text || '/' || prev_check_out::text AS stay_a,
                 check_in::text || '/' || check_out::text AS stay_b
          FROM (
            SELECT unit_id, reference, check_in, check_out,
                   lag(reference)  OVER w AS prev_reference,
                   lag(check_in)   OVER w AS prev_check_in,
                   lag(check_out)  OVER w AS prev_check_out
            FROM bookings
            /* disputed joined the blocking set on 2026-08-25 — see BLOCKING_STATUSES.
               No backticks in here: this SQL is inside a template literal and one would end it. */
            WHERE status IN ('pending_payment','pending_confirmation','confirmed','checked_in','disputed')
            WINDOW w AS (PARTITION BY unit_id ORDER BY check_in, check_out)
          ) ordered
          WHERE prev_check_out > check_in
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
