# Alerting and monitoring

What must page somebody, what must merely be visible, and exactly what has to be wired once a
hosting target exists.

> **This document is the implementation contract for infrastructure.** The metric names, labels,
> thresholds, severities, access model and integration points below are settled and may be adopted
> as-is. Nothing in it requires further design work, and a change to any metric name or label is a
> breaking change to be made here first.

**Status: the application side is BUILT. The consumer is not.**

`GET /internal/metrics` exposes every table-derived signal below as a Prometheus gauge (added
2026-08-08). What remains is entirely outside this repository: a scraper, a rule file, log shipping
and a pager. The exact rules are given below, so that work is configuration rather than design.

---

## The principle

**Alert on a symptom a person would care about, not on an event.** A failed notification is an
event; _notifications have been failing for ten minutes_ is a symptom. The distinction matters here
because most of what this platform does is asynchronous, and the failure that costs money is almost
always **silence** rather than an error.

The three silent failures this system can have, in order of cost:

1. **A scheduled job stops firing.** Nothing throws. Six weeks later somebody asks why no partner
   has been paid since March.
2. **Notifications stop being delivered.** Partners are still fined for not answering requests they
   were never told about (§6.4).
3. **The sanctions feed goes stale.** Screening still runs, against data that no longer reflects
   the lists we are legally obliged to check.

Each of those is a query against a table this application already writes.

---

## Signals, thresholds, and severity

| #   | Signal                    | Source                    | Condition                                                         | Severity | Why this threshold                                                                         |
| --- | ------------------------- | ------------------------- | ----------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------ |
| 1   | Accrual stopped           | `scheduled_job_runs`      | no `completed` row for `payout-accrual` in **2 h**                | **page** | Runs hourly; two misses is a pattern, not a blip                                           |
| 2   | Ranking stopped           | `scheduled_job_runs`      | no `completed` row for `ranking-recompute` in **26 h**            | ticket   | Daily at 03:00; one missed night is tolerable                                              |
| 3   | Job failing repeatedly    | `scheduled_job_runs`      | ≥3 `failed` rows for one job in 6 h                               | **page** | One failure can be a dispute opening mid-run; three is code or data                        |
| 4   | Notifications failing     | `notifications`           | `failed` ≥ 20 % of the last 50, or ≥10 consecutive                | **page** | A partner not told is a partner unfairly fined                                             |
| 5   | No notifications at all   | `notifications`           | zero rows in 6 h during 08:00–22:00 Damascus                      | ticket   | Catches a wiring break that produces no failures either                                    |
| 6   | Sanctions feed stale      | `sanctions_list_versions` | newest `fetched_at` older than **48 h**                           | **page** | Compliance obligation, not a product feature                                               |
| 7   | Sanctions refresh failing | job log                   | ≥2 consecutive failures                                           | ticket   |                                                                                            |
| 8   | Media unreadable          | `/health/ready`           | `media` ≠ `ok` on any replica                                     | **page** | Every photograph on the platform is broken                                                 |
| 9   | Startup failure           | process exit              | container restarts ≥3 times in 10 min                             | **page** | Crash-looping replica                                                                      |
| 10  | Readiness failing         | `/health/ready`           | 503 on >½ of replicas for 2 min                                   | **page** | Database gone                                                                              |
| 11  | Redis degraded            | `/health/ready`           | `redis: degraded` for 10 min                                      | ticket   | Rate limiting is failing open — a security control is off                                  |
| 12  | Error rate                | structured logs           | 5xx **excluding `request.capacity`** > 2 % of requests over 5 min | **page** | Breakage. A capacity refusal is load and is counted by 12b instead — see below             |
| 12b | At capacity               | structured logs           | `request.capacity` > 1 % of requests over 5 min                   | ticket   | The connection pool is the bottleneck. Nothing is broken; the platform needs more of it    |
| 12c | At capacity, sustained    | structured logs           | `request.capacity` > 5 % of requests over 5 min                   | **page** | At one request in twenty the platform is effectively down for the people it refuses        |
| 13  | Latency budget            | access log                | p95 > 200 ms or p99 > 500 ms over 10 min                          | ticket   | Rule 3's stated budget                                                                     |
| 14  | Payment webhook backlog   | `payment_provider_events` | rows AWAITING processing older than 15 min                        | **page** | Money captured, booking not advanced. Excludes events rejected on arrival — see 14b        |
| 14b | Rejected webhooks         | `payment_provider_events` | > 20 rejected in 24 h                                             | ticket   | Bad signature or unparseable body: a forgery attempt, or a provider changing their payload |
| 15  | SLA sweep backlog         | `bookings`                | `pending_confirmation` past `confirmation_deadline_at` by >15 min | **page** | The sweep is not running; customers owed compensation are not getting it                   |
| 16  | Disk / bucket growth      | infrastructure            | >80 % capacity                                                    | ticket   |                                                                                            |
| 17  | Dead-letter jobs          | `dead_letter_jobs`        | any unresolved row                                                | **page** | A job exhausted every retry. Built 2026-08-13 with BullMQ phase 2                          |

