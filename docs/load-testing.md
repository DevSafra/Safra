# Load testing plan

Ready to execute the day a deployment target exists. Nothing here needs further design — and as of
2026-08-20 the scenarios have been run rather than only written, which is not the same claim.

**Status: scenarios 1–4 have been EXECUTED for their locally-honest half; no capacity run has
happened.** Since 2026-08-12 the generator and all six k6 scenarios exist. On 2026-08-20 scenarios 2,
3 and 4 were run against `safra_load` at the documented volumes — see
**`docs/load-test-results-2026-08-20.md`** — which found **fifteen defects, twelve fixed**, and
corrected three scenarios that could not have produced a result at all. Scenarios 5 and 6 need
infrastructure.

**No capacity number has been claimed anywhere in this repository, and none should be** until this
has been executed against real infrastructure — a figure measured on a laptop is worse than no
figure, because somebody will plan around it. That prohibition covers percentiles and throughput. It
does NOT cover the two things a local run answers honestly, and both are worth having early:

| Honest locally          | Why the hardware does not matter                                                                                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Query plans**         | A sequential scan on a five-million-row table on a request path is a missing index on any machine. §Metrics already calls this "the check that catches a missing index" |
| **Business invariants** | An exclusion constraint either held under concurrency or it did not; a ledger group either balances or it does not. `pnpm load:invariants`                              |

**What it has already found.** Two defects, neither reachable at fixture volumes:

- **`O-scale-1`** — a hard ceiling at 999,999 rows on twelve reference columns, hit by the GENERATOR
  before a single request was sent. Fixed.
- **`O-scale-2`** — search took **144 seconds** at these volumes and the API's 15-second statement
  timeout turned that into an HTTP 500. Fixed 2026-08-13: **144 s → 0.59 s** for the default
  unfiltered search and **39.7 s → 166 ms** for a city, via four plan-preserving query changes, three
  partial indexes, and choosing the page before pricing it where the ranking allows. One case is left
  at 2.75 s — `price_asc` with no filters, which cannot know its page without pricing everything.
- **Thirteen more on 2026-08-20**, from scenarios 2, 3 and 4. Two uncapped full scans on console
  request paths (239,855 buffers on every page view of the bookings registry, 765 on «طلبات الشراكة»);
  a per-account rate limiter bypassable _and aimable_ with a forged `X-Forwarded-For`; an idempotency
  claim held for 24 hours after a failure while masking the real error; four customer-facing refusals
  carrying English sentences with no error code. Full record in the results document.

All of them were invisible to every test, every review and every environment, and visible immediately
to a million rows. That is the argument for building this harness before the hosting decision rather
than after.

**And three of the scenarios could not produce a result at all**, which is the second argument: a
harness nobody has run is a harness nobody has tested. Scenario 2 was silently capped at ten booking
attempts a minute by a route-level `@Throttle` that `THROTTLE_DEFAULT_LIMIT` cannot reach, and
reported every threshold green. Scenario 3 asked for a route that does not exist. Scenario 4's
bystander starved itself. See "Raise the throttle first" below, which is necessary and was not
sufficient.

## Running it

```bash
export LOAD_DATABASE_URL=postgresql://…/safra_load   # the name MUST contain "load"

pnpm load:reset                                       # drops and recreates it
DATABASE_URL=$LOAD_DATABASE_URL pnpm db:migrate
DATABASE_URL=$LOAD_DATABASE_URL pnpm db:seed          # reference data only
LOAD_SCALE=1 pnpm load:generate                       # 0.01 for a smoke test

k6 run -e API_URL=http://localhost:4000 load/01-search-browse.js
pnpm load:invariants                                  # after EVERY run
```

`LOAD_SCALE` is a fraction of the volumes in §Data; `LOAD_FRACTION` scales a scenario's virtual
users the same way, so any scenario can be smoke-tested against itself in thirty seconds. The
generator **refuses any database whose name does not contain `load`**, and refuses a database that
already holds data — the append-only tables cannot be emptied, so a re-run needs a fresh one.

**Raise the throttle first, or the run measures the rate limiter.** `THROTTLE_DEFAULT_LIMIT` defaults
to **120 requests per minute**, which one virtual user exceeds in seconds: a first attempt here fired
731 iterations in 22 seconds and every later request came back `429`, with the percentiles looking
excellent because refusing a request is fast. Start the API under test with
`THROTTLE_DEFAULT_LIMIT=100000` — the schema's maximum, and it refuses to boot above it — and treat
any run that did not do so as void. The limiter deserves
its own measurement, which is scenario 4's job and nobody else's.

