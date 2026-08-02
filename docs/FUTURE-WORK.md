# SAFRA — Future work, blockers and open decisions

> **This document is the authoritative resume point.** Opening it should be enough to
> recover full context and continue, without reading the rest of the repository first.
>
> **How to use it in a new session:** read §1 for where things stand, §3 for the next
> action, then §4–§9 for the item you are picking up.

**Last updated:** 2026-08-02 (M-4, M-5, M-6 delivered; container image, structured logging, deployment requirements, test-teardown hardening)
**Branch:** `main` (the only branch — see `.claude/CLAUDE.md` §5)
**Last pushed:** `422dc33` — later commits are local until pushed

---

## Maintaining this document

Update it **after every milestone, and whenever any of the following appears**: a
blocker, an external dependency, a deferred decision, a production-readiness gap, a
compliance dependency, an infrastructure requirement, a future enhancement, or any task
that cannot be completed immediately.

Every entry carries: **what**, **why it is blocked**, **what unblocks it**, **who owns
it**, **where it sits in the order**, and **status**. An entry without "what unblocks
it" is not finished being written — the point of the register is that a future session
can act, not just be informed.

Use absolute dates. When an item is resolved, move it to §10 with the date rather than
deleting it; the reason something was blocked is often the reason it comes back.

---

## 1. Where the project stands

**Staff workflows are functionally complete.** A staff member can sign in with enforced
two-factor authentication, work the partner and listing verification queues, read and
review uploaded identity documents, run sanctions screening, verify or reject a partner,
approve or reject a listing, look up any booking with its full money breakdown and
append-only timeline, read the audit log, and change every operational setting with the
change attributed and recorded.

**505 tests pass.** `pnpm verify` (format, lint, types, tests, dependency audit) is
clean, and the suite passes against a freshly migrated and seeded database.

**What remains is not product.** It is infrastructure, operations and compliance. That
is the central finding of the 2026-08-02 assessment and it still holds.

---

## 2. Standing decisions that constrain all future work

These are not open questions. They are settled, and changing one is a decision for
Bashar, not an implementation detail.

| Decision                                                      | Date           | Detail                                            |
| ------------------------------------------------------------- | -------------- | ------------------------------------------------- |
| Work directly on `main`; never branch                         | 2026-07-29     | No feature branches, no PR flow, never force-push |
| Commit messages are exactly one line, typed prefix            | 2026-07-29     | No body, no `Co-Authored-By`, no tool footers     |
| Ask before every commit and every push                        | standing       | No batching of approval                           |
| Merchant of record: Safra Technologies GmbH (Germany)         | 2026-07-29     | ADR 0002                                          |
| Payment rails and payouts deferred to end of project          | 2026-08-01     | Items 84, 135                                     |
| Money settings carry a currency, plus `money.always_usd`      | 2026-08-01     | Toggle ON by default; ADR 0006                    |
| ID documents: store, restrict access, defer retention policy  | 2026-08-01     | Retention is now item **S-4** below               |
| FX management: `super_admin` only, with a toggle for finance  | 2026-08-01     | `rbac.finance_can_manage_fx`                      |
| **No new product scope until must-haves M-1…M-6 have a plan** | **2026-08-02** | Bashar, explicit                                  |

---

## 3. Recommended execution order

Agreed with Bashar on 2026-08-02. **Do not expand product scope until all six
must-haves have a plan.**

1. **M-1** Deployment target / infrastructure — blocked on the hosting decision
2. **M-2** Sanctions feed activation — blocked on an external party
3. **M-3** Backups and restore validation — blocked on M-1
4. ~~**M-4** Redis-backed rate limiting~~ — **done 2026-08-02**, see §10
5. ~~**M-5** Staff provisioning workflow~~ — **done 2026-08-02**, see §10
6. ~~**M-6** Health endpoint~~ — **done 2026-08-02**, see §10

**Start M-2 immediately regardless of its position.** It is the only item whose timeline
SAFRA does not control, and it fails a week after anyone stops paying attention.

**M-4, M-5 and M-6 are delivered. Every must-have that engineering can act on alone is
now done.** M-1, M-2 and M-3 are blocked on a decision (hosting) or an external party
(the EU registration); M-3 additionally depends on M-1. Nothing further on the
must-have list can start until someone outside engineering acts.