**"Page" means wake somebody.** With three engineers and no rota yet, that is one on-call phone.
If the rota does not exist at launch, every `page` above becomes a ticket **and the launch
checklist must say so out loud** — an alert nobody receives is worse than no alert, because it
creates the belief that somebody is watching.

---

## Capacity refusals — what a 503 means here (`O-api-1`)

Added 2026-08-20, after scenario 2 of the load test answered **1,680 of 12,231 requests with a bare
500** while the connection pool was exhausted. This section is the contract between what the API
now answers and what the rules above match on.

### Response behaviour

`AppExceptionFilter` is registered globally and is the only thing that shapes an error the
application did not raise deliberately.

| Condition                                                                                                                                      | Status    | Body                                                                            | Headers            |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------- | ------------------ |
| The request never reached the database — `pg-pool` acquisition or connect timeout, or SQLSTATE `53300` / `53400` / `57P03` / `08001` / `08004` | **503**   | `{"statusCode":503,"code":"request.capacity","message":"The service is busy…"}` | `Retry-After: 1‥5` |
| Any other unhandled error                                                                                                                      | **500**   | `{"statusCode":500,"code":"request.unknown","message":"Something went wrong…"}` | —                  |
| Any `HttpException` — every deliberate refusal in the API                                                                                      | unchanged | unchanged, byte for byte                                                        | unchanged          |

Three properties are worth stating because they are what the rules depend on:

- **The 503 set is deliberately narrow.** `Retry-After` is an INSTRUCTION to send the request
  again, and this API accepts non-idempotent writes. Only conditions where no statement was ever
  written to a socket qualify, so a retry cannot duplicate a booking. A statement timeout, a
  deadlock, a full disk, an out-of-memory and an outright `ECONNREFUSED` all stay **500** — they
  are ambiguous about what happened, or they are breakage that must page.
- **`Retry-After` is jittered over 1–5 s.** A fixed value synchronises everybody refused in the
  same instant into one retry, and the second wave exhausts the pool on schedule.
- **The body is generic.** No SQL, no bound parameters, no email. Verified against the real thing
  under load on 2026-08-20 and pinned by `app-exception.filter.test.ts`.

### Monitoring implications

1. **The 5xx error rate is no longer one number.** Signal 12 previously counted every 5xx and would
   have paged for load; it now excludes `request.capacity`, and 12b/12c count that separately. A
   run that produced 1,680 pool timeouts used to read as 1,680 failures — it now reads as the
   platform shedding load, which is what it was.
2. **The access log carries the code.** `requestLogMiddleware` appends the error code to its line
   and logs a `request.capacity` 503 at **`warn`** rather than `error`, so a level-based alert does
   not page either. Every other 5xx is unchanged at `error`.
3. **Status code alone is NOT the discriminator.** 503 is already the answer for several named
   dependency failures (`auth.unavailable`, `pricing.unavailable`, `payment.unavailable`). Match on
   the CODE, never on `status == 503`.
4. **12b firing is a capacity decision, not a defect.** The remedies, in order: raise
   `DATABASE_POOL_MAX`, add replicas, put pgBouncer in transaction mode in front of PostgreSQL.
   `docs/load-test-results-2026-08-20.md` R-1 has the measurement it came from.
5. **Nothing to build.** These come from the log stream that already exists; no new metric, no
   scrape target, no schema change.

### Rules affected

| Rule                   | Change                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| 12 — Error rate        | Now excludes `request.capacity`. **Must be edited before arming**, or it pages for load          |
| 12b, 12c — At capacity | New. Ticket at >1 %, page at >5 %, both over 5 min                                               |
| 10 — Readiness failing | Unchanged. A 503 from `/health/ready` is a different thing and is matched on the path            |
| 13 — Latency budget    | Unchanged, but read it alongside 12b: a refused request is FAST, so pool exhaustion improves p95 |

Rule 13's note is the one that catches people out. A capacity refusal returns in about the pool's
`connectionTimeoutMillis` and then stops costing anything, so a platform refusing a third of its
traffic can post a healthier p95 than one serving all of it. Latency alone will not find this; 12b
is what finds it.

