# Load-test results — 2026-08-20

**Scenarios 2, 3 and 4 of `docs/load-testing.md`, run against `safra_load` at the documented volumes.**
First execution of any of the three. Scenario 1 was run on 2026-08-12/13 and produced `O-scale-1`
and `O-scale-2`; scenarios 5 (media/CDN) and 6 (12-hour soak) remain deferred because they need
infrastructure that does not exist.

---

## What this run is allowed to claim, and what it is not

**No latency, throughput or capacity figure appears in this document, and none should be quoted from
this run.** `docs/load-testing.md` is explicit about why — "a figure measured on a laptop is worse
than no figure, because somebody will plan around it" — and nothing here changes that. Launch
blocker #10 is still open and still gated on the hosting decision (#1).

What a local run answers honestly, per that same document, and what this one reports:

| Reported                      | Why the hardware does not matter                                                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Query plans**               | Node types, rows read versus returned, buffers touched. A sequential scan on a 5M-row table on a request path is a defect on any machine        |
| **Business invariants**       | An exclusion constraint either held under concurrency or it did not; a ledger group either balances or it does not                              |
| **Response contracts**        | Whether a refusal carries an error code is a property of the code                                                                               |
| **Security behaviour**        | Whether a limiter can be bypassed, and whom it refuses, is arithmetic on its own configuration                                                  |
| **Request and status counts** | Needed to state the findings — "2.26M of 2.26M were refused" cannot be said without them. They are what the run DID, not what the system CAN do |

Buffers are quoted throughout because they are the honest unit: a buffer is a page the database had
to touch, it does not vary with CPU speed, and the ratio between two plans is the finding.

---

## Environment

|            |                                                                                                                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database   | `safra_load`, regenerated 2026-08-20 at `LOAD_SCALE=1` — 22 GB                                                                                                                            |
| Volumes    | 73,000,000 availability days · 20,000,000 audit rows · 20,000,000 ledger entries · 5,000,061 bookings · 1,000,000 users · 200,000 units · 50,000 properties · 15,000 partner applications |
| Schema     | all 34 migrations + 7 post-migrations. The previous load database was **six migrations stale** and predated `partner_applications` entirely                                               |
| API        | one instance, `apps/api/dist`, its own Redis logical database so throttle counters could not mix with development                                                                         |
| Generation | 31.8 minutes, of which `audit_log` alone was 12.5                                                                                                                                         |

**Prerequisites that did not exist before this run.** `pnpm load:accounts` and `pnpm load:token` were
written for it: `db:seed` deliberately seeds no FX rate, so every booking quote answered 503; the load
database had no staff account at all, and staff carry mandatory TOTP; and scenario 4's victim accounts
had to be real for the lockout path to run. Three of the six scenarios could not be started, and none
of it was written down.

---

## Scenario 2 — booking creation under contention

**What was tested.** 200 virtual users driving `POST /bookings` at 20 units over 10 nights for five
minutes, so the `daterange` exclusion constraint is genuinely contended. Ran three times; the first
two runs each produced a finding that made the next one necessary.

**Expected invariants.** Exactly one live booking per (unit, night). Every ledger group balanced. No
orphaned payments. No 5xx. Every refusal carrying an error code.

### Actual results

| Run                            | Requests  | 201 | 409    | 429       | 5xx   | k6 verdict                |
| ------------------------------ | --------- | --- | ------ | --------- | ----- | ------------------------- |
| 1 — exactly as documented      | 2,259,812 | 21  | 39     | 2,259,751 | 1     | **all thresholds PASSED** |
| 2 — per-attempt source address | 15,454    | 20  | 13,511 | 0         | 1,922 | failed                    |
| 3 — after the idempotency fix  | 12,231    | 9   | 10,541 | 0         | 1,680 | failed                    |

**Invariants, after run 3** — `pnpm load:invariants`, over `bookings=5,000,061`,
`ledger_entries=20,000,000`:

```
ok    no double-booked nights
ok    every ledger group balances
ok    no orphaned payments
ok    notifications all terminal
```

