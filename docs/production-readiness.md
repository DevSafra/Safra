# Production readiness — remaining blockers

**As of 2026-08-02.** Scope: what stands between the current state and a
**staff-operated platform running in production**. Customer-facing launch is a
superset of this and is not assessed here.

Payment rails (roadmap items 84, 135) are **deferred to the end of the project** by
Bashar's decision on 2026-08-01 and are excluded from the counts below. They remain a
launch blocker for taking money; they are not a blocker for staff operability.

---

## Where the platform actually is

Staff can, today, sign in with enforced 2FA, work the partner and listing verification
queues, read and review uploaded identity documents, run sanctions screening, verify or
reject a partner, approve or reject a listing, look up any booking with its full money
breakdown and append-only timeline, read the audit log, and change every operational
setting with the change recorded and attributed.

460 tests pass. `pnpm verify` (format, lint, types, tests, dependency audit) is clean.

What follows is what is missing, ordered by what stops you first.

---

## Classification

Every remaining item falls into one of three tiers. **Must-have** means the platform
cannot be operated safely in production without it. **Should-have** means it can be
operated, but with a known and accepted risk that has an owner. **Deferred** means it
costs capability, not safety.

| #   | Item                                                              | Tier                 | Owner                |
| --- | ----------------------------------------------------------------- | -------------------- | -------------------- |
| 1   | Deployment target / infrastructure                                | Must-have            | Platform engineering |
| 2   | Sanctions feed activation                                         | Must-have            | **Compliance**       |
| 3   | Backups and restore validation                                    | Must-have            | Platform engineering |
| 4   | Redis-backed rate limiting                                        | Must-have            | Backend              |
| 5   | Staff provisioning workflow                                       | Must-have            | Backend              |
| 6   | Health endpoint                                                   | Must-have            | Backend              |
| 7   | Error tracking and alerts                                         | Should-have          | Platform engineering |
| 8   | Partner notification of a waiting booking                         | Should-have          | Product / Backend    |
| 9   | Load-test booking and search                                      | Should-have          | Backend              |
| 10  | ID document retention policy                                      | Should-have          | **Compliance**       |
| 11  | Legal review of terms and partner contract                        | Should-have          | **Legal**            |
| 12  | Messaging and disputes                                            | Deferred             | Product              |
| 13  | Remaining §9.3 sections, non-EU lists, Emergency Mode, gift cards | Deferred             | Product              |
| 14  | Payment rails and payouts                                         | Deferred by decision | Bashar, 2026-08-01   |

**Agreed order of work (Bashar, 2026-08-02): items 1 → 6, in that sequence, with no
further product scope until there is a plan for all six.** Item 2 is sequenced second
but should be _started_ immediately — it depends on an external party and is the only
item whose timeline SAFRA does not control.

---

## Must-have — cannot operate in production without these

### 1. No deployment target exists

There is no Dockerfile, no infrastructure definition, no hosting provider (roadmap
item 193 is open), and no environment beyond a developer's laptop. CI runs lint, types,
tests and a secret scan; nothing deploys.

Everything below assumes this is solved first, because none of it can be verified until
something is actually running.

**Needed:** provider and region decision, container build, managed Postgres 17 with
`pg_trgm`, managed Redis, object storage, a secret manager, TLS termination, and a
deploy pipeline.

### 2. The sanctions feed is not activated

Fully documented as of today in [`runbooks/sanctions-feed.md`](runbooks/sanctions-feed.md),
including a verified finding: the widely-circulated public FSF token now returns HTTP
500 and registration is mandatory.

Someone with a real EU Login account must register, obtain a token, and set
`SANCTIONS_FEED_URL`. Until then the list must be imported by hand and goes stale in
seven days — at which point **partner verification refuses outright and onboarding
stops**. This is the single item most likely to be discovered too late.

**Owner:** Compliance. Not an engineering task.

### 3. No backups, and no restore anyone has tried

There is no backup configuration, no retention policy, and no tested restore. The
database holds the ledger, the audit log and the append-only tables that the whole
compliance story rests on — all of which are, by design, impossible to reconstruct.

**Fix:** point-in-time recovery on the managed instance, plus a restore rehearsal.
A backup nobody has restored is not a backup.

### 4. Rate limiting is per-process, so it does not survive horizontal scaling

`ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }])` uses the default in-memory
store. With N replicas the effective limit is N × 120, and every counter resets on
deploy. The login, password-reset and OTP limits — the ones that matter — are the ones
this weakens.

This directly contradicts the project's own rule that application servers are stateless
and shared state lives in Redis. Redis is already a required environment variable and
already provisioned; it is simply not wired to the throttler.

**Fix:** a Redis-backed `ThrottlerStorage`. Contained, roughly a day with tests.

### 5. Staff accounts can only be created with direct SQL

There is no staff provisioning flow — no invite, no admin-creates-admin screen, no seed
for the first `super_admin`. Every staff account so far was inserted by hand.

This is not merely inconvenient: bootstrapping production means someone runs an INSERT
against the production database, which is exactly the access pattern the audit log
exists to make unnecessary.