### Highest-risk item

**M-3, backups.** Not the most likely to bite — that is M-2 — but the only failure on
the list that is _unrecoverable_. Every other must-have fails loudly and reversibly: the
sanctions feed refuses, a wedged replica serves errors, a weak rate limit is an attack
you can detect. Data loss is silent until the moment you need the data, and this
platform is unusually exposed to it because the entire compliance story rests on records
designed to be impossible to reconstruct — the double-entry ledger, `audit_log`,
`timeline_events`, `settings_history`, all append-only by trigger precisely so they can
serve as evidence. That property is worth nothing if the database is gone.

---

## 4. Must-have blockers

### M-1 — No deployment target exists

**Status:** blocked · **Owner:** Platform engineering + Bashar (decision)

There is no Dockerfile, no infrastructure definition, no hosting provider, and no
environment beyond a developer laptop. CI runs lint, types, tests and a secret scan;
nothing deploys. Roadmap item 193 is the open hosting decision.

**Blocked by:** the hosting provider and region decision, which is Bashar's.
Everything else in this section is downstream of it.

**To unblock:** choose provider and region. Then: container build, managed PostgreSQL 17
with `pg_trgm`, managed Redis, object storage (S3-compatible), a secret manager, TLS
termination, and a deploy pipeline.

**Partially done (2026-08-02).** The provider-agnostic half is complete and verified:

- `apps/api/Dockerfile` — multi-stage, non-root, no source or dev dependencies in the
  final layer, `tini` for signal handling, a liveness-only `HEALTHCHECK`. Verified by
  building it and running it against real Postgres and Redis: serves both health
  endpoints, reports `healthy`, and logs `SIGTERM received; draining` on stop.
- `docs/runbooks/deployment-requirements.md` — what any provider must supply, written
  so the hosting decision can be made against a concrete list. **Read it before
  choosing**; it flags `pg_trgm` availability as a hard requirement that a few managed
  Postgres offerings do not meet, which would be an expensive surprise post-migration.

**Still blocked:** the pipeline, and everything that needs a running environment.

**Note:** the API refuses to boot in production without `SMTP_URL` and without
`S3_ACCESS_KEY_ID` + `S3_BUCKET`. Both are deliberate; see §10.

### M-2 — The sanctions feed is not activated

**Status:** blocked on an external party · **Owner:** **Compliance, not engineering**

Partner verification is a hard gate on sanctions screening, and the platform refuses to
screen against a list older than **7 days** (`MAX_SNAPSHOT_AGE_DAYS`). Without an
automated feed the list must be imported by hand and goes stale within a week, at which
point **partner onboarding stops entirely**.

**Blocked by:** nobody holds an EU Login account for the European Commission's Financial
Sanctions Files (FSF) system, and the download token is issued to a registered account.

**To unblock:** register at <https://webgate.ec.europa.eu/fsd/fsf>, obtain a token, set
`SANCTIONS_FEED_URL`. Full procedure in
[`runbooks/sanctions-feed.md`](runbooks/sanctions-feed.md).

**Two findings verified against the live service on 2026-08-02, both of which will waste
a day if forgotten:**

- The widely-circulated public token `dG9rZW4tMjAxNw` **no longer works** — HTTP 500,
  identical to a bogus token, while the FSF service itself is healthy. Registration is
  mandatory, not a formality.
- The parser requires the **XML 1.1** export. Most third-party guidance points at 1.0,
  which uses different elements and parses to zero entries.

**Interim position:** `POST /admin/sanctions/import` (super_admin) accepts a manually
downloaded list. Built, tested, and the documented fallback.

**Register the account to a shared compliance mailbox**, not an individual — a personal
account silently expires the token when that person leaves.

### M-3 — No backups, and no restore anyone has tried

**Status:** blocked on M-1 · **Owner:** Platform engineering

No backup configuration, no retention policy, no tested restore. See §3 for why this is
the highest-severity item on the list.

**Blocked by:** M-1. There is no database to back up yet.

**To unblock:** point-in-time recovery on the managed instance, a stated retention
period, and — non-negotiable — a rehearsed restore into a scratch environment. A backup
nobody has restored is not a backup.

### M-4 — Rate limiting is per-process

**Status:** ✅ **Delivered 2026-08-02.** See §10.