**The constraint held.** 10,550 contended attempts on 20 units produced 20 winners and no overlapping
live stays. That is scenario 2's actual result and it transfers off this hardware: an exclusion
constraint either held or it did not.

Two of the four invariants were checked over EMPTY tables (`payments=0`, `notifications=0`), because
the generator creates neither. The script prints the counts it checked over, which is the only reason
that is visible. Recorded below as remaining work.

### Discovered defects

**F-1 · The scenario could never contend anything, and reported green.** `POST /bookings` carries a
route-level `@Throttle({default: {limit: 10, ttl: 60_000}})`. A route decorator overrides the named
throttler, so `THROTTLE_DEFAULT_LIMIT=100000` — which the plan says to set and to "treat any run that
did not do so as void" — does not reach it. Ten booking attempts a minute got through; the other
2,259,751 were refused. **Every k6 threshold passed**, because refusing a request is fast and a 409
is expected by design. Severity: high, against the harness. The plan's own mitigation did not prevent
the failure the plan warns about.
**Fixed** — each attempt now presents a distinct source address, which is what "200 concurrent
bookings" means: 200 different customers, each inside their own allowance. It models the traffic
rather than evading the control, and scenario 4 deliberately does not do it. The limitation is stated
in the script: it works only where the generator is the direct client, and behind a load balancer the
scenario needs distributed generation instead.

**F-2 · A failed release of an idempotency claim masked the real error and left the claim held for 24
hours.** `IdempotencyService.run` released the claim with a bare `await this.db.execute(DELETE …)`
before `throw error`. When the release failed — 487 times in run 2 — three things happened at once:
`throw error` was never reached, the release's error replaced the real cause, and the claim stayed
`in_progress` until `expires_at`, twenty-four hours away. All three fire together, because the reason
the release fails is the reason the handler failed. The checkout form keeps ONE idempotency key per
mounted form, so the customer's retry then answered 409 «الطلب قيد المعالجة» until they thought to
reload the page. Severity: medium-high, customer-facing, invisible at fixture volumes because nothing
there fails twice.
**Fixed** — the release is best-effort and logged, the original error always propagates, and a claim
left `in_progress` past a two-minute staleness window is reclaimed atomically rather than refused.
Run 3 shows it working: `DELETE FROM idempotency_keys` disappeared from the reported causes (487 → 0),
563 release failures are now logged as release failures, and the pool timeouts they had been hiding
surfaced correctly (678 → 1,070). Seven regression tests, `idempotency.integration.test.ts`.

**F-3 · A 429 answered with an English sentence and no error code.**
`{"statusCode":429,"message":"ThrottlerException: Too Many Requests"}` — no `code`, a hardcoded
English string on a customer-facing path, and the framework's exception class name in a body anybody
can read. It breaks the standing decision that the API answers with a code, and
`safra/no-hardcoded-text` cannot see it because the string lives in a dependency. `AUTH_TOO_MANY_ATTEMPTS`
had been defined and translated into all three locales since the i18n sweep and nothing ever threw it.
Severity: medium.
**Fixed** — `CodedThrottlerGuard` throws `request.too_many`, a new code translated in ar/en/de. It
deliberately does not say WHICH limiter fired: the `account` throttler only applies where a request
body names an email, so naming it would confirm the address is one the API treats as an account —
the enumeration oracle `O-sec-2` closed on registration. Five tests.

**F-4 · The booking conflict answered with an English sentence and no code.** Twelve lines below a
correct `conflict(ERROR.UNIT_UNAVAILABLE_ON)`, losing the race for the last room threw
`new ConflictException({message: 'Those dates were just taken…', reason: 'dates_unavailable'})`.
Nothing read `reason`. Severity: medium — this is the refusal a real customer meets most often.
**Fixed** — `conflict(ERROR.BOOKING_DATES_JUST_TAKEN)`, distinct from `unit.unavailable_on` because
that one names the blocked DATE while this one cannot: the dates were free when the customer asked.