---

## Where each signal comes from

### Already produced, no code needed

- **`scheduled_job_runs`** — every job records `status`, `started_at`, `duration_ms`, `detail`,
  `error`. Written by `JobRunService.runExclusively`. Queries are in
  `docs/runbook-scheduled-jobs.md`.
- **`notifications`** — every send records `status`, `attempts`, `failure_reason` (contact details
  redacted). See `docs/notifications.md`.
- **`/health/ready`** — reports `database`, `redis`, `media`.
- **Structured JSON logs** with correlation ids, plus an access log.

### Built — `GET /internal/metrics`

Prometheus text exposition, version 0.0.4. **The scraper never needs database credentials**, and
the schema stays an implementation detail rather than being encoded in somebody else's rule file.

| Series                                                                      | Alerts | Notes                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `safra_job_last_success_age_seconds{job}`                                   | 1, 2   | **-1 means never completed** — reported rather than omitted, because an absent series is indistinguishable from a failed scrape                                                                                                                                                                                     |
| `safra_job_failures_6h{job}`                                                | 3      | A `skipped` run is another replica doing nothing, and never counts as a success                                                                                                                                                                                                                                     |
| `safra_notifications_1h{status}`                                            | 4, 5   | `sent`, `failed`, and `queued` — the last is its own failure: written, never sent, never retried                                                                                                                                                                                                                    |
| `safra_sanctions_snapshot_age_seconds{source}`                              | 6      | `{source="none"} -1` while `M-2` is unresolved                                                                                                                                                                                                                                                                      |
| `safra_payment_events_unprocessed` + `_oldest_unprocessed_seconds`          | 14     | Count and age of events AWAITING processing. Fifty events thirty seconds old is a busy minute; one stuck an hour is a paid booking that did not advance. **Excludes rejected events, which can never be processed** — counting them made this alert fire permanently after one malformed request (fixed 2026-08-13) |
| `safra_payment_events_rejected_24h`                                         | 14b    | Webhooks refused on arrival. A rate, not a backlog: the number that matters is how many arrived, not how long they have sat                                                                                                                                                                                         |
| `safra_bookings_sla_overdue`                                                | 15     | Counts the CONSEQUENCE, because a sweep that stops running produces no signal of its own                                                                                                                                                                                                                            |
| `safra_dead_letter_jobs{queue}` + `safra_dead_letter_oldest_seconds{queue}` | 17     | Zero is reported per queue rather than omitted, because an absent series is indistinguishable from a failed scrape. Counted from the TABLE and never from Redis — a dead letter is the evidence that must survive a Redis failure                                                                                   |
| `safra_media_reachable`                                                     | 8      | 1 or 0                                                                                                                                                                                                                                                                                                              |
| `safra_metrics_collection_seconds`                                          | —      | Self-monitoring: this endpoint must stay cheap. **20 ms measured**                                                                                                                                                                                                                                                  |

**Access.** Bearer token in `METRICS_TOKEN`. No token configured, wrong token, missing token and
missing scheme all answer **404** — fail closed, and quietly, so the route is indistinguishable
from a build that never had it. Comparison is timing-safe.

**Cost.** Cached for 10 s, so several replicas under a scrape storm cost one set of queries each.
Every query is bounded by time or by a partial index; none is an unbounded `count(*)`.

### Needs the hosting decision

- Log shipping, retention, and search.
- The scraper or agent.
- Paging (PagerDuty, Opsgenie, or a phone).
- Uptime checks from outside the network — the one class of failure no internal signal can see.

---

## The rules, ready to paste

