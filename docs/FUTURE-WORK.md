# SAFRA — Future work, blockers and open decisions

> **This document is the authoritative resume point.** Opening it should be enough to
> recover full context and continue, without reading the rest of the repository first.
>
> **How to use it in a new session:** read §1 for where things stand, §3 for who must act
> on what, then §4–§9 for the item you are picking up, and §10 for the security position.

**Last updated:** 2026-08-04 — **the Super Admin console is complete against the design handoff.**
All 19 sections implemented and verified over three passes, with **no backend work outstanding**.
Staff scope is enforced server-side in both modes and booking exports are audited. The only
remaining gaps are externally blocked and neither is console work. Full gap analysis, the four
answers, the enforcement rules and all 17 documented deviations: **`docs/design-gap-report.md`**.
**Unblocked infrastructure work is otherwise complete.** From here the project waits on
external decisions; see §3 for who must act on what.
**Branch:** `main` (the only branch — see `.claude/CLAUDE.md` §5)
**Last pushed:** `90b188c`. Everything after it is committed locally and **not pushed** —
3 commits as of 2026-08-04, plus the uncommitted Arabic/dashboard work.

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

**632 tests pass.** `pnpm verify` (format, lint, types, tests, dependency audit) is clean, and the
suite passes against a freshly migrated and seeded database. A further **58 browser tests**
(`pnpm e2e`) cover the staff sign-in, all nineteen console sections, table search, pagination,
filtering, the dispute close workflow, contact-detail redaction, the audited CSV export and the
honesty rules; they are NOT part of `pnpm verify` and must be run separately against running
servers.

**The staff console renders in Arabic, right-to-left** (Bashar, 2026-08-03). Every section screen
is translated. What remains English is the four DETAIL screens — partner detail, property detail,
enrol-2fa, accept-invitation — plus stored data such as audit reasons and wallet notes, which are
shown as written.

**The console follows the approved design** (built out 2026-08-04, two passes). All nineteen
sections render real data: dashboard, bookings, partners, properties, customers, staff, payments,
wallet, gift cards, coupons, geography, reports, settings, audit log, Emergency Mode, disputes,
messages, WhatsApp/email and ads — plus partner contracts inside الشركاء. Nothing renders a
placeholder.

**Five new domains landed with pass 2**: `disputes` + `dispute_evidence`, `conversations` +
`messages`, `notifications`, `advertisers` + `ad_campaigns`, `partner_contracts`. One forward-only
additive migration (`0017`), 6 enums, 13 constraints each probed against the live database, and 3
new permissions. Workflows verified end to end: closing a dispute credits the wallet and releases
the payout freeze; contact details are stripped from staff replies; a contract supersedes rather
than overwrites; CSV export streams with the filter applied.

**`docs/design-gap-report.md` is the authority on visual fidelity.** It holds the full gap
analysis, the schema work each remaining section needs (B-1…B-11), and **twelve explicitly
documented deviations** from the handoff with the reasoning for each. A deviation not on that list
is a defect.

**The design handoff is at `~/Privat/design_handoff_safra/`** (provided 2026-08-04) and is
now the authority for anything visual. Its `README.md` is the specification — exact token
values (§9), the typography scale, the radius and spacing ladders, the interaction rules and
the copy. `SAFRA.dc.html` / `SAFRA-standalone.html` are prototypes to read, NOT code to port:
the handoff explicitly says not to carry over the single-file architecture, the `<sc-for>` /
`{{ }}` template runtime, or inline `style` attributes. It rates itself "high fidelity —
colors, typography, spacing, radii, shadows, copy and interaction states are final", so a
value in the codebase that disagrees with §9 is a defect, not a variation.

**What remains is not product.** It is infrastructure, operations and compliance. That
is the central finding of the 2026-08-02 assessment and it still holds.

**Infrastructure work that needs no external decision is complete as of 2026-08-03.** The
next move on the must-have blockers belongs to Bashar (hosting), Compliance (sanctions
registration, retention) and Legal. §3 sorts every remaining item by who must act.

**That is not the same as "there is nothing left to find."** On 2026-08-04, building the
dashboard surfaced a listing queue that had never once loaded (§8, §11) — a defect no test
in the suite could see. Console work continues to turn up defects of exactly that shape, so
treat "engineering complete" as a statement about planned scope, not about correctness.

---

## 2. Standing decisions that constrain all future work

These are not open questions. They are settled, and changing one is a decision for
Bashar, not an implementation detail.

| Decision                                                      | Date           | Detail                                                                                                                                                              |
| ------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work directly on `main`; never branch                         | 2026-07-29     | No feature branches, no PR flow, never force-push                                                                                                                   |
| Commit messages are exactly one line, typed prefix            | 2026-07-29     | No body, no `Co-Authored-By`, no tool footers                                                                                                                       |
| Ask before every commit and every push                        | standing       | No batching of approval                                                                                                                                             |
| Merchant of record: Safra Technologies GmbH (Germany)         | 2026-07-29     | ADR 0002                                                                                                                                                            |
| Payment rails and payouts deferred to end of project          | 2026-08-01     | Items 84, 135                                                                                                                                                       |
| Money settings carry a currency, plus `money.always_usd`      | 2026-08-01     | Toggle ON by default; ADR 0006                                                                                                                                      |
| ID documents: store, restrict access, defer retention policy  | 2026-08-01     | Retention is now item **S-4** below                                                                                                                                 |
| FX management: `super_admin` only, with a toggle for finance  | 2026-08-01     | `rbac.finance_can_manage_fx`                                                                                                                                        |
| **No new product scope until must-haves M-1…M-6 have a plan** | **2026-08-02** | Bashar, explicit                                                                                                                                                    |
| **No user-facing text is hardcoded**                          | **2026-08-04** | Every word a person reads comes from `@safra/i18n`; enforced by `safra/no-hardcoded-text` in `pnpm lint`. See `docs/i18n.md`                                        |
| **Every UI is responsive on every device**                    | **2026-08-05** | No page scrolls sideways at 390 / 768 / 1024 / 1440 px. Enforced by `e2e/responsive.spec.ts` and a zero-specificity `min-width: 0` rule in both apps' `globals.css` |
| **The console sidebar collapses at every size**               | **2026-08-05** | Hamburger always available, choice persisted, content reclaims the space, nav still reachable. `e2e/sidebar.spec.ts`                                                |
| The API answers with an error CODE, not a sentence            | **2026-08-04** | 154 codes in `@safra/contracts`. `message` is English for logs only and must never be displayed                                                                     |
| Staff scope is ENFORCED server-side, two modes                | **2026-08-04** | `none` \| `read_only` outside scope; writes refused in both. See gap report §4a                                                                                     |
| **The audit log is never scoped**                             | **2026-08-04** | Bashar: "a scoped audit log is not a trustworthy audit log"                                                                                                         |
| Every booking export writes an audit row                      | **2026-08-04** | who · when · filters · row count; immutable                                                                                                                         |

---

## 3. Status at a glance — everything sorted by who must act