**F-5 · The same-day cutoff and past-arrival refusals were two English sentences chosen by a
ternary.** Found while fixing F-4, on the same endpoint. The customer app translated the cutoff case
itself by reading a `reason` field, and had no branch for a past arrival — so that one fell through to
`setFormError(record['message'])`, writing the API's English straight onto an Arabic checkout form.
That fallback is the exact mistake `error-codes.ts` was written to end. Severity: medium.
**Fixed** — `booking.same_day_closed` and `booking.arrival_in_past`, each carrying the first bookable
date in `params` so a client can interpolate it in the reader's own language. The checkout form now
resolves the code and no longer prints `message` at all, which closes the class rather than the
instance. Five regression tests, `booking-arrival.integration.test.ts` — the path had no coverage of
any kind before, which is how it survived the i18n sweep.

### Remaining risks

**R-1 · Pool exhaustion answers 500, not 503.** All 1,680 remaining 5xx in run 3 trace to
`connectionTimeoutMillis` on a pool of `DATABASE_POOL_MAX=20`: 200 concurrent booking transactions,
each holding a connection while it waits on a row lock held by another, so a lock queue becomes a
connection queue. The response body is generic (`{"statusCode":500,"message":"Internal server
error"}` — verified, no SQL or parameter leakage), but 500 is the wrong answer for a capacity
condition: it is unretryable to a client and it will page whoever owns the 5xx signal in
`docs/alerting.md`. **Not fixed here.** The fix is a global exception filter mapping a pool
acquisition timeout to a coded 503 with `Retry-After`, and that touches every error response in the
API — deliberate work with its own verification, not a side effect of a load-test pass. Note also
that 200 clients contending 20 units is the plan's deliberate concentration, not a prediction of
production traffic.

**R-2 · A 500 carries no error code.** `request.unknown` exists and is translated; Nest's default
filter does not use it. Low severity, and the same global filter closes it.

**R-3 · Scenario 2 is not repeatable without fresh nights.** The 200 (unit, night) slots it competes
for get consumed: run 3 created 9 bookings rather than 20 because runs 1 and 2 had already won most
of them. A re-run measures 409 handling, not the race. Fresh dates or a fresh database are needed for
a comparable result.

**R-4 · Two of the four invariants were vacuous.** `payments` and `notifications` are empty in the
generated data, so "no orphaned payments" and "notifications all terminal" passed over nothing.

---

## Scenario 3 — the console's deep pagination

**What was tested.** `GET /admin/bookings` at page 1, 10, 100, 1,000, 10,000 and 100,000 over
5,000,061 rows, plus the plans behind the registry's counts and the new «طلبات الشراكة» section. This
is the measurement `O-page-1` explicitly owes: _"Measure first: the numbers above are row counts, not
timings."_

**Expected invariants.** Every page answers 200, including one past the end. A page over the ceiling
is refused rather than clamped. No query on a request path uses a sequential scan. Every count
bounded.

### The OFFSET curve — buffers touched, as the console's own query

| Page    | OFFSET    | Rows read | Rows returned | Buffers                 | vs page 1   |
| ------- | --------- | --------- | ------------- | ----------------------- | ----------- |
| 1       | 0         | 27        | 25            | 144                     | 1×          |
| 10      | 225       | 250       | 25            | 1,044                   | 7×          |
| 100     | 2,475     | 2,500     | 25            | 9,914                   | 69×         |
| 1,000   | 24,975    | 25,000    | 25            | 87,069 + 5,254 written  | 605×        |
| 10,000  | 249,975   | 250,000   | 25            | 401,578 + 5,237 written | 2,789×      |
| 100,000 | 2,499,975 | 2,500,000 | 25            | 2,663,104               | **18,494×** |

**The plan is the right plan at every depth** — `Index Scan Backward using bookings_created_idx` feeding
an `Incremental Sort`, no sequential scan, no missing index. The cost is inherent to `OFFSET` and
linear in `page × limit`, exactly as `packages/contracts/src/pagination.ts` documents. So this is not
a defect to fix; it is the number the ceiling decision needed.

**Two thresholds are visible in the curve.** From page 1,000 the sort spills to disk (`written=`), and
at the ceiling of 100,000 a single request reads 2.5 million rows to return 25 — around 20 GB of page
accesses that any authenticated staff account can ask for repeatedly.

