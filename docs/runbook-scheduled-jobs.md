# Runbook — scheduled jobs

What runs on a timer, how to tell whether it is still running, and what to do when it is not.

Written for whoever is on call, not for whoever wrote the code. Every command here is safe to run
on production unless it says otherwise.

---

## What runs

| Job                 | Schedule       | Lock key  | What it does                                                   |
| ------------------- | -------------- | --------- | -------------------------------------------------------------- |
| `payout-accrual`    | Every hour     | `8421002` | Sweeps newly-payable bookings into their partner's open period |
| `ranking-recompute` | Daily at 03:00 | `8421001` | Recomputes `recommendation_score` and the «سفرة تُرشّح» badges |

Both are `@Cron` decorators inside the API process. There is no separate worker yet — §14 calls for
a background queue and `docs/FUTURE-WORK.md` carries it; until then these run in-process and are
kept to one replica by a PostgreSQL advisory lock.

### What accrual deliberately does NOT do

It accrues, and stops. It does not close a period, release a transfer or mark anything paid. Those
three move money and §4.1 requires a person holding `PAYOUT_EXECUTE` to decide each one — a
scheduler that released payouts would be a scheduler that sent money without anybody deciding to.

So a partner's money reaching them is still a human action, taken on `/payouts` in the console.
Accrual only ensures the amount is correct and current when that person looks.

---

## Is it still running?

**The failure that matters is not a job that threw — it is a job that stopped firing.** A throw
lands in the log and in `scheduled_job_runs.error`. Silence lands nowhere, and six weeks later
somebody asks why no partner has been paid since March.

### From the console

`الدفع والفواتير → تحويلات الشركاء`. The footnote states when accrual last completed and what it
attached. If that timestamp is more than about ninety minutes old, the job is not firing.

### From the API

```
GET /api/v1/admin/jobs        # needs audit_log.read
```

Returns the newest non-skipped run of each job. Skips are excluded on purpose: on a multi-replica
deployment most ticks skip, and "last run: skipped" would be reading the replicas that did nothing.

### From SQL

```sql
-- The last ten runs of a job, newest first.
SELECT status, started_at, duration_ms, detail, error
FROM scheduled_job_runs
WHERE job = 'payout-accrual'
ORDER BY started_at DESC
LIMIT 10;

-- The question that actually matters: has it run recently?
SELECT max(started_at) AS last_run,
       now() - max(started_at) AS ago
FROM scheduled_job_runs
WHERE job = 'payout-accrual' AND status = 'completed';
```

**Alert on `ago > 2 hours`** for `payout-accrual` and `> 26 hours` for `ranking-recompute`. Neither
alert exists yet — there is no alerting at all (see `S-1` in `docs/FUTURE-WORK.md`), and this table
is what makes one possible when it lands.

---

## Recovery

### Accrual has not run for a while

Run it by hand. It is idempotent by CONSTRUCTION, not by convention: a unique index on
`partner_payout_items.booking_id` means a booking already attached cannot be attached twice,
whatever the query returns. Running it ten times in a row produces the same result as running it
once.

```
POST /api/v1/admin/payouts/accrue      # needs payout.execute
```

Then find out why it stopped. In order of likelihood:

1. **The API is not running,** or the replica holding the cron is not. Check `/api/v1/health`.
2. **A stuck advisory lock.** Should be impossible — the lock is session-scoped and released in a
   `finally` — but a connection wedged mid-transaction can hold one. See below.
3. **It is failing every tick.** `scheduled_job_runs.error` will say so, and the log carries the
   stack.

### A stuck lock

```sql
-- Who holds it, if anyone.
SELECT pid, granted, query_start, state, left(query, 120) AS query
FROM pg_locks
JOIN pg_stat_activity USING (pid)
WHERE locktype = 'advisory' AND objid = 8421002;
```

If a session holds it and is idle, that connection is wedged. Terminating it releases the lock:

```sql
SELECT pg_terminate_backend(<pid>);
```

**Do not** call `pg_advisory_unlock_all()` on a shared connection — it releases every advisory lock
that session holds, including any another job is legitimately using.

### Accrual is failing every tick

The error is in the row and the stack is in the log. The two failures seen so far:

- **A partner with no currency row**, which is a data problem rather than a code one — the accrual
  groups by `(partner_id, currency_id)` and cannot open a period without one.
- **A dispute opened mid-run.** Not a failure: the freeze is a derived query and a booking under an
  `open` or `investigating` dispute is simply excluded. It will be picked up when the dispute
  closes.

### Something was accrued that should not have been

Accrual only ATTACHES bookings to an open period; nothing has been sent. Cancel the payout, which
detaches its bookings and returns them to accrual:

```
POST /api/v1/admin/payouts/<id>/cancel      # needs payout.execute, requires a reason
```

A **paid** payout cannot be cancelled or edited — `deny_paid_payout_mutation` refuses, deliberately,
because the money has left. The remedy there is a reversing movement, which is finance's decision
and not a runbook step.

---

## Changing a schedule

Both intervals are `CronExpression` constants in the scheduler classes:

- `apps/api/src/payouts/payout.scheduler.ts`
- `apps/api/src/ranking/ranking.scheduler.ts`

They are code rather than configuration on purpose. A cron expression in a settings table is a
production incident waiting for a typo, and neither of these is something an operator should be
changing without a deploy. If that stops being true, the setting belongs in the rules engine (P-005)
with validation, not in an environment variable.

---

## Adding a job

Use `JobRunService.runExclusively(name, lockKey, work)`. It takes the advisory lock, records the
run, releases the lock in a `finally`, and re-throws so process-level handling still sees the error.

Pick a lock key no other job uses — the existing ones are listed in the table at the top. The `name`
should match the `@Cron` name, because that is what `scheduled_job_runs` is queried by.

Return a small object of counts from `work`; it is stored as `detail` and read by a person. Never
return anything sensitive: this table is read by more people than the database.