### M-5 — Staff accounts can only be created with direct SQL

**Status:** ✅ **Delivered 2026-08-02.** See §10.

### M-6 — No health endpoint

**Status:** ✅ **Delivered 2026-08-02.** See §10.

---

## 5. Should-have before production

### S-1 — No error tracking, no metrics, no alerts

**Status:** blocked on M-1 · **Owner:** Platform engineering

**Prerequisite done (2026-08-02):** logs are now structured JSON on stdout, one object
per line, carrying `level`, `time`, `context`, `requestId` and `userId`. Sensitive keys
are redacted **in the logger**, not by convention at each call site. Every request gets
an `x-request-id` — reused from upstream when present so a trace started at the load
balancer stays one trace — and it is echoed in the response, so a support conversation
can start with an ID instead of "it broke around two o'clock". Wiring an aggregator is
now configuration rather than a refactor.

No Sentry or equivalent; no metrics, so the p95 < 200 ms budget in the project rules is
currently unmeasurable.

**Three failures are silent today and should be alerted first:**

1. A failing sanctions refresh — it logs at `error` and tells nobody. The visible
   symptom arrives days later as a blocked verification queue.
2. The SLA sweep silently not running — partners escape fines and customers lose
   compensation, with nothing to indicate it.
3. Refresh-token replay detection firing — currently a log line; it is a security event.
4. **Redis unreachable.** Rate limiting fails open by design, so a Redis outage silently
   removes rate limiting from every endpoint. `RedisThrottlerStorage` logs at `error`
   with "Rate limiting is DEGRADED"; nothing alerts on it yet. Readiness reports
   `redis: "degraded"` and is the cheapest thing to poll.

**Also alert on `sanctions ageDays > 3`,** not 7. By 7 onboarding has already stopped;
3 leaves two missed nightly runs of margin.

### S-2 — Partners are not notified that a booking is waiting

**Status:** blocked on a decision · **Owner:** Product + Bashar

A partner is not told a booking awaits confirmation; they find out by looking. Against a
two-hour SLA with fines attached, that is a fairness problem, not only a product gap.

**Blocked by:** roadmap item 192, WhatsApp BSP selection. No notification table exists
either.

**Workaround at launch volume:** staff phone the partner. Does not survive growth.

### S-3 — Load testing has never been run

**Status:** blocked on M-1 · **Owner:** Backend

The project rules require load-testing critical paths before claiming a capacity number,
and require stating the measurement rather than guessing. **No capacity number should be
quoted until this runs.** The schema is indexed and paginated for it, but that is a
design property, not a measurement.

**Targets:** search, booking creation, the partner queue.

### S-4 — No retention policy, and erasure conflicts with the audit log

**Status:** deferred by decision, now due · **Owner:** **Compliance**, with an
engineering question attached

Bashar decided on 2026-08-01 to store and restrict access to partner ID documents and
defer the retention policy. Storing them in production without a retention rule starts a
GDPR clock.

**A conflict found on 2026-08-02 while building M-5, which the retention decision has to
resolve:** `audit_log.actor_user_id` is a foreign key to `users`, and `audit_log` is
append-only by trigger. So **a user who has ever done anything cannot be hard-deleted** —
the database refuses. That is deliberate and correct (deleting an account must not erase
what it did), but it means a GDPR erasure request cannot be satisfied by deleting the
row. The available answer is soft-delete plus pseudonymisation of the personal fields,
leaving the audit trail's foreign keys intact — but "what exactly gets erased" is a
compliance decision, not an engineering one, and it should be made before the first real
request arrives rather than under a one-month statutory deadline.

**To unblock:** a stated retention period, a decision on what erasure means given the
above, and then a deletion/pseudonymisation mechanism.

### S-5 — No legal review

**Status:** blocked on an external party · **Owner:** **Legal**

Terms of service, privacy policy and the partner contract (roadmap item 196) have not
been reviewed. Required for a German merchant entity handling EU personal data.

---

## 6. Deferred until after launch