**Recommendation for `O-page-1`: lower the `page` ceiling from 100,000 to 1,000.** That is where the
spill starts, it is 40× past anything a person reaches by hand, and the register already states the
right answer for the rest — "the fix is not 'make OFFSET faster', it is to narrow the set". A deep
walk belongs on the keyset endpoints or behind a date filter. **Not applied**: the ceiling is in
`pageQuerySchema` and shared by every registry, so it is Bashar's call, not a load-test side effect.

### Discovered defects

**F-6 · Scenario 3 had never run.** It asked for `/admin/registries/bookings?page=1&size=25`. The
controller is `@Controller('admin')` with `@Get('bookings')`, and `pageQuerySchema` is `.strict()`
with a field called `limit`. The route answered 404, `setup()` threw, and there was no output, no
result, and nothing in the register saying so. **Fixed.**

**F-7 · The registry's status counts were an uncapped full scan on every page view.** The service
described them as "one grouped query over the `(status, created_at)` index" — **an index that did not
exist**. Grouping by a column no index leads on has one plan available: read the whole table.

|                                            | Buffers                                       |
| ------------------------------------------ | --------------------------------------------- |
| Status counts, `GROUP BY status`, uncapped | **239,855** — every page view                 |
| Capped count for a status with NO rows     | 5,058 — so `COUNT_CAP` alone did not bound it |
| Both, after the fix                        | **93** and **3**                              |

It also broke the rule twice over: the counts were exact and uncapped, and the console SUMMED them
into an exact figure — «٥٠٠٠٠٦١ حجزًا» — printed directly above a pagination bar correctly saying
«أكثر من ١٠٠٠٠ نتيجة». Two totals on one screen, one of them paid for with a full scan. Severity:
high. This is precisely what `COUNT_CAP` exists to prevent, sitting next to a correctly capped total.
**Fixed** — one capped count per status over a new `(status, created_at DESC)` index, a `capped` flag
travelling with the numbers, and a `countAtLeast` string so the console prints «أكثر من N حجز» rather
than a precise-looking figure nobody paid for.

**F-8 · «طلبات الشراكة» had no index for its own sort order.** The registry lists
`ORDER BY created_at DESC, reference DESC` with no status filter; the table's only index was
`(status, created_at)`, which leads on the wrong column. Every page view was a sequential scan plus a
top-N heapsort — **765 buffers at 15,000 rows**, against 144 for the equivalent page of `bookings`.
Cheap today and nothing ever deletes from this table, so it only grows. **Fixed: 765 → 50 buffers**,
index scan, no sort.

**F-9 · `handleSummary` hid the run's own checks.** Returning a `stdout` key REPLACES k6's default
summary, so scenario 3 printed a latency curve and nothing about whether any page answered something
other than 200 — the correctness half, and the half that transfers off this hardware. **Fixed**: the
summary now prints request count, check pass rate and 5xx rate alongside the curve.

### Correctness results

| Check                                                 | Result                                                          |
| ----------------------------------------------------- | --------------------------------------------------------------- |
| Page past the end renders an empty table, never a 400 | **pass** — page 100,000 answers 200                             |
| A page over the ceiling is refused, not clamped       | **pass** — page 100,001 answers 400 `request.validation_failed` |
| No sequential scan on any registry request path       | **pass**, after F-7 and F-8                                     |
| The capped total is never printed as an exact figure  | **pass**, after F-7                                             |

### Remaining risks

**R-5 · The `page` ceiling of 100,000 is still in place** — see the recommendation above. Until it
moves, one request can ask the database to read 2.5 million rows.

**R-6 · The audit-log registry's deep pagination was NOT measured.** `audit_log` is append-only by
trigger, so the timestamp spread that made the bookings measurement valid (below) could not be
applied to it in place. It needs the next regeneration.

---

## Scenario 4 — authentication under attack

