# Alerting and monitoring

What must page somebody, what must merely be visible, and exactly what has to be wired once a
hosting target exists.

**Status: designed, not implemented.** Every signal below is already produced by the application —
this document is the specification for consuming them, and the work is blocked only on `M-1`, the
deployment decision. Nothing here requires further discovery.

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

| #   | Signal                    | Source                    | Condition                                                         | Severity | Why this threshold                                                       |
| --- | ------------------------- | ------------------------- | ----------------------------------------------------------------- | -------- | ------------------------------------------------------------------------ |
| 1   | Accrual stopped           | `scheduled_job_runs`      | no `completed` row for `payout-accrual` in **2 h**                | **page** | Runs hourly; two misses is a pattern, not a blip                         |
| 2   | Ranking stopped           | `scheduled_job_runs`      | no `completed` row for `ranking-recompute` in **26 h**            | ticket   | Daily at 03:00; one missed night is tolerable                            |
| 3   | Job failing repeatedly    | `scheduled_job_runs`      | ≥3 `failed` rows for one job in 6 h                               | **page** | One failure can be a dispute opening mid-run; three is code or data      |
| 4   | Notifications failing     | `notifications`           | `failed` ≥ 20 % of the last 50, or ≥10 consecutive                | **page** | A partner not told is a partner unfairly fined                           |
| 5   | No notifications at all   | `notifications`           | zero rows in 6 h during 08:00–22:00 Damascus                      | ticket   | Catches a wiring break that produces no failures either                  |
| 6   | Sanctions feed stale      | `sanctions_list_versions` | newest `fetched_at` older than **48 h**                           | **page** | Compliance obligation, not a product feature                             |
| 7   | Sanctions refresh failing | job log                   | ≥2 consecutive failures                                           | ticket   |                                                                          |
| 8   | Media unreadable          | `/health/ready`           | `media` ≠ `ok` on any replica                                     | **page** | Every photograph on the platform is broken                               |
| 9   | Startup failure           | process exit              | container restarts ≥3 times in 10 min                             | **page** | Crash-looping replica                                                    |
| 10  | Readiness failing         | `/health/ready`           | 503 on >½ of replicas for 2 min                                   | **page** | Database gone                                                            |
| 11  | Redis degraded            | `/health/ready`           | `redis: degraded` for 10 min                                      | ticket   | Rate limiting is failing open — a security control is off                |
| 12  | Error rate                | structured logs           | 5xx > 2 % of requests over 5 min                                  | **page** |                                                                          |
| 13  | Latency budget            | access log                | p95 > 200 ms or p99 > 500 ms over 10 min                          | ticket   | Rule 3's stated budget                                                   |
| 14  | Payment webhook backlog   | `payment_webhook_events`  | unprocessed rows older than 15 min                                | **page** | Money captured, booking not advanced                                     |
| 15  | SLA sweep backlog         | `bookings`                | `pending_confirmation` past `confirmation_deadline_at` by >15 min | **page** | The sweep is not running; customers owed compensation are not getting it |
| 16  | Disk / bucket growth      | infrastructure            | >80 % capacity                                                    | ticket   |                                                                          |

**"Page" means wake somebody.** With three engineers and no rota yet, that is one on-call phone.
If the rota does not exist at launch, every `page` above becomes a ticket **and the launch
checklist must say so out loud** — an alert nobody receives is worse than no alert, because it
creates the belief that somebody is watching.

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

### Needs a small amount of code (≤ ½ day, unblocked)

- **A metrics endpoint.** `GET /internal/metrics` in Prometheus text format, exposing the counts
  above as gauges so a scraper does not need database credentials. **This is the one piece of
  application work alerting requires**, and it is deliberately not built yet because the exposition
  format should match whatever the host provides — Prometheus, OTLP, or a vendor agent.
- **`sanctions_list_versions.fetched_at`** is written today; nothing reads it for freshness.

### Needs the hosting decision

- Log shipping, retention, and search.
- The scraper or agent.
- Paging (PagerDuty, Opsgenie, or a phone).
- Uptime checks from outside the network — the one class of failure no internal signal can see.

---

## Integration points, precisely

Whatever is chosen, it attaches at exactly four places:

1. **`GET /api/v1/health`** — liveness. Container orchestrator.
2. **`GET /api/v1/health/ready`** — readiness. Load balancer, and alerts 8/10/11.
3. **stdout** — structured JSON, one object per line, already correlation-tagged. Alerts 12/13.
4. **`GET /internal/metrics`** _(to build)_ — the table-derived gauges. Alerts 1–7, 14, 15.

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

---

## Runbook coverage

Every `page` alert must name a runbook before it is armed. Two exist:
`docs/runbook-scheduled-jobs.md` (alerts 1–3) and `docs/notifications.md` (alert 4). **Alerts 6, 8,
9, 10, 14 and 15 have no runbook yet** — writing them is unblocked engineering work and belongs
with the alerting implementation, not after it.
