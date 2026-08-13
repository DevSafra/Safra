# Background jobs: BullMQ design and migration plan

**Phases 1 and 2 are BUILT** (2026-08-13, on Bashar's instruction). Phases 3–6 remain, and are
implementation-ready. What was blocked was never a design question: it was the decision to make Redis
durable infrastructure, and that decision has now been taken.

> **Why it waits.** BullMQ turns Redis from a cache into **durable job infrastructure**. A lost
> Redis today costs rate limiting for a few minutes; a lost Redis after this costs queued work. That
> changes hosting, backups, restore and operational ownership, and Bashar declined to make that
> decision implicitly (2026-08-07). This document exists so the decision is the only thing left.

---

## What runs in a request today, and should not

| Work                    | Where                         | Cost of it being synchronous                                                   |
| ----------------------- | ----------------------------- | ------------------------------------------------------------------------------ |
| **Email notifications** | `NotificationService.notify`  | An unreachable SMTP server adds its timeout to a booking request               |
| **Image processing**    | `PropertyImageService.upload` | 6 sharp variants inline; the endpoint is throttled to 20/min _because_ of this |
| Payout accrual          | `@Cron`, hourly               | Single-replica by advisory lock; no retry                                      |
| Ranking recompute       | `@Cron`, daily                | Same                                                                           |
| SLA sweep               | `@Cron`                       | Same. **A missed sweep means customers owed compensation do not get it**       |
| Sanctions refresh       | `@Cron`                       | Same                                                                           |

The pattern: everything asynchronous is either **in a request** (and can make it slow) or **on a
cron with no retry** (and can silently not happen).

---

## Queues

Five, split by **failure semantics** rather than by subject — the useful question is what should
happen when a job fails, and jobs that answer it differently do not belong together.

| Queue       | Jobs                                            | Concurrency | Retries | Backoff                   | Notes                                                      |
| ----------- | ----------------------------------------------- | ----------- | ------- | ------------------------- | ---------------------------------------------------------- |
| `mail`      | notifications, verification, reset, invitations | 10          | 5       | exponential, 30 s → 8 min | Idempotent; a duplicate email is survivable                |
| `media`     | image processing, variant generation            | 4           | 3       | exponential, 10 s         | CPU-bound — concurrency is a **CPU** budget, not an IO one |
| `scheduled` | accrual, ranking, SLA sweep, sanctions refresh  | 1           | 2       | fixed, 5 min              | Repeatable jobs; already idempotent by construction        |
| `webhooks`  | outbound partner/PSP callbacks                  | 5           | 8       | exponential, 1 min → 4 h  | The long tail is deliberate — receivers go down for hours  |
| `exports`   | CSV/report generation                           | 2           | 2       | fixed, 1 min              | User-visible; failure must reach the person who asked      |

**Why `scheduled` has concurrency 1.** The advisory-lock pattern that keeps cron single-replica is
replaced by a queue that cannot run two of the same job. Simpler, and the lock disappears.

---

## Retry strategy

- **Exponential with jitter** everywhere except `scheduled`. Without jitter, a provider recovering
  from an outage receives every retry simultaneously and goes down again.
- **`removeOnComplete: { age: 86400, count: 10000 }`** — a day of history is enough to answer "did
  it run", and unbounded completed jobs are a memory leak with a retention question attached.
- **`removeOnFail: false`.** A failed job is evidence. It stays until moved or resolved.
- **Job ids are deterministic where the work is.** `notification-<id>`, `accrual-<YYYY-MM-DDTHH>`.
  BullMQ refuses a duplicate id, which makes at-least-once delivery safe **at the queue level** as
  well as at the database level. **A DASH, not a colon** — this document said `notification:<id>`
  and BullMQ rejects it outright (`Custom Id cannot contain :`), because the colon is its own key
  separator. Corrected 2026-08-13 after the first enqueue failed.

**Retries do not replace idempotency, they require it.** Every job must be safe to run twice, and
they already are: `partner_payout_items.booking_id` is unique, notification rows are keyed, image
processing is content-addressed by generated key.

---

## Dead-letter handling

BullMQ has no dead-letter queue; a job that exhausts its attempts stays in `failed`. That is
insufficient, because nothing reads `failed`.

**Design:**

1. On `failed` with no attempts left, a worker-level handler writes a row to a new
   **`dead_letter_jobs`** table: queue, job name, id, payload, error, attempts, `failed_at`.
   Durable, queryable, and it survives a Redis flush — which is the whole point.
2. **Payload is redacted before storage.** Job payloads carry email addresses and booking
   references; `redactContactDetails` already exists and is used for exactly this in
   `NotificationService`.
3. **Alert on the table**, not on Redis (`docs/alerting.md`).
4. A staff screen at `/jobs` lists dead letters with **retry** and **discard**, both audited and
   behind a new `JOB_MANAGE` permission. Retry re-enqueues with a fresh id.
5. **Never automatic re-drive.** A job that failed eight times over four hours has a reason, and
   replaying it on a schedule is how one broken payload becomes a loop.

---

## Migrating the schedulers

`@nestjs/schedule` `@Cron` → BullMQ repeatable jobs.

**What is gained:** retries, history, a dead letter, and the advisory lock becomes unnecessary —
`scheduled` at concurrency 1 across a cluster is a stronger guarantee than a lock this codebase has
to remember to take.

**What must be preserved:** `scheduled_job_runs`. It is what the runbook queries and what alerting
watches, and it must keep being written — from inside the job, exactly as now. **The queue records
attempts; the table records business outcome, and they are not the same thing.**

Migration per job:

1. Define the repeatable job with the same cron expression.
2. Move the body into a processor unchanged; it already calls `runExclusively`.
3. `runExclusively` keeps recording, and **drops the advisory lock** — that is the only change to
   its shape.
4. Delete the `@Cron` decorator.
5. Deploy with the queue empty. Confirm one clean run per job before deleting the cron path.

**Run both for one week**, with the cron path disabled by a flag rather than deleted, so a rollback
is a flag rather than a deploy.

---

## Monitoring

| Signal                 | Threshold                          | Severity |
| ---------------------- | ---------------------------------- | -------- |
| Queue depth            | > 1,000 for 10 min                 | page     |
| Oldest waiting job age | > 15 min (`mail`), > 1 h (`media`) | page     |
| Dead letters           | any new row                        | page     |
| Failed rate            | > 5 % over 15 min                  | page     |
| Worker heartbeat       | none for 2 min                     | page     |
| Repeatable job missed  | no run within 2× its interval      | page     |

Exposed on the same `GET /internal/metrics` endpoint alerting already needs — **the queue adds no
new integration point.**

`bull-board` is deliberately **not** exposed: it is an unauthenticated admin UI by default, and the
data a staff member needs is the dead-letter screen, which is behind our own RBAC.

---

## Operational requirements

**This is the section the hosting decision needs.**

| Requirement           | Detail                                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Redis **persistence** | AOF `everysec`, **not** the cache-mode default. Today Redis is disposable; after this it is not                                                              |
| Redis memory          | ~2 GB to start. Failed jobs are retained, so growth is bounded by the dead-letter policy, not by traffic                                                     |
| `maxmemory-policy`    | **`noeviction`.** Any `allkeys-*` policy will evict queued jobs under pressure — silently. This single setting is the difference between a queue and a cache |
| Redis backup          | RDB snapshots, hourly. See below                                                                                                                             |
| Worker processes      | Separate deployment from the API. Same image, different entrypoint                                                                                           |
| Worker scaling        | Independent of API replicas — that is the point                                                                                                              |
| Graceful shutdown     | `SIGTERM` → stop accepting, finish in-flight, 30 s grace                                                                                                     |
| Separate Redis?       | **Recommended.** Rate limiting can lose data; queues cannot. One instance forces the stricter policy on both, which is affordable but should be a choice     |

---

## Backup and restore implications

**The change: Redis becomes a system with a recovery point objective.**

- **RPO.** With AOF `everysec`, up to one second of enqueues. Acceptable — every producer writes its
  database row **before** enqueueing, so a lost job is recoverable by scanning for rows without a
  terminal state.
- **That recoverability is a design requirement, not a happy accident.** `notifications` rows are
  written `queued` before the send is attempted; payout items exist before accrual runs. **A future
  job type must follow the same pattern**, or Redis becomes the only record of pending work and the
  RPO stops being one second.
- **Restore order** matters: database first, then Redis, then start workers. Starting workers
  against a restored Redis and a stale database would replay jobs against rows that no longer match.
- **A total Redis loss is DETECTABLE, and not yet re-drivable.** Corrected 2026-08-13, having built
  phase 2 and looked. Scanning for `notifications` rows still `queued` finds exactly what was lost —
  that half works, and `safra_notifications_1h{status="queued"}` already alerts on it. But a
  `notifications` row deliberately stores **no recipient, no subject and no body** (rule 1: this
  table is read by every support agent), so the row identifies the lost notice and cannot
  reconstruct it. Re-sending means re-deriving the email from the subject FKs — which is a
  per-template reconstructor keyed by `template_key`, and does not exist.
  **This is a real gap in the recovery story, not a missing script.** Until it is closed, a total
  Redis loss means the notices in flight are identifiable and unsendable. Tracked as `O-notify-2`;
  it belongs with `M-3`'s restore drill, because a drill that cannot re-drive has not been passed.
- **Restore order** matters as stated above regardless.

---

## Rollout plan

**Phase 1 — infrastructure.** Redis with persistence and `noeviction`; worker deployment; metrics
scrape; alerts armed. No application change. _Verifiable on its own._

**Phase 2 — `mail`.** The lowest-risk queue: idempotent, non-critical-path, immediately valuable.
`NotificationService.notify` writes its row and enqueues instead of sending. Everything else is
untouched. **This alone removes the accepted deviation in `O-notify-1`.**

**Phase 3 — `media`.** Upload stores the original and enqueues processing; the manager shows a
processing state. Needs a small UI change and an `images.status` column — the only phase with a
schema migration.

**Phase 4 — `scheduled`.** As above, with both paths live for a week.

**Phase 5 — `webhooks`, `exports`.** New capability rather than migration.

**Phase 6 — remove** the advisory lock, the `@Cron` decorators, and the flag.

Each phase is independently shippable and independently revertible. **Phases 1 and 2 are worth doing
on their own** even if the rest waits.

---

## Estimate

| Phase                             | Effort                  |
| --------------------------------- | ----------------------- |
| 1 — infrastructure                | 1 day (mostly not ours) |
| 2 — `mail`                        | 2 days                  |
| 3 — `media`                       | 3 days                  |
| 4 — `scheduled`                   | 2 days                  |
| 5 — `webhooks`/`exports`          | 3 days                  |
| 6 — cleanup                       | 1 day                   |
| Dead-letter table, screen, alerts | 2 days                  |

**~14 engineering days**, phased. Nothing in it needs design work first.