**As of 2026-08-03, engineering work that can be completed without an external decision
is COMPLETE.** From here the project is blocked only by decisions outside engineering,
unless a new defect is found. That is a statement about scope, not a claim of
perfection — §10 records the residual security risk honestly.

### ✅ Completed engineering (no further action)

| Item                                                                                                                                                                         | Delivered     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| **M-4** Redis-backed rate limiting                                                                                                                                           | 2026-08-02    |
| **M-5** Staff provisioning — bootstrap command + console invite flow                                                                                                         | 2026-08-02    |
| **M-6** Liveness and readiness endpoints                                                                                                                                     | 2026-08-02    |
| **S-6** Encryption key rotation with re-encryption                                                                                                                           | 2026-08-02    |
| **M-1 (partial)** Container images for all three apps, deployment requirements                                                                                               | 2026-08-02    |
| **S-1 (prerequisite)** Structured JSON logs, correlation ids, access log                                                                                                     | 2026-08-02–03 |
| **S-7 (documented half)** Forward-only migration strategy and rollback answer                                                                                                | 2026-08-03    |
| Staff console: dashboard, partner verification, listing review, booking detail, audit log, Rules Engine, staff admin                                                         | 2026-08-02    |
| Security hardening — see §10 for the full list and evidence                                                                                                                  | 2026-08-02–03 |
| Two-step staff sign-in (password, then authenticator code) + `PasswordField` show/hide rule                                                                                  | 2026-08-03    |
| Playwright browser harness — 22 tests, the only ones that can see a client-side regression                                                                                   | 2026-08-03–04 |
| Staff console Arabic/RTL: login, dashboard, partner queue, listing queue                                                                                                     | 2026-08-03–04 |
| Dashboard rebuilt to the approved design, wired to a single-round-trip `/admin/dashboard`                                                                                    | 2026-08-04    |
| Partner and listing queues promoted to their own sections (`/partners`, `/properties`)                                                                                       | 2026-08-04    |
| **15 of the 19 design-handoff console sections** — registries, finance, promotions, geography, reports, Emergency Mode                                                       | 2026-08-04    |
| 12 new keyset-paginated admin endpoints on `RegistriesController`, each behind its narrowest permission                                                                      | 2026-08-04    |
| Emergency Mode (EC-009) end to end — activate with a required reason, deactivate, audited history                                                                            | 2026-08-04    |
| The staff permission matrix, derived from `ROLE_PERMISSIONS` so it cannot drift from the guard                                                                               | 2026-08-04    |
| Browser suite grown to 51 tests, covering every section plus search, paging and filtering                                                                                    | 2026-08-04    |
| **Staff scope enforced server-side** (B-12) in both modes, across 9 registries, the dashboard, all reports, the finance ledger and the export                                | 2026-08-04    |
| **Booking export audit** (B-13) — actor, filters and row count, immutable                                                                                                    | 2026-08-04    |
| **`@safra/i18n`** — one package owning every catalogue: customer (ar/en/de), console (ar), email (ar/en/de), errors (ar/en/de), stored content (ar/en/de)                    | 2026-08-04    |
| 154 error codes replacing 181 English exception messages, 40 Zod messages and 16 route-handler messages                                                                      | 2026-08-04    |
| `no-hardcoded-text` ESLint rule, with its own tests                                                                                                                          | 2026-08-04    |
| **Light/dark toggle in the staff console** — handoff §9.2 palette verbatim, opt-in (the console does not follow the OS), shared pre-paint script with the customer app       | 2026-08-04    |
| **Responsive console** — 7 of 19 sections scrolled sideways at 390px and 3 at 1024px; now 0 at every width, with content above the nav on a phone                            | 2026-08-05    |
| **Collapsible sidebar with a hamburger at all widths** — persisted preference applied pre-paint, drawer below `lg`, column above, Escape and backdrop dismiss, focus managed | 2026-08-05    |
| Sign-out and the theme toggle moved to the foot of the sidebar — on a phone they wrapped below the title and read as two headers                                             | 2026-08-05    |
| **Touch targets at a 40px floor below `lg`** across both apps, and the customer nav no longer hidden on phones                                                               | 2026-08-05    |
| Browser suite grown to 61 tests, including three that assert a customer reads errors in their own language                                                                   | 2026-08-04    |

### 🏗 Hosting-dependent — waiting on roadmap item 193

Nothing here can start until a provider and region are chosen. **This one decision
unblocks four items and is the highest-leverage action available.**

| Item                                                 | Note                                                             |
| ---------------------------------------------------- | ---------------------------------------------------------------- |
| **M-1** Deploy pipeline                              | The image is built and verified; the pipeline needs the provider |
| **M-3** Backups + rehearsed restore                  | **Highest severity on the whole list** — see below               |
| **S-1** Error tracking, metrics, alerting            | Logs are ready to ingest; the sink is missing                    |
| **S-3** Load testing                                 | No capacity number should be quoted until this runs              |
| **S-7** Rehearsing the destructive-migration restore | Fold into the M-3 rehearsal                                      |

### ⚖️ Compliance and legal dependencies

| Item                                               | Owner          | Note                                                                                                              |
| -------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------- |
| **M-2** Sanctions feed registration                | **Compliance** | **Start first.** External timeline, and partner onboarding is blocked without it                                  |
| **S-4** Retention policy + what GDPR erasure means | **Compliance** | Append-only tables make a `DELETE` impossible; the answer is pseudonymisation, but the scope is a compliance call |
| **S-5** Terms, privacy policy, partner contract    | **Legal**      | Roadmap item 196                                                                                                  |

### 🤝 Vendor dependencies

| Item                                            | Note                                                             |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| **S-9** Independent penetration test            | Book early; testers have lead times. Needs a staging environment |
| **S-8** Malware scanning for uploaded documents | ClamAV sidecar or storage hook; needs hosting                    |
| **S-2** Partner notifications                   | Blocked on the WhatsApp BSP decision (item 192)                  |
| Maps billing account                            | Item 195; MapLibre + MapTiler recommended                        |

### 📦 Deferred product scope — deliberately not started

Bashar's instruction (2026-08-02): no product expansion until the must-haves have a plan.

