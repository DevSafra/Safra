# SAFRA — Future work, blockers and open decisions

> **This document is the authoritative resume point.** Opening it should be enough to
> recover full context and continue, without reading the rest of the repository first.
>
> **How to use it in a new session:** read §1 for where things stand, §3 for the next
> action, then §4–§9 for the item you are picking up.

**Last updated:** 2026-08-02
**Branch:** `main` (the only branch — see `.claude/CLAUDE.md` §5)
**Last pushed:** `422dc33`

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

**460 tests pass.** `pnpm verify` (format, lint, types, tests, dependency audit) is
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

1. **M-1** Deployment target / infrastructure
2. **M-2** Sanctions feed activation
3. **M-3** Backups and restore validation
4. **M-4** Redis-backed rate limiting
5. **M-5** Staff provisioning workflow
6. **M-6** Health endpoint

**Start M-2 immediately regardless of its position.** It is the only item whose timeline
SAFRA does not control, and it fails a week after anyone stops paying attention.

**M-4, M-5 and M-6 are not blocked by anything.** They can be built today, in parallel
with the external dependencies in M-1, M-2 and M-3. Sequence position reflects
importance, not readiness.

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

**Partially actionable now:** a multi-stage Dockerfile is provider-agnostic and can be
written before the decision. The pipeline cannot.

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

**Status:** **ready to build, nothing blocking** · **Owner:** Backend

`ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }])` uses the default in-memory
store. With N replicas the effective limit is N × 120, and every counter resets on
deploy. This weakens precisely the limits that matter — login, password reset, OTP.

It also contradicts the project's own rule that application servers are stateless and
shared state lives in Redis (`.claude/CLAUDE.md` §2).

**To unblock:** nothing. `REDIS_URL` is already a required environment variable and
already provisioned. The throttler is simply not wired to it.

**Estimate:** about a day including tests.

### M-5 — Staff accounts can only be created with direct SQL

**Status:** **ready to build, nothing blocking** · **Owner:** Backend

No invite flow, no admin-creates-admin screen, no seed for the first `super_admin`.
Every staff account so far was inserted by hand.

This is not merely inconvenient. Bootstrapping production means running an INSERT against
the production database — the exact access pattern the audit log exists to make
unnecessary.

**To unblock:** nothing. Needs a documented bootstrap command for the first
`super_admin`, then an in-console invite flow for the rest.

**Design constraint:** a newly created staff account must be forced through 2FA
enrolment before it can do anything. `StaffTwoFactorGuard` already enforces this — see
§10 — so the invite flow must not attempt to work around it.

### M-6 — No health endpoint

**Status:** **ready to build, nothing blocking** · **Owner:** Backend

`GET /health` returns 404, so no load balancer can distinguish a wedged replica from a
healthy one.

**To unblock:** nothing. Needs liveness and readiness endpoints — readiness should check
the database and Redis, liveness should not (a liveness probe that fails on a database
blip restarts healthy replicas during an incident and makes it worse).

---

## 5. Should-have before production

### S-1 — No error tracking, no metrics, no alerts

**Status:** blocked on M-1 · **Owner:** Platform engineering

No Sentry or equivalent; no metrics, so the p95 < 200 ms budget in the project rules is
currently unmeasurable.

**Three failures are silent today and should be alerted first:**

1. A failing sanctions refresh — it logs at `error` and tells nobody. The visible
   symptom arrives days later as a blocked verification queue.
2. The SLA sweep silently not running — partners escape fines and customers lose
   compensation, with nothing to indicate it.
3. Refresh-token replay detection firing — currently a log line; it is a security event.

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

### S-4 — No retention policy for identity documents

**Status:** deferred by decision, now due · **Owner:** **Compliance**

Bashar decided on 2026-08-01 to store and restrict access to partner ID documents and
defer the retention policy. Storing them in production without a retention rule starts a
GDPR clock.

**To unblock:** a stated retention period and a deletion mechanism.

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