```yaml
groups:
  - name: safra
    rules:
      # 1 — accrual stopped. -1 (never) fires this too, which is intended.
      - alert: PayoutAccrualStopped
        expr: safra_job_last_success_age_seconds{job="payout-accrual"} > 7200
          or safra_job_last_success_age_seconds{job="payout-accrual"} == -1
        for: 5m
        labels: { severity: page }

      # 2 — ranking stopped.
      - alert: RankingRecomputeStopped
        expr: safra_job_last_success_age_seconds{job="ranking-recompute"} > 93600
        for: 15m
        labels: { severity: ticket }

      # 3 — a job failing repeatedly.
      - alert: ScheduledJobFailing
        expr: safra_job_failures_6h >= 3
        for: 5m
        labels: { severity: page }

      # 4 — notifications failing as a PROPORTION; a full mailbox is not an outage.
      - alert: NotificationsFailing
        expr: >
          safra_notifications_1h{status="failed"} /
          clamp_min(sum without (status) (safra_notifications_1h), 1) > 0.2
          and safra_notifications_1h{status="failed"} >= 5
        for: 10m
        labels: { severity: page }

      # 5 — none at all, which produces no failures either.
      - alert: NoNotificationsSent
        expr: sum without (status) (safra_notifications_1h) == 0
        for: 6h
        labels: { severity: ticket }

      # 6 — sanctions data stale, or never fetched.
      - alert: SanctionsFeedStale
        expr: safra_sanctions_snapshot_age_seconds > 172800
          or safra_sanctions_snapshot_age_seconds == -1
        for: 15m
        labels: { severity: page }

      # 8 — every photograph on the platform is broken.
      - alert: MediaUnreachable
        expr: safra_media_reachable == 0
        for: 5m
        labels: { severity: page }

      # 14 — money captured, booking not advanced.
      #
      # The gauge counts only events that CAN be processed. A rejected webhook stays
      # unprocessed for the thirty days before retention prunes it, so including it here
      # made this rule fire forever after one malformed request.
      - alert: PaymentEventsBacklogged
        expr: safra_payment_events_oldest_unprocessed_seconds > 900
        for: 5m
        labels: { severity: page }

      # 17 — a job exhausted every retry. Never auto-re-driven: see the design doc.
      - alert: DeadLetterJobs
        expr: sum(safra_dead_letter_jobs) > 0
        for: 1m
        labels: { severity: page }

      # 14b — somebody is sending us rubbish, or a provider changed their format.
      - alert: PaymentWebhooksRejected
        expr: safra_payment_events_rejected_24h > 20
        for: 15m
        labels: { severity: ticket }

      # 15 — the sweep is not running; customers owed compensation are not getting it.
      - alert: SlaSweepNotRunning
        expr: safra_bookings_sla_overdue > 0
        for: 15m
        labels: { severity: page }

      # Self-monitoring: the endpoint must not become the load.
      - alert: MetricsCollectionSlow
        expr: safra_metrics_collection_seconds > 1
        for: 15m
        labels: { severity: ticket }
```

Scrape config:

```yaml
scrape_configs:
  - job_name: safra-api
    metrics_path: /api/v1/internal/metrics
    scrape_interval: 30s
    authorization: { type: Bearer, credentials_file: /etc/secrets/safra-metrics-token }
    static_configs: [{ targets: ['api:4000'] }]
```

**Scrape every 30 s, not every 5.** The gauges are cached for 10 s and every threshold above is
measured in minutes; a faster scrape buys nothing and multiplies the queries by the replica count.

**`absent()` on the whole job matters too.** If the scrape itself fails, none of these fire — that
is what an `up == 0` alert is for, and it belongs in the same rule file.

---

## Integration points, precisely

Whatever is chosen, it attaches at exactly four places:

1. **`GET /api/v1/health`** — liveness. Container orchestrator.
2. **`GET /api/v1/health/ready`** — readiness. Load balancer, and alerts 8/10/11.
3. **stdout** — structured JSON, one object per line, already correlation-tagged. Alerts 12, 12b,
   12c and 13. Every access-log line carries the request's error CODE when it has one, so
   separating capacity from breakage is a label match rather than a guess at the status.
4. **`GET /internal/metrics`** — the table-derived gauges, bearer-token authenticated. Alerts 1–7, 14, 14b, 15. **Built**; nine gauges, 20 ms to collect.

Nothing else in the application needs to change. **No alerting decision blocks any product work**,
and no product decision blocks alerting.

---

## What we will NOT alert on, and why

- **Individual 4xx responses.** They are the API working. A validation failure is not an incident.
- **A single job failure.** Accrual legitimately skips a booking whose dispute opened mid-run.
- **Individual notification failures.** A partner with a full mailbox is not an outage. The
  _pattern_ is what matters, which is why #4 is a ratio.
- **Rate-limit rejections.** They are the control functioning. A _spike_ belongs on a security
  dashboard, not a pager.
- **An individual `request.capacity` 503.** One request refused because the pool was momentarily
  full is the platform shedding load correctly, which is what `O-api-1` built. The RATE is what
  matters, which is why 12b and 12c are ratios and why the access log records the code.

---

## Runbook coverage

Every `page` alert must name a runbook before it is armed. Two exist:
`docs/runbook-scheduled-jobs.md` (alerts 1–3) and `docs/notifications.md` (alert 4). **Alerts 6, 8,
9, 10, 14 and 15 have no runbook yet** — writing them is unblocked engineering work and belongs
with the alerting implementation, not after it.