| Item                                       | Note                                                                                                                                                                                                                                                                                   |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Messaging and disputes**                 | The largest gap. SRS §4 defines a support agent as handling bookings, messages and disputes; only bookings exist. Permissions are assigned but there are no tables — which makes the platform look more capable than it is                                                             |
| Remaining 11 of the 18 §9.3 admin sections | The 7 built are those that block onboarding or administration. Since 2026-08-04 all eighteen appear in the sidebar — dimmed and `aria-disabled` when unbuilt — so the console shows how much is missing instead of hiding it                                                           |
| Payment rails and payouts (items 84, 135)  | Deferred by decision 2026-08-01                                                                                                                                                                                                                                                        |
| Gift cards and coupons (items 142–143)     | Compose onto the split-payment seam                                                                                                                                                                                                                                                    |
| UK, US and UN sanctions lists              | EU-only is deliberate; revisit before US/UK payments                                                                                                                                                                                                                                   |
| Emergency Mode (EC-009)                    | No operational need yet. The control is in the dashboard header, rendered DISABLED — in an emergency a button that looks armed and does nothing is worse than one visibly unavailable                                                                                                  |
| Arabic for the remaining console screens   | `/staff`, `/audit`, `/settings`, partner and property detail, enrol-2fa, invitation are still English. Copy belongs in `apps/admin/src/lib/strings.ts`; the pattern is established                                                                                                     |
| Design fidelity outside the dashboard      | The handoff (§4–§8) specifies far more than is built: the sticky 64px shell header, the light theme (§9.2), a search input on **every** admin table, partner contract upload (§8.1), the staff permission matrix (§8.2). Each is a separate piece of work; see the fidelity gaps below |
| A browsable bookings list                  | §9.4 is a lookup by the reference a customer reads out; an index of every booking is a privacy surface with no operational use. Consequence: the dashboard's SLA alert has no "handle" destination and its action is dimmed                                                            |

### Highest-risk item

**M-3, backups.** Not the most likely to bite — that is M-2 — but the only failure on
the list that is _unrecoverable_. Every other blocker fails loudly and reversibly: the
sanctions feed refuses, a wedged replica serves errors, a weak rate limit is an attack
you can detect. Data loss is silent until the moment you need the data, and this platform
is unusually exposed because the entire compliance story rests on records designed to be
impossible to reconstruct — the double-entry ledger, `audit_log`, `timeline_events`,
`settings_history`, all append-only by trigger precisely so they can serve as evidence.
That property is worth nothing if the database is gone.

### If you only do one thing

Choose the hosting provider, and start the sanctions registration the same day. The first
unblocks four items; the second is the only one whose clock you do not control.

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
`S3_ACCESS_KEY_ID` + `S3_BUCKET`. Both are deliberate; see §11.

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

**Status:** ✅ **Delivered 2026-08-02.** See §11.

### M-5 — Staff accounts can only be created with direct SQL

**Status:** ✅ **Delivered 2026-08-02.** See §11.

### M-6 — No health endpoint

**Status:** ✅ **Delivered 2026-08-02.** See §11.

---

## 5. Should-have before production

### O-i18n-1 — The staff console is Arabic-only, and its catalogue is ready for more

**What:** `messages/admin/ar.ts` is the only console locale; English and German are not written.

**Why it is not done:** deliberate. The console is Arabic-only by decision (Bashar, 2026-08-03),
and writing ~900 unreviewed English and German strings would produce a console that looks
translated and reads as machine output to the people who run the business on it.

**What unblocks it:** a decision that the console needs a second language, and a reviewer for the
translation.

**Effort when unblocked:** one file. `satisfies AdminMessages` makes the compiler enumerate every
missing key; registering it in `admin.ts` and changing one line in `apps/admin/src/lib/strings.ts`
completes it. Placeholder type-checking then hands over to the completeness tests —
`docs/i18n.md` §6.

### O-i18n-2 — The redaction mask cannot follow the reader's locale

**What:** `contentMessages().redactionMask` (`⟨محجوب⟩`) is written INTO the stored message body
when a phone number is removed, so a German customer reading a redacted thread sees Arabic.

**Why:** redaction happens on the way into the database, where "whose language" has no answer yet.
There is one stored string and three possible readers.

**What unblocks it:** a decision to store a marker token and substitute on read. The Arabic,
English and German masks are already written, so this becomes a rendering change rather than also
a translation one.

**Effort:** small — one substitution point in the message-rendering path, plus a decision about
already-stored bodies.

### O-resp-2 — Responsive and navigation audit, 2026-08-05

Measured before any implementation, so the plan below is evidence rather than a guess. **39 routes
× 7 breakpoints** (375 / 414 / 768 / 1024 / 1440 / 1920 / 2560 px) — every console section
including the four detail routes, plus the customer site in all three locales. Harness:
`e2e/responsive.spec.ts` is the permanent subset; the full sweep was a throwaway.

#### Clean

| Check                                  | Result                                                  |
| -------------------------------------- | ------------------------------------------------------- |
| Horizontal page scroll                 | **0 findings** across 39 routes × 7 widths              |
| Elements rendered outside the viewport | **0**, excluding deliberate `overflow-x-auto` scrollers |
| Primary navigation rendered            | present at every width in the console                   |

The zero-overflow result is the `:where(.grid, .flex, .inline-flex) > * { min-width: 0 }` rule
added 2026-08-05. Before it: 7 of 19 console sections overflowed at 375px and 3 still did at
1024px.

#### Findings — touch targets below 40px on handheld widths

117 raw findings, but only **13 distinct components** — the same chrome repeated across pages. The
smallest are the in-table links, which fail even WCAG 2.5.8's 24×24 minimum.

| Component                            | Measured          | Where                |
| ------------------------------------ | ----------------- | -------------------- |
| In-table reference link              | **104 × 19**      | every registry table |
| In-table action link ("فتح الملف ←") | **60 × 17**       | every registry table |
| Sidebar nav row                      | 297 × 36          | console shell        |
| Export CSV / Pager                   | 89 × 30, 113 × 30 | tables               |
| Search submit                        | 53 × 37           | table toolbar        |
| Theme toggle / Sign out              | 34 × 38, 111 × 38 | console header       |
| Status filter select                 | 104 × 39          | table toolbar        |
| Customer language links              | 48–69 × 30        | site header          |
| Customer sign-in link                | 81 × 30           | site header          |

Not a finding: the customer skip link measures 1 × 1 because it is `sr-only focus:not-sr-only` —
visually hidden until focused, which is correct.

#### Findings — the customer site's primary navigation is hidden on phones

`site-header.tsx` renders the main nav as `hidden … sm:flex`, so below 640px الرئيسية and
الإقامات disappear **with no alternative** — no menu, no drawer. A phone visitor can reach the
site's two primary destinations only by editing the URL. This is the one finding that makes a
surface unusable rather than merely awkward.

#### Findings — the console assumed a visible sidebar

No way to collapse it at any width, and below `lg` it stacked above the content until 2026-08-05.
Addressed by the hamburger work below.

#### Not addressed, and why

A phone-SHAPED console — card rows instead of tables, a bottom bar — remains a design decision
(see `O-resp-1`). The audit's standard is _usable at every size_, which is what the fixes deliver;
_designed for a phone_ is a different and larger question that needs a product answer about
whether staff work from phones at all.

### O-resp-1 — A phone-shaped console is a design decision, not a bug

**What:** the console no longer scrolls sideways at any width and content sits above the
navigation, so it is USABLE on a phone. It is not DESIGNED for one: wide registry tables scroll
horizontally inside their box rather than becoming cards, and the sidebar is a full-width list of
nineteen links rather than a collapsible menu.

**Why it is not done:** the design handoff is a desktop console and specifies no phone layout.
Inventing one — card rows, a drawer nav, a bottom bar — is a design decision with real
consequences for how staff work, not a mechanical fix.