**What was tested.** Two shapes, because they exercise different controls. Single-source: 50 attacker
VUs against 5,000 real accounts from one address for five minutes, with a legitimate customer signing
in from that same address. Distributed: each attempt from a different address against 40 accounts,
with a bystander on an unrelated address.

**Expected invariants.** Lockouts fire. Refusals are generic, so the endpoint is not an
account-enumeration oracle. **Legitimate sign-ins on unrelated accounts from the same egress address
still succeed** — the property `O-sec-1` exists for.

### Actual results

|                                            | Single source  | Distributed  |
| ------------------------------------------ | -------------- | ------------ |
| Login attempts                             | 2,412,503      | 11,477       |
| Refused (401 or 429)                       | 2,412,473      | 11,477       |
| 429 from the per-IP ceiling                | 2,412,273      | 0            |
| 5xx                                        | **0**          | **0**        |
| Refusals generic (401/429 only)            | **pass**       | **pass**     |
| Password checks that reached `AuthService` | ~200           | 11,477       |
| Accounts locked                            | **0 of 5,000** | **40 of 40** |
| Bystander sign-ins                         | **0 of 30**    | **5 of 5**   |

**The account lockout holds.** Under the distributed shape — where the per-IP ceiling never bites and
the lockout is the only defence left — all 40 targeted accounts locked after five attempts, and a
bystander on an unrelated address was completely unaffected. That is the plan's "lockouts fire",
measured.

**The per-IP ceiling is an extremely effective stuffing bound.** From one address, 2.4 million
attempts produced roughly 200 password checks. Nothing reached the lockout because nothing needed to.

### The finding

**F-10 · `O-sec-1`'s property does not hold: an attacked address cannot sign in at all.** A
legitimate customer with correct credentials, on the attacked egress address, pacing themselves well
inside their own per-account allowance, succeeded **0 times out of 30**. The cause is the per-IP
`@Throttle({limit: 40, ttl: 60_000})` on `/auth/login`, which everybody behind one address shares.

This is not a regression — the 40-per-IP ceiling is the documented, deliberate stuffing bound agreed
on 2026-08-07. The finding is that the mitigation recorded under `O-sec-1` addressed only ONE of the
two limiters. Keying the `account` throttler on (IP, account) removed its collateral damage; the
per-IP ceiling still starves the address, and until now nobody had measured it.

**The threshold is the problem, and this part is arithmetic rather than a laptop measurement.** Forty
a minute is 0.67 a second. An attacker making ONE request a second — trivial, unremarkable in a log —
consumes 60 a minute and denies sign-in to that address about a third of the time. At two a second it
is two thirds. For a Syrian market behind carrier-grade NAT, where thousands of subscribers share an
egress address, that is a live availability risk and not a theoretical one.

**Recommended fix, for Bashar's decision: count only FAILED sign-ins against the per-IP ceiling.** A
stuffing run produces failures; a legitimate customer produces a success. Throttling failures per
address keeps the stuffing bound exactly where it is while making the bystander unreachable by it.
The alternatives are worse: raising the ceiling weakens the bound, and a CAPTCHA is new scope.
**Not applied** — this changes the semantics of a security control agreed with Bashar, and it is his
call, not a load-test side effect.

**F-11 · The per-(IP, account) throttler could be bypassed, and aimed, with a forged header.** Found
while investigating F-10. `accountTracker`'s `clientIp` read `x-forwarded-for` and took the LEFT-MOST
entry — the reasoning being that behind a proxy the left-most entry is the original client. True, and
unusable: a proxy APPENDS, so whatever the client sent is still on the left. That entry is
client-controlled in every deployment, including a correctly configured one.

Measured against a running instance, using the exact header shape a correct single proxy produces
(`X-Forwarded-For: <forged>, <real client>`), twenty wrong-password attempts against one account:

|                                   | Refused after                        |
| --------------------------------- | ------------------------------------ |
| Before, varying the forged prefix | **never** — 16 of 16 allowed through |
| After                             | **10**, as configured                |

