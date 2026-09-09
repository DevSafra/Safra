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
    name: 'every captured payment is in the books',
    consequence:
      'Money was captured and no ledger movement records where it went. §13.3 requires the entries ' +
      'to be written in the SAME transaction as the capture, so this cannot happen by timing — it ' +
      'means a capture path exists that does not post, and the partner payable, the SAFRA ' +
      'commission and the customer fee for that booking are all unrecorded.',
    /*
      Why this is scoped to the last day, when «every ledger group balances» is not.

      Because the alarm has to be able to sound. Measured on 2026-09-08: 53 of 677 captured payments
      on the development database have no ledger movement, and 51 of them have no timeline event on
      their booking either — they are SEEDER rows, written straight into `payments` and `bookings`
      without going through `markPaid`. The remaining two were written in the same millisecond burst
      and only acquired events later, when an e2e dispute spec used those bookings.

      An invariant that reported 53 rows of known fixture noise on every run is an alarm that always
      sounds, and `docs/load-testing.md` is explicit that those get switched off. Twenty-four hours
      is the window a load scenario finishes inside, so this asks about what the RUN captured — which
      is the question scenario 2 exists to answer — and says nothing about the fixture it ran on top
      of. `notifications all terminal` above is scoped the same way for the same reason.

      The seeded backlog is a fixture property and is recorded as such in `docs/FUTURE-WORK.md`
      rather than left to look like an unbacked liability.
    */
    sql: `SELECT p.reference AS payment, p.provider, p.amount::text AS amount,
                 p.captured_at::text AS captured_at, b.reference AS booking
          FROM payments p
          JOIN bookings b ON b.id = p.booking_id
          WHERE p.status = 'captured'
            AND p.captured_at > now() - interval '24 hours'
            AND NOT EXISTS (
              SELECT 1 FROM ledger_entries l WHERE l.payment_id = p.id
            )
          ORDER BY p.captured_at DESC
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
  {
    name: 'nothing unsupported is queued for release',
    /*
      The assertion behind Bashar's instruction of 2026-09-09: "an unsupported payable cannot be
      released silently".

      `bookings.partner_payable_amount` is a column written when a booking is priced; the
      `partner_payable` credit is the record that the money behind it arrived and was apportioned.
      `postBookingPayment` writes both in one transaction, so they normally agree. Where they do
      not, the column is an obligation nothing backs — and attaching it to a payout is the step
      that turns it into real money leaving SAFRA.

      So this checks the LAST safe moment rather than the anomaly itself: not «does an unsupported
      payable exist» (339 did on 2026-09-09, all historical) but «has one reached a payout». The
      accrual guard makes the answer no; this is what would notice if that guard were removed,
      bypassed, or worked around by a manual insert.
    */
    consequence:
      'A payout item exists for a booking whose payable no ledger credit supports. Releasing it ' +
      'moves real money against a receipt that was never posted, and the books will not balance ' +
      'against the transfer afterwards.',
    sql: `SELECT b.reference AS booking, i.amount::text AS amount, p.status::text AS payout_status
          FROM partner_payout_items i
          JOIN bookings b ON b.id = i.booking_id
          JOIN partner_payouts p ON p.id = i.payout_id
          WHERE NOT EXISTS (
            SELECT 1 FROM ledger_entries le
            WHERE le.booking_id = b.id
              AND le.account = 'partner_payable'
              AND le.direction = 'credit'
          )
          ORDER BY i.amount DESC
          LIMIT 20`,
  },
  {
    name: 'no notification is stranded outside recovery',
    /*
      The check that would have caught finding 235 on the day it started.

      1,055 rows sat in `failed` for up to 32 days — 1,050 of them `booking.needs_action`, the
      notice that tells a partner a booking is waiting on them — and the invariant above could not
      see any of it, because it asks about `queued` and these were not queued. Nor were they
      exhausted, so the dead-letter screen never showed them either. They were in the one state
      nothing was watching.

      Two ways a notice is now stranded, and both are failures of the RECOVERY rather than of a
      send:

      - `failed` past the point where the re-drive should have collected it. The sweep runs every
        five minutes and re-drives once the retry schedule cannot still be running (thirty-three
        minutes for mail), so an hour is generous and anything beyond it means the sweep is not
        running or not working.
      - `abandoned` at all. It is terminal by design and only a person moves it, so its presence is
        not a bug — but a queue of them nobody is clearing is exactly the silence this finding was.

      Scoped to a day, like `every captured payment is in the books` above, so the historical
      backlog cannot make this an alarm that always sounds and therefore never gets read. That
      lesson is finding 246's, and it cost nine production advisories.
    */
    consequence:
      'A notice was accepted and is neither delivered nor on its way: either the re-drive is not ' +
      'collecting failed rows, or abandoned ones are piling up with nobody clearing them. Whichever ' +
      'it is, somebody was not told and no screen says so.',
    sql: `SELECT n.template_key, n.status::text AS status, count(*)::text AS n,
                 max(extract(epoch FROM now() - coalesce(n.failed_at, n.updated_at, n.queued_at))
                     / 3600)::int::text AS oldest_hours
          FROM notifications n
          WHERE n.created_at > now() - interval '24 hours'
            AND (
              (n.status = 'failed'
               AND coalesce(n.failed_at, n.updated_at, n.queued_at) < now() - interval '1 hour')
              OR n.status = 'abandoned'
            )
          GROUP BY n.template_key, n.status
          LIMIT 20`,
  },
];