**What unblocks it:** a decision about whether staff actually work from phones, and if so which
sections matter. Bookings and disputes triage are the plausible ones; the Rules Engine is not.

**Effort when unblocked:** medium per section. The floor — no horizontal scroll, content first —
is already in place and tested at four widths.

### S-1 — No error tracking, no metrics, no alerts

**Status:** blocked on M-1 · **Owner:** Platform engineering

**Prerequisite done (2026-08-02):** logs are now structured JSON on stdout, one object
per line, carrying `level`, `time`, `context`, `requestId` and `userId`, **plus one
access-log line per request** (method, path, status, duration) covering rejections and
404s as well as successes. Sensitive keys
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

### S-6 — `FIELD_ENCRYPTION_KEY` rotation

**Status:** ✅ **Delivered 2026-08-02.** See §11 and
[`runbooks/encryption-key-rotation.md`](runbooks/encryption-key-rotation.md).

### S-8 — Uploaded documents are not scanned for malware

**Status:** open · **Severity:** Medium · **Owner:** Platform engineering +
Compliance · **Dependency:** a scanning service (vendor/infrastructure decision)

**Rationale.** Partners upload identity documents, ownership proof and commercial
register extracts. The pipeline validates magic bytes, re-encodes images through sharp
(which strips EXIF and would fail on a malformed file), and passes PDFs through
verbatim. Nothing scans for malware.

**Impact.** The realistic victim is a **staff reviewer**, not the server: a malicious
PDF opened in the admin console attacks their machine. Downloads are served with
`Content-Disposition: attachment`, `X-Content-Type-Options: nosniff` and `no-store`,
so the browser will not render it inline — that reduces the risk but does not remove
it, because the reviewer's job is to open the file.

**Mitigation now in place:** magic-byte type detection, image re-encoding, attachment
disposition, per-request authorisation, and an audit row for every document read.

**Recommended next action:** a ClamAV sidecar or an object-storage scanning hook,
quarantining anything flagged and surfacing it in the review queue. Needs the hosting
decision (M-1) before it can be wired.

### S-9 — No independent penetration test

**Status:** open · **Severity:** High (assurance gap, not a known defect) ·
**Owner:** **Bashar** — needs a vendor · **Dependency:** M-1, a deployed environment

**Rationale.** Everything in §11 was reviewed and probed by the same party that wrote
it. That finds implementation errors; it does not reliably find design blind spots,
and it cannot be evidence of independence for a compliance conversation.

**Impact.** Unknown by definition. No finding here should be read as "the platform is
secure" — only as "these specific attacks were tried and did not work".

**Recommended next action:** commission an external test once a staging environment
exists, scoped to the customer app, the staff console and the API, with authenticated
testing at every role. Book it early; good testers have lead times.

### S-7 — Migration rollback strategy

**Status:** **documented 2026-08-03; still untested** · **Severity:** Medium ·
**Owner:** Platform engineering · **Dependency:** M-1 for the untested half

**Done.** Forward-only is now a stated decision rather than an accident, and the
rollback answer is explicit in `runbooks/deployment-requirements.md` §6: revert the
image for a non-destructive migration and leave the schema alone; restore to a point in
time only when the migration was destructive. That turns "is this destructive?" into a
review-time question, which is where it belongs.

**Not done, and not markable as solved:** none of it has been rehearsed, because there
is nowhere to rehearse it. Rehearsing the destructive path is part of M-3 — a restore
nobody has performed is not a recovery plan.

**Recommended next action:** fold the destructive-migration restore into the M-3 restore
rehearsal rather than treating it as separate work.

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
  believing one. The root cause is fixed — see §11 — but the habit is still the right
  one, because any suite whose teardown is interrupted can leave rows behind.
- **A `200` from a Next page proves almost nothing about the browser.** The HTML is
  server-rendered, so a page whose client-side JavaScript is entirely blocked still
  returns `200` with correct-looking markup. Two CSP regressions hid behind exactly that
  for a day. When changing anything that affects scripts, styles or headers, **count the
  script tags and check they carry the nonce** — see the resolved CSP entry in §11 for the
  method.
- **Bound a version-scoped pnpm override to its major.** `"brace-expansion@1":
">=1.1.18"` also matches 5.x, so pnpm resolved ESLint's dependency to brace-expansion 5
  and reintroduced the CJS-export incompatibility that had previously forced an audit
  exception. Use `">=1.1.18 <2"`. Observed 2026-08-03; see `AUDIT-EXCEPTIONS.md`.
- **`next build` must NOT inherit `NODE_ENV=development`.** Sourcing the local `.env`
  (which sets it, correctly, for running the apps) made `next build` fail while
  prerendering `/404` with "`<Html>` should not be imported outside of
  `pages/_document`" — an error that names nothing relevant. Both Next `build` scripts now
  force `NODE_ENV=production`, so the ambient value cannot break a production build.
  **`pnpm verify` does not catch this** — it only builds `packages/*`, so run a full
  `pnpm build` before trusting that the apps compile.
- **A row referenced by an append-only table can never be deleted.** `audit_log`,
  `settings_history`, `timeline_events`, `ledger_entries` and `wallet_transactions` are
  append-only by trigger and hold foreign keys to `users`, `settings` and `bookings`, so
  a user who has ever acted or a setting that has ever been edited is permanent. Use
  `deleted_at`. Test teardowns must not attempt a hard delete — three suites learned this
  the hard way. It is also why GDPR erasure needs a decision, not a `DELETE` (S-4).
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
- **A response schema that requires a field the API never sends fails SILENTLY.**
  `staffFetch` returns `'failed'` on any parse error, and the page then renders a generic
  "could not load this list". `pendingPropertySchema` required `status`, which
  `GET /admin/properties/pending` does not select — so the listing queue had been
  permanently broken and looked like a transient API failure. Nothing appeared in any log.
  **Write response schemas against a captured response, not against the columns you
  expect**, and keep the capture in a test — `apps/admin/src/lib/api.test.ts` is the
  pattern. Found and fixed 2026-08-04.
- **The e2e suite must not sign in per test.** `POST /auth/login` allows five calls a
  minute per IP and a two-step sign-in spends two, so a handful of extra sign-ins trips the
  limiter mid-run and every later test fails with "too many attempts" — which reads exactly
  like a broken login form. Tests behind the login replay a session captured once by the
  `setup` project (`e2e/auth.setup.ts`). This must be a setup PROJECT, not a `beforeAll`:
  Playwright restarts the worker after a failing test and re-runs file hooks, so a
  hook-based sign-in gets throttled on the retry and turns one real failure into a
  whole-suite cascade. Observed both ways on 2026-08-04; the run also went from 90s to 5.5s.
- **`pnpm build` regenerates `.next` under a running `next start`.** The running server
  then serves chunk names that no longer exist and the browser fails in ways that look like
  a regression in whatever was just changed. Stop the Next servers, build, then restart.