**That is necessary and NOT sufficient, learned 2026-08-20.** A route-level `@Throttle` decorator
overrides the named throttler for its handler, and the environment variable cannot reach it. Two of
them matter here: `POST /bookings` allows **ten a minute** and `POST /auth/login` **forty**. Run
exactly as documented above, scenario 2 got ten booking attempts a minute through and refused
2,259,751 requests — **and passed every threshold**, because refusing a request is fast and a 409 is
expected by design. `grep -rn "@Throttle" apps/api/src` before trusting a run, and check the routes
the scenario actually calls. Scenario 2 now presents each attempt as a distinct source address, which
models 200 customers rather than evading the control; the limitation is stated in the script, and it
only works where the generator is the direct client.

**Two prerequisites the scenarios cannot create for themselves**, both added 2026-08-20 because three
of the six could not start without them:

```bash
pnpm load:accounts          # the FX rate, a staff account with TOTP enrolled, the bystander,
                            # and scenario 4's victim accounts. Re-runnable: it clears lockouts
export LOAD_STAFF_TOKEN="$(pnpm -s load:token)"   # scenario 3's registries are authorised per request
```

`db:seed` deliberately seeds no FX rate, so without `load:accounts` every booking quote answers 503
and scenario 2 reads as a booking defect.

**The default credentials are published, and refuse to leave localhost.** `load:accounts` writes a
`super_admin` whose password is in this repository — deliberately, because a harness whose passwords
have to be discovered is a harness that does not run. It refuses any database whose name lacks `load`,
and off localhost it refuses the published defaults entirely: `LOAD_STAFF_PASSWORD`,
`LOAD_BYSTANDER_PASSWORD`, `LOAD_VICTIM_PASSWORD` and `LOAD_STAFF_TOTP_SECRET` must all be supplied,
and the banner stops echoing them. `load:token` likewise refuses to send the fixed password anywhere
but a local API. **The capacity run against provisioned infrastructure must set all four.**

---

## Why the CAPACITY numbers cannot be produced yet, precisely

Not because the tooling is missing, and no longer because nothing has been run. Because **the
numbers would describe the wrong system**:

- A laptop's PostgreSQL has different IO, different `shared_buffers`, and no network latency to the
  application.
- There is no load balancer, so horizontal scaling — the entire premise of rule 2's stateless
  design — is untested by construction.
- Redis is local, so the rate limiter's storage has no network cost.
- No CDN, so every image request would hit the origin, which is not how it will ever run.

What CAN be done now, and has been: keeping every request path free of `N+1` queries, indexing
everything on a request path, capping every count, and paginating every list. Those are design
properties, verifiable by reading, and they are what makes a load test worth running rather than a
way of discovering the obvious.

---

## Success criteria

From rule 3, unchanged:

| Metric                                  | Target             |
| --------------------------------------- | ------------------ |
| API p95                                 | **< 200 ms**       |
| API p99                                 | < 500 ms           |
| Error rate                              | < 0.1 % (5xx only) |
| Initial page load, mid-range device, 4G | < 2 s              |

And two the rules imply but do not state:

| Metric               | Target   | Why                                                         |
| -------------------- | -------- | ----------------------------------------------------------- |
| Booking creation p99 | < 1 s    | It holds an exclusion constraint; a slow one blocks another |
| Ledger write p99     | < 500 ms | Every capture posts four legs in one transaction            |

**A run passes only if every criterion holds simultaneously.** A p95 met while the error rate is
0.5 % is a system shedding load, not a system serving it.

---

## Scenarios, in priority order

### 1. Search and browse — 80 % of real traffic

Anonymous. `GET /properties` with filters, `GET /properties/:slug`, city pages.

Ramp: 50 → 500 → 2,000 concurrent over 20 minutes, hold 10 minutes at each step.

**What this is really testing:** whether the search predicate uses its indexes at a realistic row
count, and whether the customer app's ISR cache absorbs what it should.

### 2. Booking creation — the contended path

Authenticated and guest. Quote → create → pay → capture webhook.

**Deliberately concentrated:** 200 concurrent bookings against **20 units**, so the exclusion
constraint over `daterange` is actually contended. Spreading them across a thousand units would
measure nothing — the interesting question is what happens when two people want the same room on
the same night, and the answer must be that exactly one gets it.