| Item                                            | Why it can wait                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Messaging and disputes**                      | The largest product gap — SRS §4 defines a support agent as handling bookings, messages and disputes, and only bookings exist. Permissions are defined and assigned but there are no tables, modules or UI, which makes the platform look more capable than it is. Deferrable **only** because there is no in-app messaging at all, so everything is already out-of-band. Stops being deferrable the moment volume outgrows phone and WhatsApp. |
| Remaining 12 of the 18 §9.3 admin sections      | The six built are those that block partner onboarding                                                                                                                                                                                                                                                                                                                                                                                           |
| UK (OFSI), US (OFAC/SDN) and UN sanctions lists | Deliberate: EU-only suits a German entity under EU law. **Revisit before taking US or UK payments.**                                                                                                                                                                                                                                                                                                                                            |
| Emergency Mode per city/country (EC-009)        | No operational need yet                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Gift cards and coupons (items 142–143)          | Compose cheaply onto the split-payment seam already built                                                                                                                                                                                                                                                                                                                                                                                       |
| Payment rails and payouts (items 84, 135)       | Deferred by Bashar 2026-08-01. Blocks taking money; does not block staff operation. Item 84 additionally needs item 194, payout mechanism per country.                                                                                                                                                                                                                                                                                          |
| Redis-backed settings invalidation              | 30-second cross-replica staleness is accepted; bookings snapshot the values they used, so no booking can be corrupted                                                                                                                                                                                                                                                                                                                           |

---

## 7. Open decisions needed from Bashar

| #   | Decision                                | Blocks                           | Notes                                                |
| --- | --------------------------------------- | -------------------------------- | ---------------------------------------------------- |
| 193 | Hosting provider and region             | M-1, and therefore M-3, S-1, S-3 | The single highest-leverage decision outstanding     |
| 192 | WhatsApp BSP                            | S-2                              |                                                      |
| 194 | Partner payout mechanism per country    | Item 84                          | Correspondent-banking problem, not a card-scheme one |
| 195 | Maps provider billing account           | Map UI                           | MapLibre + MapTiler recommended                      |
| —   | Retention period for identity documents | S-4                              | Compliance input needed                              |

---

## 8. Known risks and traps

Things that are not blockers but will cost someone a day if forgotten.

- **The logger is hand-rolled, not pino.** ~60 lines, chosen for no new dependency in a
  payments process and for redaction that cannot be bypassed by a call site. If log
  volume ever makes serialisation measurable, swapping the `write` method for pino is a
  contained change — measure before doing it.
- **`trust proxy` is set to `1` — exactly one hop.** More than one proxy in front of the
  API requires changing that number, or a client can forge `X-Forwarded-For` and walk
  through the rate limiter. Called out in the deployment requirements too.
- **Cron jobs run in-process with Postgres advisory locks.** Do NOT configure an
  external scheduler as well; it would double-run them.
- **`.env.example` lists variables nothing reads, and they are labelled.** `SENTRY_DSN`,
  `OTEL_EXPORTER_OTLP_ENDPOINT`, the WhatsApp trio and `MAPTILER_API_KEY` are aspirational.
  Each now carries a `NOT YET WIRED` comment, because the alternative is a deployer
  setting `SENTRY_DSN`, believing error tracking is on, and never discovering S-1 is
  outstanding. Keep the labels until the code actually reads them.
- **A local integration failure on a REUSED database is not evidence of a regression.**
  Two unrelated intermittent failures on 2026-08-02 (an FX assertion, a calendar
  teardown) both traced to debris accumulated in a dev database used all session, not
  to any defect. Re-run against a freshly migrated and seeded database before
  believing one. The root cause is fixed — see §10 — but the habit is still the right
  one, because any suite whose teardown is interrupted can leave rows behind.
- **A test mutates a shared seeded setting.** `settings-admin.integration.test.ts`
  changes `booking.confirmation_window_minutes` while vitest runs files in parallel.
  Nothing reads the derived value in a test today — the payments tests set
  `confirmation_deadline_at` directly — so it does not flake. The day someone asserts a
  two-hour deadline, it will flake intermittently and the cause will not be obvious.
  Cheap fix: point that test at a key nothing else consumes.
- **`pnpm verify` must pass before committing.** There is no review branch; every commit
  lands on `main` directly.
- **The API must run under SWC**, not plain `tsc`, or NestJS decorator metadata is lost
  (ADR 0003).
- **The settings uniqueness migration raises on pre-existing duplicates** rather than
  choosing a winner. Correct, but it means the migration refuses rather than proceeds if
  any environment has duplicate settings rows.