- **`AccessTokenClaims` is enumerated TWICE and both lists must be updated.** `issue()` lists every
  claim it signs and `verify()` lists every claim it reads back. A claim added to the interface and
  to `buildClaims` but not to `issue()` is resolved, discarded, and read as `undefined` — which is
  how staff-scope enforcement passed 26 unit tests and did nothing at all against a real token. The
  spread shortcut is deliberately absent (it would publish whatever happens to be on the object), so
  the two lists are the price. Found 2026-08-04 by decoding a live token.
- **Drizzle serialises a JS array as JSON, not a Postgres array literal.** `= ANY(${ids}::uuid[])`
  sends `["019f…","019f…"]` and Postgres answers `malformed array literal: "[" must introduce
explicitly-specified array dimensions`. Bind each element separately and join into `IN (…)` — which
  also keeps them parameters. No unit test can see this: the predicate is only serialised when it
  reaches a real driver. Found 2026-08-04; every scoped query was 500ing.
- **A BOM written as a literal character trips `no-irregular-whitespace`.** Use `\uFEFF`.
- **A default parameter value is a hardcoded string with an opt-out nobody takes.**
  `PasswordField` defaulted its toggle labels to `'Show password'` / `'Hide password'`, and four of
  five call sites never overrode it — so the button was English on the Arabic and German customer
  pages and in the Arabic-only console. The labels are now REQUIRED, which is what listed the four
  sites. A lint rule cannot see this: it is a default in a signature, not a literal in JSX.
- **`fill()`'s placeholder checking switched itself off silently.** TypeScript treats the VALUES as
  inference candidates for the template type, so one `string`-typed value widens it to `string` and
  the permissive branch accepts anything. It only appeared to work when tested with literal values.
  `NoInfer<S>` confines inference to the template. Found 2026-08-04 by deliberately misspelling a
  placeholder and watching the typecheck pass.
- **`\n` read out of a template literal as SOURCE TEXT is two characters.** Extracting the email
  copy re-escaped it, so every transactional email in every language shipped with a literal `\n`
  instead of paragraph breaks. Subject and link were both correct and no test rendered a body.
  Found 2026-08-04 by diffing rendered output against the previous implementation.
- **A custom exception subclass is invisible to a codemod over Nest's exception classes.**
  `SecondFactorRequiredException` extends `UnauthorizedException`, so a migration matching
  `new (BadRequest|NotFound|…)Exception` skipped it — leaving the one error where a missing code
  means nobody can sign in at all. `pnpm verify` was green; the browser suite caught it.
- **A `bigint` column reaches the driver as a STRING.** Postgres returns it that way to avoid
  silent precision loss, so `SELECT impressions` gives `"2860"` where a `z.number()` response schema
  expects `2860` — the parse fails and the whole screen renders "could not load this list". Cast to
  text in SQL and coerce with `Number()` (exact to 2^53, nine orders of magnitude beyond any counter
  this platform holds). Found 2026-08-04 on the ads screen.
- **A redaction test that asserts "a mask appeared" proves almost nothing.** The contact-detail
  blocker stored `ahmad@x.com` as `ahmad@⟨محجوب⟩` for a while: the URL pattern ate the domain before
  the email pattern saw it, so a mask WAS present and the count DID rise, and the test passed while
  the local part leaked. Assert the original substring is **wholly absent**. Found by probing the
  live endpoint, not by the suite (2026-08-04).
- **Pattern order matters in redaction: email before URL.** The URL pattern matches bare domains, so
  running it first splits every email. See `apps/api/src/messaging/redaction.ts`.
- **A rolled-back transaction does NOT roll back a sequence.** Probing the new CHECK constraints
  consumed `ADS-000001` and `DSP-000001` inside transactions that were rolled back, so the seeded
  data starts at `ADS-000002`. Never hardcode a reference in a test or a script; read one back.
- **Backticks in a comment inside a `sql\`\``template terminate the string.** Recorded before, hit
twice more on 2026-08-04 in two different files. Use`--` SQL comments with no backticks inside a
  template literal. The error names a line far from the cause.
- **Local object storage must be running to test an upload.** `S3_ENDPOINT` points at
  `localhost:9000`; without a MinIO container the upload path fails with `ECONNREFUSED` behind a
  generic 500. `docker run -d --name safra-minio -p 9000:9000 -e MINIO_ROOT_USER=… minio/minio
server /data`, then create the `safra-media` bucket.
- **A `server-only` build failure is the guard working, not an obstacle.** A CLIENT component
  imported a formatting helper from `lib/console.ts`, which imports the API client — so session
  reading and access-token handling were on their way into the browser bundle. Next refused the
  build. The fix is to move the shared code, never to drop the `server-only` marker: pure
  formatters live in `apps/admin/src/lib/format.ts` and import nothing but strings and the locale
  constant. Found 2026-08-04.
- **A trailing ISO currency code reorders under RTL.** `3,000.00 USD` renders as `USD 3,000.00`,
  which reads as a label rather than a figure. Use `amount()` from `lib/format.ts`, which puts a
  symbol where the handoff puts it — `$3,000.00` for Latin currencies, `12,500 ل.س` for Arabic ones.
- **`super_admin` holds EVERY permission** — `SUPER_ADMIN` is `Object.values(PERMISSIONS)`. So any
  logic shaped "drop the permissions no staff role holds" is dead code, and any count of "how many
  roles can do X" is always at least one. A unit test written on the opposite assumption is what
  surfaced it (2026-08-04).
- **`fx_rates` is empty in dev, and that is deliberate.** The seed refuses to invent a rate — a
  hardcoded one goes stale and a wrong rate is worse than an absent one — and prints ACTION
  REQUIRED. Pricing then refuses to quote. The audit log holds ~1,900 `fx_rate.set` entries because
  the integration suite writes rates and cleans them up, while `audit_log` is append-only and keeps
  the trace. The geography screen now shows the missing rate in red, so an operator sees it too.
- **Arabic-Indic digits are wrong for this console.** The approved design uses Western
  digits throughout, and `٠` (Arabic-Indic zero) renders as a small raised dot — "٠ بغرامة
  شريك" reads as a stray bullet rather than as a zero. Every figure here is also reconciled
  against something outside the platform (a ledger, a bank statement, a sanctions file),
  none of which use them. Use `ARABIC_WESTERN_DIGITS` from `apps/admin/src/lib/numerals.ts`,
  which also pins the Gregorian calendar — an `ar` locale can otherwise resolve to
  Umm al-Qura and render a different year than the database holds.

---

## 8a. Design fidelity gaps — known, unstarted

Opened 2026-08-04 when the design handoff arrived. These are gaps between the handoff and
the codebase that are **known and deliberately not yet closed**, so nobody re-discovers them
as bugs. Each names what unblocks it.