Worse than the bypass is that it was aimable: forge the header to somebody else's address, name their
email, spend ten attempts, and their next real sign-in from that address is refused. That is the
targeted denial of service the file's own header says keying on IP + email had eliminated — "a
stranger cannot starve anybody" — reintroduced by the single line that chose which IP.
Severity: medium. **Fixed** — `clientIp` returns `req.ip`, which Express computes under
`trust proxy = 1` by walking the header from the right and ignoring anything a client prepended. The
existing test asserted the OPPOSITE (that the forgeable value won) and now asserts it is ignored.

The residual is unchanged and already recorded in §8: `trust proxy` must match the real number of
proxies, or `req.ip` is forgeable again — for the limiter and for everything else that asks where a
request came from, which is the argument for having one answer rather than two.

**F-12 · Scenario 4's own bystander threshold could not pass.** The bystander VU looped with no think
time — 61,631 sign-ins in five minutes, 205 a second — while the `account` throttler allows ten a
minute per (address, account). It exhausted its own budget inside the first second, so its 0.02%
success rate was indistinguishable from the attack starving it. Proved by measuring a bystander on a
completely unrelated address with no attack against it at all: **10 successes out of 83,215**.
**Fixed** — the bystander now waits ten seconds between sign-ins, inside its own allowance, so the
only thing that can refuse it is the ceiling it shares with the attackers. F-10's numbers above are
from the corrected scenario.

### Remaining risks

**R-7 · A locked account still pays for a full Argon2id verification on every attempt.** The lock is
checked AFTER the password, deliberately and with a comment: it closes a lockout-state oracle, so
`auth.locked` requires knowing the password. The consequence is that the lockout bounds ACCESS but
not WORK — under the distributed shape one account absorbed 288 attempts, each a full Argon2id
verification at 19 MB of memory. The per-IP ceiling normally bounds this; a distributed attack varies
the address, so it does not. Worth putting to the external penetration test (`S-9`) rather than
trading the oracle back.

**R-8 · The plan's "50 addresses" was one address.** The single-source shape is one source by
construction. The distributed shape covers the other extreme. Neither is the middle case.

---

## Generator and harness defects found by running it

**F-13 · Five million bookings shared 86 timestamps.** `now()` is the TRANSACTION timestamp and the
generator inserts one rung per statement, so every booking in a rung carried one `created_at` — and
all 200,000 `confirmed` rows carried exactly ONE. This is the trap §8 of the register already records
("rows written in one test all tie"), walked into by the generator itself.

It invalidated measurements rather than just looking untidy. The console's default order is
`created_at DESC, id DESC`, so every measurement of it was a sort over a nearly constant column
decided entirely by the tiebreaker. A first reading of `?status=confirmed` page 1 came out at 236,526
buffers and looked like a missing index; with realistic timestamps the same query is **46 buffers**
and the planner's choice was right all along. That reading is retracted, and the index that appeared
to justify it is justified by F-7 instead.

**Fixed** — `created_at` is now spread within each rung from a deterministic per-row offset, so a
regenerated database stays comparable. `audit_log` and `ledger_entries` had the same shape (900
distinct values over 20M rows) and are spread the same way. The existing `safra_load` was corrected in
place for `bookings`, which is mutable: 86 → 1,948,386 distinct timestamps. `audit_log` and
`ledger_entries` are append-only by trigger and could not be, which is why R-6 stands.

**F-14 · The double-booking invariant could not detect a double booking.** `pnpm load:invariants`
tested `GROUP BY unit_id, check_in HAVING count(*) > 1` — only the case where two live bookings share
an IDENTICAL check-in date. The constraint it stands for forbids any OVERLAP, so Aug 1–5 against
Aug 3–7 on one unit, two customers and two shared nights, returned no rows and printed `ok`.

This was scenario 2's entire verdict, and it is the failure mode the plan warns about in its own words
— "a counter nothing increments passes at zero and reads as proof". Severity: high, against the
harness. **Fixed** with a window-function check over adjacent stays per unit, and three tests that
drop the exclusion constraint inside a rolled-back transaction, write the overlap it would have
refused, and require the invariant to find it. Verified both ways: the old query returns `[]` for the
staggered overlap, the new one finds it. The window form was chosen over the direct self-join on `&&`
deliberately — the join would lean on the gist index the constraint itself creates, and a check whose
speed comes from the artifact whose absence it detects degrades exactly when it is needed.