- **The `REDIS` injection token lives in `redis/redis.tokens.ts`, not the module.**
  `RedisModule` provides `RedisThrottlerStorage`, which injects `REDIS`; with the token
  in the module those two files import each other and under ESM the decorator runs
  before the cycle resolves — the process dies at boot with "Cannot access 'REDIS'
  before initialization". A unit test that constructs the storage directly never touches
  the module, which is exactly how it was missed. Do not move the token back.
- **Rate limiting fails OPEN when Redis is unreachable.** Deliberate — failing closed
  would turn a cache outage into a total outage. The exposure is bounded but real, and
  it is why S-1 lists alerting on Redis errors as required before production.
- **A user who has ever acted cannot be hard-deleted.** `audit_log.actor_user_id` is a
  foreign key and `audit_log` is append-only, so `DELETE FROM users` fails with a foreign
  key violation. Use soft-delete (`deleted_at`), which is what the application does and
  what test cleanup must do. This has a GDPR consequence — see S-4.
- **`MailService` and `AuthTokenService` are exported by `AuthModule`, not re-provided.**
  Re-providing them elsewhere would create a second nodemailer transport and a second
  token-issuing path, so a change to either would apply in one place and not the other.
- **Sanctions screening is advisory, not deciding.** The platform scores name similarity
  (0.35 to surface, 0.75 flagged strong) and records the reviewer's conclusion. The human
  remains accountable for the determination.

---

## 9. Reference — where things live

| What                                       | Where                                     |
| ------------------------------------------ | ----------------------------------------- |
| Binding engineering rules                  | `.claude/CLAUDE.md`                       |
| Architecture decisions and their rationale | `.claude/memory/` (indexed in its README) |
| Full roadmap, item by item                 | `ROADMAP.md`                              |
| Production-readiness narrative, 2026-08-02 | `docs/production-readiness.md`            |
| Sanctions feed activation procedure        | `docs/runbooks/sanctions-feed.md`         |
| **This register**                          | `docs/FUTURE-WORK.md`                     |

---

## 10. Resolved

Kept because the reason something was blocked is often the reason it returns.

| Date       | Item                                                       | Resolution                                                                                                                                                                                                                                                                                                                                             |
| ---------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-08-02 | Staff 2FA enforced in the console but not the API          | `AuthService.login` demanded a TOTP code only if the account already had one enabled, so never enrolling was a way to opt out entirely — verified live: a `support_agent` with `totp_enabled_at IS NULL` read booking detail on a password alone. Closed by `StaffTwoFactorGuard`, with narrow exemptions for enrolment, `/auth/me` and public routes. |
| 2026-08-02 | Production could store ID documents on local disk          | `StorageModule` fell back to `LocalDiskStorage` with only a warning. Now a boot-time refusal, matching the `SMTP_URL` guard.                                                                                                                                                                                                                           |
| 2026-08-02 | `settings_history` was mutable                             | Its siblings were append-only by trigger; it was not. Same trigger applied, with a regression test verified to fail when the trigger is dropped.                                                                                                                                                                                                       |
| 2026-08-02 | Booking timestamps rendered in the server's timezone       | `column::text` formats in the session timezone; correct only because the container is `Etc/UTC`. Now explicit `AT TIME ZONE 'UTC'`.                                                                                                                                                                                                                    |
| 2026-08-02 | Audit log unreadable without SQL access                    | `/audit` console screen plus a filtered, keyset-paginated endpoint.                                                                                                                                                                                                                                                                                    |
| 2026-08-02 | Settings editable only by hand (P-005)                     | Rules Engine screen with per-schema validation, history and audit in one transaction.                                                                                                                                                                                                                                                                  |
| 2026-08-02 | Booking detail and timeline (§9.4)                         | Built. Payments section present only for `PAYMENT_READ` holders — absent, not redacted.                                                                                                                                                                                                                                                                |
| 2026-08-02 | Auth token table and mail delivery                         | Shipped earlier; tracker entry closed.                                                                                                                                                                                                                                                                                                                 |
| 2026-08-02 | Password reset, email verification, guest-booking claiming | Shipped earlier with 24 integration tests; tracker entries closed.                                                                                                                                                                                                                                                                                     |