| Gap                                                                    | Where                          | What it takes                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **The customer app still uses Cairo, not IBM Plex Sans Arabic** (§4.1) | `apps/web/src/app/layout.tsx`  | A one-line font swap, but it changes the metrics of every customer page — so it wants a visual pass over the public screens in the same commit, not a drive-by. The admin console was switched on 2026-08-04                                                                                                                                                 |
| **The customer app is missing half the tokens** (§9.1)                 | `apps/web/src/app/globals.css` | `bg2`, `line2`, `text2`, `faint2`, `barDim`, `star1/2`, the hero/band/voucher fills and all five `*A` triples are absent. Add as the screens that need them are built; adding all of them now would be unused CSS                                                                                                                                            |
| **The token block is duplicated between the two apps**                 | both `globals.css`             | This duplication is exactly what let the admin palette drift — it was eyeballed while the customer app already had the correct values. Extracting to a shared `packages/ui` CSS entry is the fix; the blocker is that the customer app has a light theme and the console is dark-only, so the shared file needs a theme-agnostic core plus per-app overrides |
| **No light theme in the console** (§9.2)                               | `apps/admin`                   | Deliberate: staff-only, always dark, and the public app owns the toggle. Reopen only if staff ask                                                                                                                                                                                                                                                            |
| **No sticky shell header in the console** (§4.2)                       | `apps/admin`                   | The design's admin panel sits inside the public shell (logo, nav, currency, language, theme, account). A staff console needs none of that nav, so the console has no header at all and the sidebar sticks at 24px rather than the design's 84px offset. Revisit if a language or theme toggle is wanted for staff                                            |
| **Not every admin table has a search input** (§8)                      | `apps/admin`                   | Specified for all of them. The dashboard's bookings panel has one; `/partners`, `/properties`, `/staff` and `/audit` do not. `/audit` has server-side filters instead, which is better at scale than a client substring match — reconcile before copying the pattern blindly                                                                                 |

---

## 9. Reference — where things live

| What                                       | Where                                       |
| ------------------------------------------ | ------------------------------------------- |
| Binding engineering rules                  | `.claude/CLAUDE.md`                         |
| Architecture decisions and their rationale | `.claude/memory/` (indexed in its README)   |
| Full roadmap, item by item                 | `ROADMAP.md`                                |
| Production-readiness narrative, 2026-08-02 | `docs/production-readiness.md`              |
| Sanctions feed activation procedure        | `docs/runbooks/sanctions-feed.md`           |
| **Design spec (authoritative, visual)**    | `~/Privat/design_handoff_safra/README.md`   |
| Design prototypes — read, do NOT port      | `~/Privat/design_handoff_safra/SAFRA*.html` |
| Staff console Arabic copy                  | `apps/admin/src/lib/strings.ts`             |
| Browser tests, and the shared sign-in      | `e2e/` (`pnpm e2e`, needs running servers)  |
| **This register**                          | `docs/FUTURE-WORK.md`                       |

---

## 10. Security review — 2026-08-02

A full pass over authentication, authorisation, injection, browser security, file
handling, secrets, logging, API surface, data integrity, containers, recovery and
tests. **Probed against a running system**, not read.

**This is a self-review.** It finds implementation errors; it is not independent
assurance and must not be quoted as such. See **S-9**.

### Verified sound — attacks attempted and defeated

Each row is a thing that was actually tried against a running instance.

| Attack                                              | Result                                                                |
| --------------------------------------------------- | --------------------------------------------------------------------- |
| Read another customer's booking                     | `404` — not `403`, which would confirm it exists                      |
| Cancel / partner-confirm another's booking          | `403`                                                                 |
| Reach any `/admin/*` route as a customer            | `403` on all five tried                                               |
| Reach `/partner/*` as a customer                    | `403`                                                                 |
| Set `role: super_admin` at registration             | `400`, unknown key rejected by `.strict()`                            |
| Set `permissionOverrides` at registration           | `400`                                                                 |
| Enumerate accounts via login                        | Identical message for known and unknown                               |
| Enumerate via password reset                        | `204` for both                                                        |
| CORS from `https://evil.example`                    | No `Access-Control-Allow-Origin` returned                             |
| Brute-force one account                             | `401`×5 then `429`; account locked even after clearing the IP counter |
| Replay a used refresh token                         | `401`, and the whole token family revoked                             |
| SQL injection via reference/query                   | Only 2 `sql.raw` calls exist, both on compile-time constants          |
| Path traversal on media                             | Allow-list pattern **and** a root-containment check                   |
| 5 MB / 200 KB request body                          | `413`                                                                 |
| Forge a log line via a newline in an email          | 0 forged lines — JSON serialisation escapes it                        |
| Delete verified webhook evidence                    | Refused by trigger: "This row is evidence"                            |
| Delete audit / ledger / timeline / settings history | Refused by trigger                                                    |
| Backdate a webhook's `created_at`                   | Refused by trigger                                                    |

Also confirmed: refresh cookie is `HttpOnly; SameSite=Strict; Path=/api/v1/auth` with
`Secure` gated on production; EXIF is stripped by re-encoding through sharp; document
reads are authorised per request and audited; unverified webhooks are recorded but
never processed (**0 of 1,208**); and `pnpm audit` reports **no known vulnerabilities at
any severity with no advisories suppressed**, on both the production and full dependency
trees (re-verified 2026-08-03 after retiring the last exception).

### Fixed during the review

| Finding                                           | Severity     | Fix                                                                             |
| ------------------------------------------------- | ------------ | ------------------------------------------------------------------------------- |
| Staff 2FA enforced in the console, not the API    | **Critical** | `StaffTwoFactorGuard` — declining to enrol was a way to opt out entirely        |
| Customer app had no Content-Security-Policy       | **High**     | Strict CSP, inline script admitted by hash not `unsafe-inline`                  |
| `FIELD_ENCRYPTION_KEY` could not be rotated       | **High**     | Two-key support + re-encryption; rotation performed end to end                  |
| Production could store ID documents on local disk | **High**     | Boot-time refusal                                                               |
| Unauthenticated unbounded table growth            | **Medium**   | Immutability narrowed to evidence; daily pruning                                |
| HSTS missing from both web apps                   | **Medium**   | Set in each app, not only at the edge                                           |
| `settings_history` was mutable                    | **Medium**   | Same append-only trigger as its siblings                                        |
| Booking timestamps rendered in server timezone    | **Medium**   | Explicit `AT TIME ZONE 'UTC'`                                                   |
| Wrong encryption key produced an opaque `500`     | **Medium**   | `503` + a log naming the variable                                               |
| Rate limits were per-process                      | **Medium**   | Redis-backed; measured 6-through-instead-of-3 before, 3 after                   |
| Every login logged a false audit warning          | **Low**      | Declared exempt — constant benign warnings train people to ignore the mechanism |

### Open, with severity