Success: zero double-bookings, zero unbalanced ledger groups, p99 < 1 s.

### 3. Staff console registries — deep pagination

`OFFSET` is the console's documented exception (`O-page-1`). This measures its real cost.

Walk to page 1, 10, 100, 1,000 on a table of **1M rows**. Success: p95 < 200 ms at page 100.
**The number to discover is the page at which it stops being acceptable** — that number goes into
`O-page-1` and decides whether the ceiling of 100,000 needs lowering.

### 4. Authentication under attack

Credential stuffing shape: 10,000 attempts across 5,000 accounts from 50 addresses.

Success: lockouts fire, the IP+account limiter holds, **legitimate sign-ins on unrelated accounts
from the same NAT still succeed** — that last one is the property `O-sec-1` exists for, and load is
the only way to prove it under contention.

### 5. Media

2,000 concurrent image fetches. Mostly a CDN test; the origin must not see them.

### 6. Soak

10 % of peak for **12 hours**. Looking for: connection-pool exhaustion, memory growth, the advisory
lock leaking, and `notifications` or `audit_log` growth rates that would be a problem at a year.

---

## Data

**Load-test against production-shaped volumes, not fixture volumes.** The single most misleading
thing possible here is a fast query over 200 rows.

| Table               | Rows       | Why                                              |
| ------------------- | ---------- | ------------------------------------------------ |
| `properties`        | 50,000     | ~5 years of optimistic growth                    |
| `units`             | 200,000    |                                                  |
| `bookings`          | 5,000,000  | The table everything joins                       |
| `availability_days` | 70,000,000 | 200k units × 365 days — the largest table by far |
| `users`             | 1,000,000  | Rule 2's stated target                           |
| `audit_log`         | 20,000,000 | Append-only, never pruned; growth is the risk    |
| `ledger_entries`    | 20,000,000 |                                                  |

**`availability_days` is the one to watch.** It is the biggest table, it is written by partners and
read by every search, and no partitioning strategy has been chosen. If a scenario fails, it will
probably fail here — and the answer is likely range partitioning by date, which is a migration
better designed with a measurement in hand than without.

**The generator exists** since 2026-08-12: `packages/db/src/scripts/generate-load-data.ts`, run with
`pnpm load:generate`. Everything is server-side `INSERT … SELECT … FROM generate_series`, chunked
where a single statement would hold too much open.

Four things about it are decisions rather than details:

- **Constraints are kept, not dropped.** Bulk loaders usually drop indexes and rebuild them. The
  `daterange` exclusion constraint and the deferred ledger-balance trigger are part of the shape being
  measured, so the generated data is made to satisfy them instead — bookings get non-overlapping
  stays per unit, ledger legs come in balanced groups of four.
- **`ledger_entries` is chunked into separate transactions**, because its balance check is a
  `DEFERRABLE INITIALLY DEFERRED … FOR EACH ROW` constraint trigger: PostgreSQL queues one event per
  inserted row and holds the queue until COMMIT, so twenty million rows in one transaction queues
  twenty million events before a single check runs. **This applies to any future ledger backfill** —
  it is a property of the constraint, not of the generator.
- **It refuses a database whose name lacks `load`,** and refuses one that already holds data. The
  append-only tables reject TRUNCATE by trigger, so there is no cleaning up after a partial run.
- **`availability_days` stays 365 days per unit at every scale.** A unit with four days of calendar is
  not a smaller version of a real unit; scale reduces the NUMBER of units instead.
- **`created_at` is spread WITHIN each statement, added 2026-08-20.** `now()` is the transaction
  timestamp, so one statement per rung gave one timestamp per rung: 5,000,061 bookings across 86
  distinct values, all 200,000 `confirmed` rows sharing exactly one. That does not merely look untidy,
  it invalidates measurements — the console's default order is `created_at DESC, id DESC`, so every
  plan measured over that data was a sort over a nearly constant column, and one query read 236,526
  buffers for a reason that had nothing to do with the query. Fixed for `bookings`, `audit_log` and
  `ledger_entries`, from a deterministic per-row offset so a regenerated database stays comparable.

Measured throughput on a development laptop: ~150,000 availability rows/second, so the full 73M rows
take about eight minutes and the whole set roughly 25 GB.

---

## Metrics to capture

**Client side:** p50/p95/p99 per endpoint, error rate by status, throughput, connection errors.