**F-15 · Drizzle's `.desc()` cannot serve a plain `ORDER BY … DESC`.** Found while fixing F-8, and
general enough to matter beyond it. `.desc()` emits `DESC NULLS LAST`; PostgreSQL's plain
`ORDER BY x DESC` means `DESC NULLS FIRST`. Those are different orderings, so an index built by the
DSL cannot remove the sort — and the failure is silent: the index is created, it is valid, `\di` shows
it, and the plan does not change.

| Same query, same data                   | Result                              |
| --------------------------------------- | ----------------------------------- |
| No index                                | 765 buffers, Seq Scan + Sort        |
| Index built with drizzle `.desc()`      | **765 buffers, Seq Scan + Sort**    |
| Same columns with PostgreSQL's defaults | **27 buffers, Index Scan, no sort** |

A prefix of the sort key is not enough either: a single-column `(created_at DESC)` left the plan
unchanged, because the query's tiebreaker is `reference DESC`. **Fixed** — the index moved to
`migrations/post/0007_registry_order_indexes.sql` where the ordering can be written exactly, and both
findings are recorded next to the index that depends on them.

---

## What was fixed, and what it cost

|                       |                                                                                                                                                                                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Defects found         | **15** — 5 in the harness (F-1, F-9, F-12, F-13, F-14), 10 in the product or its data                                                                                                                                                                                                                              |
| Fixed in this pass    | **12**                                                                                                                                                                                                                                                                                                             |
| Left open by decision | 3 — R-1/R-2 (a global exception filter), F-10's remedy (Bashar's call), the `O-page-1` ceiling (Bashar's call)                                                                                                                                                                                                     |
| Tests added           | **24** — `load-invariants.integration.test.ts` (3), `coded-throttler.guard.test.ts` (5), `idempotency.integration.test.ts` (7), `booking-arrival.integration.test.ts` (5), `capped-count.test.ts` (4). Two existing `account-tracker` assertions were INVERTED, because they asserted that the forgeable value won |
| `pnpm verify`         | **1,836 passing**, up from 1,811                                                                                                                                                                                                                                                                                   |
| `pnpm e2e`            | **244 passing**, unchanged                                                                                                                                                                                                                                                                                         |
| New indexes           | 2 — `bookings_status_created_idx` (34 MB at 5M rows), `partner_applications_created_idx`                                                                                                                                                                                                                           |
| New error codes       | 4 — `request.too_many`, `booking.dates_just_taken`, `booking.same_day_closed`, `booking.arrival_in_past`, each translated in ar/en/de                                                                                                                                                                              |

**One branch is covered by a test rather than by a browser, and that is worth naming.** The console's
capped note («أكثر من N حجز») needs more than ten thousand bookings in a single status, which the
development fixtures do not hold — so it cannot be reached in `pnpm e2e`. The uncapped branch and the
changed response shape DO run in a browser on every run (`navigation.spec.ts` renders the page, and a
wrong shape would throw); the capped branch is held by `capped-count.test.ts`, and the API half was
measured directly against `safra_load`, which answers `total: 10000, capped: true`.

**Not one of the fifteen would have been caught by a test, and eleven were invisible at fixture
volumes.** Three of them — F-1, F-6 and F-14 — meant a scenario was structurally incapable of
producing its own result, which is the same class of defect as `O-scale-1` and for the same reason: no
environment had ever held a million of anything, and no scenario had ever been run.

---

## Security pass over this change

Per §1 of `.claude/CLAUDE.md`, over the twelve fixes and their blast radius. Named checks, not a
feeling.

| Checked                                                     | Result                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Input** — every new field validated at the boundary       | No new request field. The one new caller-influenced value on a new path is `params` in an error body, sanitised to `string \| number` by `asParams` before it reaches a message                                                                                                                                                               |
| **Injection** — new SQL, `sql.raw`, string concatenation    | One new `sql.raw` call site, in a test, over a module constant (18 → 19 total). Every new query is parameterised: the capped counts read statuses from `enum_range(NULL::booking_status)`, not from a request; `reclaimStale` binds key, scope and interval                                                                                   |
| **Authorization** — new routes, guard order                 | No new route. `CodedThrottlerGuard` replaces `ThrottlerGuard` in the same `APP_GUARD` position, so throttling still runs before `JwtAuthGuard`. **Staff scope survived the counts rewrite** — `scopeFilter(actor, 'b.city_id')` is inside the capped subquery, verified by reading the emitted SQL                                            |
| **Secrets** — anything new in the diff                      | `prepare-load-accounts.ts` writes a `super_admin` whose password is in the repository. See the finding below                                                                                                                                                                                                                                  |
| **PII in logs** — the two new log lines                     | `scope` is `booking.create`, not PII. The release error embeds the failing statement, whose only parameter is the client's own idempotency key. **Log forging checked and impossible**: `json.logger.ts` writes `safeStringify(entry)`, so a newline in a key is escaped inside the JSON string rather than starting a line                   |
| **Client trust** — values read from a response and rendered | The checkout form now resolves the `code`, and `errorMessage` falls back to a generic catalogue entry for an unknown one — so an attacker-controlled `code` cannot put text on the page. That is strictly safer than the `message` it replaced, which was printed verbatim                                                                    |
| **Blast radius** — who consumed what changed                | All four clients that handle a 429 key on `status === 429` and use their own translated string; none reads the body. Nothing read the 409's `reason` field. `x-forwarded-for` is no longer read raw anywhere in the API — the remaining reads are the three BFF routes and `packages/session` FORWARDING it, which is correct proxy behaviour |

### One finding, in my own work, fixed

**S-1 · `pnpm load:accounts` would have put a repository-published `super_admin` password on a remote
load environment.** The name guard stops it touching development or production, but the capacity run
needs a load database that is reachable from elsewhere — so it would have happened. Severity: high if
it had reached that environment, zero today.
**Fixed** — off localhost the script refuses the published defaults and names the four variables that
must be supplied; the closing banner stops echoing a supplied password into terminal scrollback or a
CI log. All four guards were verified by running them: a non-local host refuses, a database without
`load` in its name refuses, `load:token` refuses a non-local API, and the local path still works.

### Two considered and dismissed

**The stale-claim reclaim is not a new exposure.** Taking over an abandoned claim requires the
idempotency key, and a key is already a bearer token for its operation — `replay()` has always
returned the stored response to whoever presents one. The key is a client-side `crypto.randomUUID()`
that never leaves TLS. What the reclaim changes is 409 versus running the handler, both gated on the
same secret.

**`scope` was stored and never enforced.** Only one scope exists (`booking.create`), and `replay()` is
protected indirectly anyway — two operations have different bodies, so the request hash answers 422.
Tightened regardless: the reclaim now matches on scope and rewrites it, because a row holding one
operation's result under another's label is a lying column, and this is where it would have gone wrong
silently.

### Not a finding, but worth stating

The 500 body under pool exhaustion was checked against the real thing rather than assumed:
`{"statusCode":500,"message":"Internal server error"}`. No SQL, no bound parameters, no guest email.
Rule 1 holds on the path where 1,680 responses went through it.

---

## What is still owed on blocker #10

Unchanged: **execution against production-shaped infrastructure**, which is gated on the deployment
target (#1). This run does not shorten that list. What it does is make the day it happens a run rather
than an investigation:

1. **Regenerate `safra_load`** so `audit_log` and `ledger_entries` carry spread timestamps (R-6).
2. **Teach the generator to write `payments` and `notifications`**, so two of the four invariants stop
   passing over empty tables (R-4).
3. **Scenarios 5 and 6** — media/CDN and the 12-hour soak — need infrastructure and stay deferred.
4. **Distributed load generation** for scenario 2 against a real deployment, where a forged
   `X-Forwarded-For` is correctly ignored and the route's 10-per-minute limit binds again.
5. **Then the capacity numbers**, and only then.