| #   | Finding                                   | Severity         | Blocked by                      |
| --- | ----------------------------------------- | ---------------- | ------------------------------- |
| S-9 | No independent penetration test           | High (assurance) | Vendor + a deployed environment |
| M-3 | No backups or tested restore              | High             | Hosting                         |
| S-1 | No alerting on security events            | High             | Hosting                         |
| S-8 | No malware scanning on uploads            | Medium           | Vendor + hosting                |
| S-4 | GDPR erasure conflicts with the audit log | Medium           | **Compliance decision**         |
| M-2 | Sanctions screening not activated         | Medium           | **Compliance registration**     |
| S-7 | No stated migration rollback strategy     | Medium           | M-1                             |
| S-5 | No legal review                           | Medium           | **Legal**                       |
| S-3 | Never load-tested                         | Medium           | Hosting                         |

### Honest statement of position

- **No known vulnerability class is currently shipped**, on the basis of this
  engineering self-review.
- **Every fixable issue found within the current scope has been fixed** and verified
  against a running system.
- **The remaining high-impact risks are external or operational**, not code: backups
  and restore, sanctions registration, legal and compliance review, malware scanning,
  production alerting, load testing, and independent penetration testing.
- **This is not a claim that the platform cannot be compromised.** That is not a
  provable property of any system, and nothing here should be quoted as if it were.

### Accepted risks

- **Rate limiting fails open when Redis is down.** Failing closed turns a cache outage
  into a total outage. Bounded, deliberate, and the reason S-1 lists Redis alerting.
- **Webhooks answer `200` to an invalid signature.** A `4xx` makes providers retry
  forever or disable the endpoint. Payloads are recorded and never acted on.
- ~~One dev-only dependency advisory~~ — **eliminated 2026-08-03.** A `brace-expansion`
  1.1.x patch was published, meeting the removal condition recorded when the risk was
  accepted. `pnpm audit` now reports zero vulnerabilities at any severity with **no
  suppressions at all**, on both the production and full trees.

---

## 11. Resolved

Kept because the reason something was blocked is often the reason it returns.