**Server side:** CPU and memory per replica, event-loop lag, GC pauses, connection-pool
utilisation and wait time.

**Database:** `pg_stat_statements` top 20 by total time, index hit ratio, sequential scans on large
tables (**should be zero on request paths** — this is the check that catches a missing index),
lock waits, replication lag, connection count against `max_connections`.

**Redis:** hit rate, evictions, memory, latency.

**Business invariants, checked after every run:** zero double-bookings, every ledger group balanced,
zero orphaned payments, `notifications` all terminal. **`pnpm load:invariants` runs all four** and
exits non-zero on a violation, so it can gate a run in CI. It reads only, so it is safe to point at a
real environment after a run there — and it prints the row counts it checked over, because "all
invariants hold" over an empty database is not a result.

**That last sentence earned itself twice.** On 2026-08-20 the printed counts showed `payments=0` and
`notifications=0`, so two of the four invariants passed over nothing — the generator writes neither,
and that is outstanding work. And the double-booking check itself could not see a double booking: it
tested `GROUP BY unit_id, check_in`, which finds only two live bookings sharing an IDENTICAL check-in
date, while the constraint forbids any OVERLAP. Aug 1–5 against Aug 3–7 on one unit printed `ok`. The
queries now live in `packages/db/src/scripts/load-invariants.ts` so they can be TESTED, and
`load-invariants.integration.test.ts` drops the exclusion constraint inside a rolled-back transaction,
writes the overlap it would have refused, and requires the check to find it. **An invariant nobody has
watched fail is an invariant nobody has tested.**

---

## Tooling

**k6** — scripts are JavaScript, so the same people maintain them; it produces the percentiles we
need natively; and it runs in CI. Alternatives considered: Gatling (Scala, another language in the
stack for one purpose), Locust (Python, same), JMeter (XML).

**Scripts live in `load/` and all six exist** since 2026-08-12:

| File                       | Scenario                                                | Needs                                              |
| -------------------------- | ------------------------------------------------------- | -------------------------------------------------- |
| `config.js`                | shared thresholds, the documented ramp, query variation | —                                                  |
| `01-search-browse.js`      | 1                                                       | load data                                          |
| `02-booking-contention.js` | 2                                                       | load data                                          |
| `03-console-pagination.js` | 3                                                       | `LOAD_STAFF_TOKEN`                                 |
| `04-auth-under-attack.js`  | 4                                                       | `LOAD_BYSTANDER_EMAIL` / `_PASSWORD`, throwaway DB |
| `05-media.js`              | 5                                                       | seeded images                                      |
| `06-soak.js`               | 6                                                       | 12 hours                                           |

Three conventions worth knowing before editing them:

- **The success criteria are expressed as k6 thresholds**, so a run cannot be reported green by
  reading the percentile and ignoring the error rate. k6 exits non-zero when any threshold fails.
- **Queries VARY per iteration.** Every virtual user asking for the same city and dates would be
  answered from PostgreSQL's cache after the first, and the run would measure the cache rather than the
  index — the easiest way to produce a load test that passes and predicts nothing.
- **A refusal is not an error.** Scenarios 2 and 4 expect 409s and 401s by design, so they set
  `expectedStatuses` to treat anything under 500 as handled; only a 5xx spends the error budget.
  Nothing that only the database can see is expressed as a k6 threshold — a counter nothing
  increments passes at zero and reads as proof. That is what `pnpm load:invariants` is for.

---

## Execution

1. Provision an environment **identical in shape** to production — same instance classes, same
   replica count, same database tier. Not a smaller one: the point is the numbers.
2. Seed production-shaped data. Record the seed's git SHA.
3. Baseline: single-user timings per endpoint. This is the floor, and it separates "slow under
   load" from "slow".
4. Run each scenario in isolation, then two together (search + booking), which is the realistic
   mixture.
5. Soak overnight.
6. Record everything, including failures, in `docs/load-test-results-<date>.md`.

**Re-run before each launch phase and after any change to a request-path query.**

---

## What we do if it fails

In this order, because this is the order that costs least:

1. **Add an index.** Most p95 failures are one missing index.
2. **Add a cache** with an explicit TTL and invalidation.
3. **Move work to the queue** — see `docs/background-jobs-design.md`.
4. **Add replicas.** The application is stateless, so this should be linear; if it is not, that is
   the finding.
5. **Read replicas** for search and the console.
6. **Partition `availability_days`** by date range.
7. Only then, reconsider the design.