**Fix:** a documented bootstrap command for the first `super_admin`, then an in-console
invite flow for the rest.

---

### 6. No health endpoint (and, separately, no error tracking or metrics)

`GET /health` returns 404, so no load balancer can tell a wedged replica from a healthy
one. There is no Sentry or equivalent, and no metrics — the p95 < 200 ms budget in the
project rules is currently unmeasurable, and the rules themselves say to state the
measurement rather than guess.

Specifically un-alerted today: a failing sanctions refresh (logs at `error`, tells
nobody), the SLA sweep silently not running, and refresh-token replay detection firing.

**Fix:** health/readiness endpoints, error tracking, and alerts on the three above.

## Fixed today, noted because they were found rather than known

### Staff 2FA was enforced in the console, not the API

`AuthService.login` demanded a TOTP code only when the account **already had one
enabled**. A staff account that never enrolled authenticated with a password alone and
received a fully privileged token. Verified against a running instance: a
`support_agent` with `totp_enabled_at IS NULL` read booking detail including customer
contact details.

The admin console redirected unenrolled staff to `/enrol-2fa`, which is why this was
invisible — but the console is not the security boundary. Declining to enrol was, in
effect, a way to opt out of two-factor authentication.

Closed by `StaffTwoFactorGuard`, registered globally between authentication and
permission checks, with narrow exemptions for the enrolment routes, `/auth/me` and
public routes. Seven unit tests; re-verified end to end (`403` where it was `200`,
enrolment and sign-out still reachable, customers unaffected).

### Production could silently store identity documents on local disk

`StorageModule` falls back to `LocalDiskStorage` when S3 is unconfigured — right for a
developer, silently destructive in production: partner ID documents would land on one
replica's ephemeral filesystem, 404 from every other replica, and disappear on
redeploy. It warned; it did not refuse.

Now a boot-time refusal, matching the existing `SMTP_URL` guard. `loadEnv` had no tests
at all despite being the boot-time security control; it now has seven.

### `settings_history` was mutable

The record of who changed a commission rate could be rewritten or deleted by anything
holding a database connection, while its siblings (`audit_log`, `timeline_events`,
`ledger_entries`) were all append-only by trigger. Now covered by the same trigger, with
a regression test verified to fail when the trigger is dropped.

### Booking timestamps rendered in the server's timezone

`column::text` formats in the session timezone. It read correctly only because the
container happens to be `Etc/UTC`; a managed instance defaulting to anything else would
have shifted every timestamp on screen while still labelled "UTC". Since these
timestamps are what answer "was the partner late?", that is a wrong answer to a
contractual question. Now explicit `AT TIME ZONE 'UTC'`.

---

## Should-have, and deferred

### Support agents cannot do two thirds of their job

SRS §4 defines a support agent as someone who "sees bookings, **messages** and
**disputes**". Neither exists — no tables, no modules, no UI. The permissions
(`MESSAGE_READ`, `MESSAGE_SEND`, `DISPUTE_READ`, `DISPUTE_MANAGE`) are defined and
assigned to roles, which makes the platform look more capable than it is.

Bookings work. The other two are unbuilt features, not missing screens. This is the
largest functional gap in the product.

### No customer-facing notifications

No notification table, no WhatsApp BSP selected (item 192). A partner is not told a
booking is waiting; they find out by looking. Given a two-hour confirmation SLA with
fines attached, that is a fairness problem as much as a product one.

### Settings converge across replicas in up to 30 seconds

`SettingsService` caches for 30 s and invalidates in-process only, so a change made on
one replica is stale on the others for up to that long. Acceptable — bookings snapshot
the values they used, so no existing booking can be corrupted — but it should be a
recorded decision rather than a surprise. Redis-backed invalidation would close it.

### Admin console covers 4 of the 18 sections in §9.3

Built: dashboard, partner verification, listing review, booking lookup, audit log,
settings. The remaining sections are deliberately deferred, not forgotten — the ones
built are those that block a partner being onboarded.

### Screening is EU-only

UK (OFSI), US (OFAC/SDN) and UN lists are not ingested. Deliberate for a German merchant
entity under EU law (ADR 0002), and a gap to revisit before taking US or UK payments.

### Load testing has never been run

The project rules require load-testing critical paths before claiming a capacity number.
No capacity number should be claimed until that happens. The schema is indexed and
paginated for it; that is a design property, not a measurement.

---

## Where this list came from

Every "must-have" here is something that was verified against a running system rather
than inferred: the rate limiter's storage was read from its configuration, the health
endpoint was requested and returned 404, the staff-provisioning gap is why every account
in the test database was inserted by hand, and the sanctions endpoint was called.

The three "fixed today" entries were all found the same way — by trying to break a claim
rather than by reading the code that makes it. That is the argument for treating the
must-have list as incomplete rather than exhaustive: nothing in it was found by
inspection alone, so the parts of the system that have never been run in a
production-shaped environment are the parts most likely to be hiding the next one.