| Date       | Item                                                                                   | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-02 | Staff 2FA enforced in the console but not the API                                      | `AuthService.login` demanded a TOTP code only if the account already had one enabled, so never enrolling was a way to opt out entirely — verified live: a `support_agent` with `totp_enabled_at IS NULL` read booking detail on a password alone. Closed by `StaffTwoFactorGuard`, with narrow exemptions for enrolment, `/auth/me` and public routes.                                                                                                                                                                                                                     |
| 2026-08-02 | Production could store ID documents on local disk                                      | `StorageModule` fell back to `LocalDiskStorage` with only a warning. Now a boot-time refusal, matching the `SMTP_URL` guard.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-08-02 | `settings_history` was mutable                                                         | Its siblings were append-only by trigger; it was not. Same trigger applied, with a regression test verified to fail when the trigger is dropped.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-08-02 | Booking timestamps rendered in the server's timezone                                   | `column::text` formats in the session timezone; correct only because the container is `Etc/UTC`. Now explicit `AT TIME ZONE 'UTC'`.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-08-02 | Audit log unreadable without SQL access                                                | `/audit` console screen plus a filtered, keyset-paginated endpoint.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-08-02 | Settings editable only by hand (P-005)                                                 | Rules Engine screen with per-schema validation, history and audit in one transaction.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-08-02 | Booking detail and timeline (§9.4)                                                     | Built. Payments section present only for `PAYMENT_READ` holders — absent, not redacted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-08-02 | Auth token table and mail delivery                                                     | Shipped earlier; tracker entry closed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-08-02 | Password reset, email verification, guest-booking claiming                             | Shipped earlier with 24 integration tests; tracker entries closed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-08-04 | The listing review queue had NEVER loaded                                              | `pendingPropertySchema` required a `status` field that `GET /admin/properties/pending` does not select, so `staffFetch` returned `'failed'` on every response and the queue showed "could not load this list" permanently. Silent — no log, no error. Fixed and covered by `apps/admin/src/lib/api.test.ts`, which asserts against a captured response and was verified to fail when `status` is reintroduced. See the trap in §8.                                                                                                                                         |
| 2026-08-04 | The dashboard did not resemble the approved design                                     | Rebuilt from `SAFRA - موقع سفرة 29.07.html`: 220px sidebar with all eighteen §9.3 sections, KPI row, attention panel, latest bookings, revenue sparkline, partner queue, recent activity. Backed by a new `DashboardService` that answers the whole screen in one round trip. Unbuilt sections and Emergency Mode render disabled rather than as dead links.                                                                                                                                                                                                               |
| 2026-08-04 | The console showed raw English identifiers in Arabic                                   | Booking statuses, staff roles and audit actions were rendered as `pending_confirmation`, `super_admin`, `auth.login_succeeded`. All three now map through `apps/admin/src/lib/strings.ts`, falling back to the raw key rather than blank.                                                                                                                                                                                                                                                                                                                                  |
| 2026-08-04 | Seeded partner named after a sanctioned individual                                     | `PAR-000002` renamed to `Sham Hospitality Farms` / `مزارع الشام للضيافة` by `UPDATE` — 3,148 bookings reference it, so deletion was not an option. The sanctions test fixtures keep the real designation deliberately: per ADR 0002 the residual EU Syria designations ARE those figures, and the name-folding rule exists to match them.                                                                                                                                                                                                                                  |
| 2026-08-04 | The console palette was eyeballed, and wrong                                           | Every colour in `apps/admin/src/app/globals.css` had been sampled from a screenshot before the handoff arrived: `--card` was `#15132a` against the specified `#17142F`, `--field` two shades too light, `--text` a neutral grey where the design uses a warm cream, and `--ok` / `--bad` / `--warn` / `--sky` were Tailwind defaults rather than SAFRA's. Individually invisible; together a different product. Replaced verbatim from handoff §9.1 and verified by reading computed styles in the browser rather than by looking at it.                                   |
| 2026-08-04 | The console used the wrong UI font                                                     | Cairo, chosen as a guess before the handoff. §4.1 specifies IBM Plex Sans Arabic, which every spacing value in the handoff was measured against. Swapped for the console; the customer app has NOT been — see §8a.                                                                                                                                                                                                                                                                                                                                                         |
| 2026-08-04 | `text-good` / `bg-good` matched no token anywhere                                      | The colour token is `ok` in both the handoff and the customer app, but twelve console files and two customer files used `good`. Tailwind generates nothing for an undefined token, so those elements silently kept their inherited colour — including two success banners in the customer app. Renamed throughout.                                                                                                                                                                                                                                                         |
| 2026-08-04 | `pending_confirmation` was rendered in gold                                            | The handoff makes it an explicit rule: pending confirmation is purple (`--pend`), never gold. Gold is SAFRA's affirmative accent, and a paid booking still waiting on a partner is not good news.                                                                                                                                                                                                                                                                                                                                                                          |
| 2026-08-04 | The last 4 console sections had no tables                                              | `disputes` + `dispute_evidence`, `conversations` + `messages`, `notifications`, `advertisers` + `ad_campaigns` and `partner_contracts` created in one forward-only additive migration, with 6 enums, 2 sequences, 13 constraints and 3 permissions. Every constraint was probed against the live database to confirm it rejects the bad row. All 19 sections now render real data.                                                                                                                                                                                         |
| 2026-08-04 | Contact-detail redaction leaked the local part of an email                             | `ahmad@x.com` stored as `ahmad@⟨محجوب⟩`: the URL pattern matched the bare domain before the email pattern saw it. The test passed because it asserted only that a mask appeared and the count rose. Reordered email-before-URL; the test now asserts the original substring is wholly absent. Found by probing the live endpoint.                                                                                                                                                                                                                                          |
| 2026-08-04 | The ads screen could never load                                                        | `impressions` is `bigint`, which the driver returns as a string, against a `z.number()` schema. Same silent-parse-failure shape as the listing queue in the morning. Cast to text and coerced with `Number()`.                                                                                                                                                                                                                                                                                                                                                             |
| 2026-08-04 | A partner contract could never become active                                           | Every upload starts `awaiting_partner_signature` and nothing could move it, so `active` was unreachable and a whole branch of the status vocabulary was dead. Added the mark-signed action; replacing now supersedes an unsigned contract too, which it previously did not.                                                                                                                                                                                                                                                                                                |
| 2026-08-04 | The dashboard and the disputes section disagreed                                       | The dashboard KPI still said "the disputes feature does not exist" while `/disputes` showed six. Wired to the real count; a browser test now asserts the two screens agree, because two screens disagreeing is worse than either being wrong alone.                                                                                                                                                                                                                                                                                                                        |
| 2026-08-04 | Staff scope existed only as a design column (B-12)                                     | Implemented as an enforced server-side model on Bashar's decision: two modes (`none` / `read_only` outside scope), writes refused outside scope in both, 404 rather than 403 under `none` so absence leaks nothing, and the audit log explicitly exempt and verified byte-identical for a scoped member. Applied to 9 registries, all 8 dashboard counters, all 4 reports, the finance ledger and the export. 26 unit tests plus live two-mode verification. Rules in the gap report §4a.                                                                                  |
| 2026-08-04 | Scope enforcement was silently inert (found during B-12)                               | `issue()` enumerates the claims it signs and `scope` was missing, so a real token carried none and every guard defaulted to unrestricted — while 26 unit tests passed. Found by decoding a live token. See the trap in §8.                                                                                                                                                                                                                                                                                                                                                 |
| 2026-08-04 | Every scoped query returned 500 (found during B-12)                                    | `= ANY(${array}::uuid[])` — Drizzle sends a JS array as JSON and Postgres rejects it as a malformed array literal. Rewritten as individually-bound parameters. Invisible to unit tests by construction.                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-08-04 | Booking exports left no trace (B-13)                                                   | The export generated CSV in the web tier, which cannot write inside the API's transaction. Moved to `GET /admin/bookings/export`, which records `booking.exported` with the actor, the filters, the row count and whether scope narrowed the set — before the bytes leave, so an abandoned download still leaves a record. Immutable by the append-only trigger; verified by attempting an UPDATE.                                                                                                                                                                         |
| 2026-08-04 | Arabic and German customers were shown ENGLISH API errors                              | `auth-form.tsx` and `checkout-form.tsx` wrote the API's `message` straight into the field error under the input, so the screens where wording matters most ignored the locale. The API now answers with a stable `code` the client resolves against the reader's locale. Three browser tests assert the Arabic and German wording renders and that the English does not leak into either.                                                                                                                                                                                  |
| 2026-08-04 | Eleven staff-console screens were written entirely in English                          | The booking, property and partner detail pages plus eight components had no catalogue import at all — invisible to a scan for Arabic literals precisely because they contained no Arabic. Found by the `no-hardcoded-text` lint rule, which is why it exists. ~118 strings translated.                                                                                                                                                                                                                                                                                     |
| 2026-08-04 | The password show/hide toggle was English on four of five fields                       | `PasswordField` defaulted its labels; they are now required. See the trap in §8.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-08-04 | The customer app had no `amenities` catalogue at all                                   | `getTranslations('amenities')` named a namespace that does not exist — the catalogue calls the city-attribute list `attributes` — so all twelve amenity codes rendered raw (`air_conditioning`) in all three languages. Found by the next-intl `Messages` type augmentation, which had never been wired up.                                                                                                                                                                                                                                                                |
| 2026-08-04 | Upstream field errors never reached a customer's inputs                                | `callAuth` returns a field→code map and the route forwarded it unchanged, but the form checks `Array.isArray(errors)`. Every API-side field error was silently dropped and the form fell back to a status-based message.                                                                                                                                                                                                                                                                                                                                                   |
| 2026-08-04 | The staff console had no light theme                                                   | Recorded in the gap report as an accepted deviation; Bashar asked for the toggle. §9.2 implemented verbatim including the `*A` alpha triples — overriding only the `--color-*` set would have left every gold tint reading as the dark theme's over a white card. Seven browser tests, one of which runs under a light OS preference to prove the console stays dark until somebody presses the button.                                                                                                                                                                    |
| 2026-08-05 | The console was not responsive, and the title row had drifted                          | Bashar reported the date/role line sitting too far from the title on الشركاء and العقارات: the shell put it after the whole title block, which is as wide as its widest child, so a long subtitle pushed it across the header. The dashboard and the shell had each written their own header — they now share `ConsoleHeader`, so it cannot drift again. Measuring for the new responsive rule then found 7 of 19 sections scrolling sideways at 390px, caused by grid items defaulting to `min-width: auto`; one zero-specificity CSS rule per app fixed the whole class. |
| 2026-08-05 | The console assumed the sidebar was always visible, and controls were too small to tap | Audited first (see O-resp-2): 39 routes × 7 breakpoints found 13 distinct controls between 17px and 39px and the customer nav hidden below `sm`. The sidebar now collapses at any width with the choice persisted; the touch floor is CSS below `lg` rather than a convention. Re-audited to 0 findings. 25 new browser tests.                                                                                                                                                                                                                                             |
| 2026-08-04 | 12 of the 19 console sections did not exist                                            | Built against the design handoff: bookings, customers, payments, wallet, gift cards, coupons, geography, reports and Emergency Mode from scratch; partner/property registries, staff and audit rebuilt. Backed by 12 new keyset-paginated endpoints, each behind its narrowest permission and verified live against the running database.                                                                                                                                                                                                                                  |
| 2026-08-04 | A client component was importing a server-only module                                  | `setting-row.tsx` reached the API client — session reading, access tokens — through a formatting helper in `lib/console.ts`. `next build` refused, correctly. Pure formatters moved to `lib/format.ts`, which imports nothing but strings and the locale constant. See the trap in §8.                                                                                                                                                                                                                                                                                     |
| 2026-08-04 | The permission matrix filtered on a false belief                                       | It dropped "permissions no staff role holds", which can never happen: `SUPER_ADMIN` is `Object.values(PERMISSIONS)`. Dead code, found by a unit test written to confirm the filter and failing instead. Removed; the matrix now lists the full catalogue, which is also the more useful answer.                                                                                                                                                                                                                                                                            |
