# Load testing plan

Ready to execute the day a deployment target exists. Nothing here needs further design.

**Status: planned, never run.** No capacity number has been claimed anywhere in this repository,
and none should be until this has been executed against real infrastructure — a figure measured on
a laptop is worse than no figure, because somebody will plan around it.

---

## Why it cannot be run now, precisely

Not because the tooling is missing. Because **the numbers would describe the wrong system**:

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

A generator does not exist. Writing one is **unblocked engineering work** (~1 day) and it should be
written before the hosting decision, not after, so the day infrastructure exists the test runs
rather than starts.

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
zero orphaned payments, `notifications` all terminal.

---

## Tooling

**k6** — scripts are JavaScript, so the same people maintain them; it produces the percentiles we
need natively; and it runs in CI. Alternatives considered: Gatling (Scala, another language in the
stack for one purpose), Locust (Python, same), JMeter (XML).

Scripts live in `load/` — **not written yet**, and writing them is unblocked.

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
