# SAFRA — Future work, blockers and open decisions

> **This document is the authoritative resume point.** Opening it should be enough to
> recover full context and continue, without reading the rest of the repository first.
>
> **How to use it in a new session:** read §1 for where things stand, §3 for who must act
> on what, then §4–§9 for the item you are picking up, and §10 for the security position.

**Last updated:** 2026-08-25 — **the pagination bar's JSON screen, `O-sec-7` closed, and three
register claims that had outlived themselves.**
Bashar met a bare `{"message":"Unknown table or size."}` where a table should have been. The cause
was one word — the save endpoint read the literal `size` while five namespaced tables post
`queueSize`/`activitySize`/`vsize`/`scopeSize` — and sweeping for the SHAPE found seven routes
across all three apps that answered a body to a browser navigation, plus two bars on every
two-table screen that threw each other back to page one. See `O-cons-2`.

**`O-sec-7` is closed the same day.** A failed query's bound parameters reached **four** columns, not
the one the entry named, and 26 log sites across twenty files. One shared describer, applied
uniformly, with a sweep that holds the class. And three claims in this document were corrected
against the code rather than trusted: `O-sec-6` had been resolved for five days while still recorded
as open, the "last pushed" line had been wrong for three weeks, and §2 still required approval before
every commit.

**And a correction of a correction.** I reported `O-sec-6`'s session cap as having no test, on the
strength of grepping test files for the symbol names — the suite drives it through `issue()` and names
neither, so five existing cases were invisible to the search. **A grep for a symbol is not a search
for a behaviour.** Mutation testing then found the real gap: four of those five could not fail,
because every `created_at` ties inside one rollback transaction, so no assertion about WHICH session
was retired could bite. Retiring the NEWEST session — signing somebody out as they sign in — was
green.

**`O-api-2` closed the same day, and with it the last of the three.** Five refusals answered a
hand-written English sentence; two of the seven on the list needed nothing (one already fixed and
never struck off, one a decided exception). Two tests had to stop matching prose in order for the
prose to go. `pnpm verify` 2,949 (nothing skipped) · `pnpm e2e` 280.

**Previously, 2026-08-20 — the console audit, and the locally-honest half of blocker #10.**
Bashar asked for every page of the super admin console to be walked and made production-ready. Ten
findings, all fixed: an English 404 under RTL, 43 untranslated audit actions, all four notification
templates missing, 477 partners unreachable behind an unpaginated queue, a CSRF guard that answered
403 to every real browser on the runtime the containers run, and staff scope missing from the two
verification screens. **`pnpm e2e` now runs against that runtime** — it never had. See `O-ui-1` and
`O-sec-4`. `pnpm verify` 1,866 · `pnpm e2e` 250.

**Also 2026-08-20 — the locally-honest half of launch blocker #10 has been executed.**
Scenarios 2, 3 and 4 of `docs/load-testing.md` ran against `safra_load` at the documented volumes for
the first time: **fifteen defects, twelve fixed**, and no capacity figure produced or claimed. The
exclusion constraint held under real contention; the account lockout holds; `O-sec-1`'s bystander
property does not. Full record: `docs/load-test-results-2026-08-20.md`. New items needing a decision
from Bashar: **`O-sec-3`** (an attacked address cannot sign in) and the **`O-page-1` ceiling**.

**Then, later on 2026-08-20 — `O-sec-3`, `O-api-1` and `O-page-1` are all CLOSED.** Bashar approved
both changes and set both thresholds the same day. `AppExceptionFilter` answers a pool-acquisition
timeout with a coded 503 and a jittered `Retry-After`; a successful sign-in no longer spends the
per-IP ceiling and that ceiling is now **300 failed sign-ins a minute**, up from 40; the `page`
ceiling is **1,000**, down from 100,000. Two items came out of the work: `O-api-2` (seven refusals
still answer an English sentence with no code) and `O-sec-5` (the per-IP residual belongs at the
edge, and `M-1` now owns it). **One alerting rule must be edited before alerting is armed** —
signal 12 has to exclude `request.capacity`, or it pages for load.

**Previously, 2026-08-04 — the Super Admin console is complete against the design handoff.**
All 19 sections implemented and verified over three passes, with **no backend work outstanding**.
Staff scope is enforced server-side in both modes and booking exports are audited. The only
remaining gaps are externally blocked and neither is console work. Full gap analysis, the four
answers, the enforcement rules and all 17 documented deviations: **`docs/design-gap-report.md`**.
**Unblocked infrastructure work is otherwise complete.** From here the project waits on
external decisions; see §3 for who must act on what.
**Branch:** `main` (the only branch — see `.claude/CLAUDE.md` §5)
**Pushed:** `main` and `origin/main` are level. This line used to name a specific commit and a
count of unpushed ones, and it was wrong for three weeks — a number that has to be edited by hand
after every push is a number that will be stale by the next one. Run `git status -sb` instead.

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

## 1a. Launch blockers — the authoritative list

**Agreed with Bashar, 2026-08-08.** SAFRA is engineering-complete; these ten are what stand between
that and a launch. **Engineering-complete does not mean launch-ready**, and this list is the
difference.

**Amended 2026-08-20.** The ten are unchanged, and none of the work done since has added or removed
one. But "engineering-complete" is now carrying three unblocked items it did not have — `O-sec-7`,
`O-api-2` — so the phrase did what the note above §1a warns about: describing
planned SCOPE, not correctness. All three were found by a security pass rather than by a test,
which is the third time that has been the source (`O-ui-1`, `O-sec-4`, now these). None blocks a
launch; `O-sec-7` should not wait for one either.

**Classification of today's items:**

| Item       | Classification                                                      |
| ---------- | ------------------------------------------------------------------- |
| `O-sec-3`  | **Completed** — approved, built, ceiling set to 300                 |
| `O-api-1`  | **Completed** — approved, built                                     |
| `O-page-1` | **Completed** — ceiling set to 1,000                                |
| `O-sec-5`  | **External dependency** — needs an edge, so it needs `M-1`          |
| `O-api-2`  | **Closed 2026-08-25** — five codes; two of the seven needed nothing |
| `O-sec-7`  | **Closed 2026-08-25** — four columns, not one; see the entry        |
| `O-sec-6`  | **Closed 2026-08-20**, recorded as open here until 2026-08-25       |

| #   | Blocker                                            | Owner               | Gated by 1 |
| --- | -------------------------------------------------- | ------------------- | ---------- |
| 1   | Deployment target selection                        | Bashar              | —          |
| 2   | Backup implementation and a verified restore drill | Infrastructure      | yes        |
| 3   | Sanctions feed activation                          | Compliance + vendor | no         |
| 4   | Malware scanning for uploaded identity documents   | Bashar              | yes        |
| 5   | External penetration test                          | Bashar              | yes        |
| 6   | Retention / erasure policy reconciliation          | Legal               | no         |
| 7   | WhatsApp provider selection                        | Bashar              | no         |
| 8   | Fine-deduction policy decision                     | Bashar              | no         |
| 9   | Monitoring deployment and on-call ownership        | Infrastructure      | yes        |
| 10  | Load-testing execution and validation              | Engineering         | yes ¹      |

Full detail, ownership and specification pointers in **`docs/launch-readiness.md` §4**. Items 3, 6,
7 and 8 need no infrastructure and can start today.

**¹ Blocker 10 is partly discharged.** The capacity run still needs the deployment target and no
capacity figure has been produced. But the half `docs/load-testing.md` says is honest without
infrastructure — query plans and business invariants — was executed on 2026-08-20 for scenarios 2, 3
and 4, and found **fifteen defects, twelve now fixed**, including two uncapped full scans on console
request paths, a per-account rate limiter that could be bypassed and aimed with a forged header, and an
idempotency claim that stayed held for 24 hours after a failure. See
`docs/load-test-results-2026-08-20.md` and `S-3`. **It also produced one new item needing Bashar's
decision: `O-sec-3`** — an attacked egress address cannot sign in at all.

## 1b. Where the remaining work is written down

**Engineering is complete. Everything below this line is operational, and every item now has a
document that makes it executable without further discovery.**

| Document                               | What it settles                                                                                                            |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `docs/launch-readiness.md`             | The whole picture: components, risks, blockers, security, DR, monitoring, infrastructure, vendors, legal. **Start here.**  |
| `docs/alerting.md`                     | 16 signals with thresholds and severities; the 4 integration points; the one endpoint still to build                       |
| `docs/load-testing.md`                 | 6 scenarios, success criteria, production-shaped data volumes, k6, what to do when it fails                                |
| `docs/load-test-results-2026-08-20.md` | **Scenarios 2, 3 and 4 executed.** 15 defects, 12 fixed. The `O-page-1` curve. No capacity figure, and why                 |
| `docs/malware-scanning.md`             | Four options weighed; ClamAV sidecar recommended for identity documents only, with the reasoning for excluding photographs |
| `docs/media-integrity.md`              | What is closed, and the one invariant only a deployment can enforce                                                        |
| `docs/background-jobs-design.md`       | BullMQ: 5 queues, retries, dead letters, scheduler migration, backup implications, 6-phase rollout, ~14 days               |
| `docs/notifications.md`                | What is sent, to whom, and how to prove it                                                                                 |
| `docs/runbook-scheduled-jobs.md`       | On-call procedure for the two cron jobs                                                                                    |
| `docs/auth-rate-limiting.md`           | The throttling design and its honest residual                                                                              |

## 2. Standing decisions that constrain all future work

These are not open questions. They are settled, and changing one is a decision for
Bashar, not an implementation detail.

| Decision                                                          | Date           | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work directly on `main`; never branch                             | 2026-07-29     | No feature branches, no PR flow, never force-push                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Commit messages are exactly one line, typed prefix                | 2026-07-29     | No body, no `Co-Authored-By`, no tool footers                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Committing and pushing need no approval                           | **2026-08-24** | Standing grant from Bashar, in his words: "approves your commits and pushes from now on. You don't need to ask me again." It SUPERSEDES the previous row here, which required approval before every commit and every push. Everything the approval was gating still applies: `pnpm verify` before committing, commits split by concern, explicit paths because the index is shared, and a browser pass for a client-side change. Only Bashar can amend it. See `.claude/CLAUDE.md` §5 |
| Merchant of record: Safra Technologies GmbH (Germany)             | 2026-07-29     | ADR 0002                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Payment rails and payouts deferred to end of project              | 2026-08-01     | Items 84, 135                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Money settings carry a currency, plus `money.always_usd`          | 2026-08-01     | Toggle ON by default; ADR 0006                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ID documents: store, restrict access, defer retention policy      | 2026-08-01     | Retention is now item **S-4** below                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| FX management: `super_admin` only, with a toggle for finance      | 2026-08-01     | `rbac.finance_can_manage_fx`                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **No new product scope until must-haves M-1…M-6 have a plan**     | **2026-08-02** | Bashar, explicit                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **No user-facing text is hardcoded**                              | **2026-08-04** | Every word a person reads comes from `@safra/i18n`; enforced by `safra/no-hardcoded-text` in `pnpm lint`. See `docs/i18n.md`                                                                                                                                                                                                                                                                                                                                                          |
| **Every UI is responsive on every device**                        | **2026-08-05** | No page scrolls sideways at 390 / 768 / 1024 / 1440 px. Enforced by `e2e/responsive.spec.ts` and a zero-specificity `min-width: 0` rule in both apps' `globals.css`                                                                                                                                                                                                                                                                                                                   |
| **The console sidebar collapses at every size**                   | **2026-08-05** | Hamburger always available, choice persisted, content reclaims the space, nav still reachable. `e2e/sidebar.spec.ts`                                                                                                                                                                                                                                                                                                                                                                  |
| **Every table carries a numbered pagination bar**                 | **2026-08-05** | `TablePagination`: prev/next, a page-number input, the page count, a rows-per-page select, the total found — under the table. Console registries use `OFFSET` with a count capped at 10,000; everything customer-facing keeps keyset. Exception: geography's bounded reference tables, held by `geo-bounds.integration.test.ts`. `e2e/pagination.spec.ts`                                                                                                                             |
| The API answers with an error CODE, not a sentence                | **2026-08-04** | 154 codes in `@safra/contracts`. `message` is English for logs only and must never be displayed                                                                                                                                                                                                                                                                                                                                                                                       |
| Staff scope is ENFORCED server-side, two modes                    | **2026-08-04** | `none` \| `read_only` outside scope; writes refused in both. See gap report §4a                                                                                                                                                                                                                                                                                                                                                                                                       |
| **The audit log is never scoped**                                 | **2026-08-04** | Bashar: "a scoped audit log is not a trustworthy audit log"                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Violation fines are RECORDED, never deducted — pending a rule** | **2026-08-07** | Bashar, explicit. `partner_violations` records the fine; `partner_payouts.fine_amount` stays zero and nothing subtracts it. The subtraction already exists in the accrual (`net = gross − fine`) and is deliberately left unwired until the business rule is defined. The partner dashboard says «غرامة ١٠$ مسجَّلة», NOT the handoff's «خُصمت من المستحقات» — see D-fine-1                                                                                                           |
| **Auth throttling is keyed on IP + account, not IP alone**        | **2026-08-07** | Bashar, approved. One person behind carrier-grade NAT could lock out everyone sharing their egress address — a real problem for Syrian partners. Two limits now: ten a minute per (IP, account) and forty per IP on auth routes. The five-attempt account lockout is unchanged and is what bounds a distributed attack. See `account-tracker.ts`                                                                                                                                      |
| Every booking export writes an audit row                          | **2026-08-04** | who · when · filters · row count; immutable                                                                                                                                                                                                                                                                                                                                                                                                                                           |

---

## 3. Status at a glance — everything sorted by who must act

**As of 2026-08-03, engineering work that can be completed without an external decision
is COMPLETE.** From here the project is blocked only by decisions outside engineering,
unless a new defect is found. That is a statement about scope, not a claim of
perfection — §10 records the residual security risk honestly.

### ✅ Completed engineering (no further action)

| Item                                                                                                                                                                                                                                                                                                                                                                                        | Delivered     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| **M-4** Redis-backed rate limiting                                                                                                                                                                                                                                                                                                                                                          | 2026-08-02    |
| **M-5** Staff provisioning — bootstrap command + console invite flow                                                                                                                                                                                                                                                                                                                        | 2026-08-02    |
| **M-6** Liveness and readiness endpoints                                                                                                                                                                                                                                                                                                                                                    | 2026-08-02    |
| **S-6** Encryption key rotation with re-encryption                                                                                                                                                                                                                                                                                                                                          | 2026-08-02    |
| **M-1 (partial)** Container images for all three apps, deployment requirements                                                                                                                                                                                                                                                                                                              | 2026-08-02    |
| **S-1 (prerequisite)** Structured JSON logs, correlation ids, access log                                                                                                                                                                                                                                                                                                                    | 2026-08-02–03 |
| **S-7 (documented half)** Forward-only migration strategy and rollback answer                                                                                                                                                                                                                                                                                                               | 2026-08-03    |
| Staff console: dashboard, partner verification, listing review, booking detail, audit log, Rules Engine, staff admin                                                                                                                                                                                                                                                                        | 2026-08-02    |
| Security hardening — see §10 for the full list and evidence                                                                                                                                                                                                                                                                                                                                 | 2026-08-02–03 |
| Two-step staff sign-in (password, then authenticator code) + `PasswordField` show/hide rule                                                                                                                                                                                                                                                                                                 | 2026-08-03    |
| Playwright browser harness — 22 tests, the only ones that can see a client-side regression                                                                                                                                                                                                                                                                                                  | 2026-08-03–04 |
| Staff console Arabic/RTL: login, dashboard, partner queue, listing queue                                                                                                                                                                                                                                                                                                                    | 2026-08-03–04 |
| Dashboard rebuilt to the approved design, wired to a single-round-trip `/admin/dashboard`                                                                                                                                                                                                                                                                                                   | 2026-08-04    |
| Partner and listing queues promoted to their own sections (`/partners`, `/properties`)                                                                                                                                                                                                                                                                                                      | 2026-08-04    |
| **15 of the 19 design-handoff console sections** — registries, finance, promotions, geography, reports, Emergency Mode                                                                                                                                                                                                                                                                      | 2026-08-04    |
| 12 new keyset-paginated admin endpoints on `RegistriesController`, each behind its narrowest permission                                                                                                                                                                                                                                                                                     | 2026-08-04    |
| Emergency Mode (EC-009) end to end — activate with a required reason, deactivate, audited history                                                                                                                                                                                                                                                                                           | 2026-08-04    |
| The staff permission matrix, derived from `ROLE_PERMISSIONS` so it cannot drift from the guard                                                                                                                                                                                                                                                                                              | 2026-08-04    |
| Browser suite grown to 51 tests, covering every section plus search, paging and filtering                                                                                                                                                                                                                                                                                                   | 2026-08-04    |
| **Staff scope enforced server-side** (B-12) in both modes, across 9 registries, the dashboard, all reports, the finance ledger and the export — **but read `O-sec-13` before trusting the word "across": this completeness claim has been falsified twice, in `review.service.ts` (2026-08-20) and `partner-contract.service.ts` (2026-08-23), and no sweep has ever been run**             | 2026-08-04    |
| **Booking export audit** (B-13) — actor, filters and row count, immutable                                                                                                                                                                                                                                                                                                                   | 2026-08-04    |
| **`@safra/i18n`** — one package owning every catalogue: customer (ar/en/de), console (ar), email (ar/en/de), errors (ar/en/de), stored content (ar/en/de)                                                                                                                                                                                                                                   | 2026-08-04    |
| 154 error codes replacing 181 English exception messages, 40 Zod messages and 16 route-handler messages                                                                                                                                                                                                                                                                                     | 2026-08-04    |
| `no-hardcoded-text` ESLint rule, with its own tests                                                                                                                                                                                                                                                                                                                                         | 2026-08-04    |
| **Light/dark toggle in the staff console** — handoff §9.2 palette verbatim, opt-in (the console does not follow the OS), shared pre-paint script with the customer app                                                                                                                                                                                                                      | 2026-08-04    |
| **Responsive console** — 7 of 19 sections scrolled sideways at 390px and 3 at 1024px; now 0 at every width, with content above the nav on a phone                                                                                                                                                                                                                                           | 2026-08-05    |
| **Collapsible sidebar with a hamburger at all widths** — persisted preference applied pre-paint, drawer below `lg`, column above, Escape and backdrop dismiss, focus managed                                                                                                                                                                                                                | 2026-08-05    |
| Sign-out and the theme toggle moved to the foot of the sidebar — on a phone they wrapped below the title and read as two headers                                                                                                                                                                                                                                                            | 2026-08-05    |
| **Page-size control on all 14 paged registries**, and `/admin/staff` paginated — it returned every row (165 on dev), which rule 2 has forbidden since the start                                                                                                                                                                                                                             | 2026-08-05    |
| `/admin/staff/scopes` paginated too — it also returned all 165 rows, on every visit to الموظفون                                                                                                                                                                                                                                                                                             | 2026-08-05    |
| **Touch targets at a 40px floor below `lg`** across both apps, and the customer nav no longer hidden on phones                                                                                                                                                                                                                                                                              | 2026-08-05    |
| **Numbered pagination bar under every table** — page input, page count, rows-per-page select and total found; 15 service methods, 4 controllers and 14 pages moved from cursors to `OFFSET`, with the count capped at 10,000 so it stays bounded work. Totals verified against SQL. See O-page-1 for what it costs                                                                          | 2026-08-05    |
| The scope map on `/staff` gained its own bar under namespaced parameters — it silently showed only its first page, and two landmarks called "تنقّل بين الصفحات" were indistinguishable to a screen reader                                                                                                                                                                                   | 2026-08-05    |
| Browser suite grown to 130 tests, including 21 for the pagination bar and 3 that assert a customer reads errors in their own language                                                                                                                                                                                                                                                       | 2026-08-05    |
| **Property media, driven in a real browser** — `setInputFiles` through the multipart proxy and the whole pipeline. Found that `img-src` named no media host, so NO app could display a photograph; that the customer app allowed every HTTPS host as an image source; that a new image sorted into the middle of the gallery; and that the screen described the wrong way to choose a cover | 2026-08-08    |
| **Alt text in ar/en/de** — the API stored three and the manager edited one, so a non-Arabic visitor got `alt=""` on the field that exists for people who cannot see the picture                                                                                                                                                                                                             | 2026-08-08    |
| **تعديل and التقويم built** — the last two disabled partner screens; a published listing explains why structural edits are closed rather than showing a form whose submit is refused, and the calendar never offers «محجوز»                                                                                                                                                                 | 2026-08-08    |
| **Dashboard calendar covers the whole portfolio** — it drew one unit chosen by creation date, on the screen a partner opens every morning; now booked/closed/open per day, in thirty-one rows whatever the portfolio size                                                                                                                                                                   | 2026-08-08    |
| **Notifications for three events** (`S-2` closed) — partner told a booking is waiting with its deadline; partner told a review arrived; guest told the host replied. Every send recorded in `notifications`, which nothing had ever written to                                                                                                                                              | 2026-08-08    |
| **Seed fixture falsehoods removed** — a draft listing was carrying 5.0 stars from eight stays it could never have had, because bulk bookings and reviews were generated against listings that were never bookable                                                                                                                                                                           | 2026-08-08    |
| **16 of 22 integration suites roll back** — one connection, `BEGIN`/`ROLLBACK` per test, savepoints for nested transactions. Payout debris that no `afterAll` could ever remove is now zero                                                                                                                                                                                                 | 2026-08-08    |
| **Arabic plurals on CLDR categories** in the customer app — `=1`/`=2`/`other` put 11–99 in the plural where Arabic takes the singular, on the range a result count most often lands in                                                                                                                                                                                                      | 2026-08-08    |
| **18 of 22 integration suites roll back** — users, partners, properties and payouts added per run all fall to zero; four suites commit for reasons a transaction cannot solve, `now()` being the sharpest                                                                                                                                                                                   | 2026-08-08    |
| **Console pluralises through ICU** — the booking detail read «٤ ليلة»; both apps now share one mechanism and `Intl.PluralRules`                                                                                                                                                                                                                                                             | 2026-08-08    |
| **Media address checked at boot** — probes a key that cannot exist; 404 passes, 403 fails, reported on readiness and fatal under `MEDIA_REQUIRE_PUBLIC`                                                                                                                                                                                                                                     | 2026-08-08    |
| **Batch image upload and a units editor** — a gallery is filled in one go, sequentially so cover and order stay deterministic; every unit editable on one screen even after publication                                                                                                                                                                                                     | 2026-08-08    |
| **The seed refuses to describe something impossible** — five assertions at seed time, proven against the exact regression that cost an hour                                                                                                                                                                                                                                                 | 2026-08-08    |

### 🔬 Load testing — the half that needed no infrastructure is done

**2026-08-20.** Scenarios 2, 3 and 4 executed against production-shaped volumes. Twelve of fifteen
defects fixed; `pnpm verify` 1,836 green and `pnpm e2e` 244 green after them. What remains on blocker
#10 is the capacity run itself, which still needs the deployment target. Two items came out of it for
**Bashar**: `O-sec-3` and the `O-page-1` page ceiling. One for engineering: `O-api-1`. See `S-3`.

**Later the same day, all three were closed.** `O-api-1` is resolved by a global exception filter.
`O-sec-3` is implemented and its ceiling set to 300. `O-page-1`'s ceiling is set to 1,000. Nothing
from the load test is now waiting on a decision; what remains of blocker #10 is the capacity run
itself, which still needs the deployment target.

**Later still on 2026-08-20 — the partner joining process, and how partners sign in.** Bashar
accepted a partner and asked what to do next; the answer was that there was nothing to do, because
the invitation email pointed at a page that had never been built (`O-partner-8`). Built, and the
whole journey walked in a browser. He also asked for partner 2FA to become a code emailed at every
sign-in instead of an authenticator (`O-sec-9`) — done, with the 78 enrolled partners migrated
across. Accepting a fixture partner had also broken `db:testbed` permanently (`O-partner-9`).

**Four items came out of doing the work**, none of them a launch blocker and all of them found by
the security pass rather than by a test: `O-api-2`, `O-sec-5`, `O-sec-6`, and — the one worth
reading first — **`O-sec-7`**, a failed query's bound parameters reaching the logs, and in one place
a database column.

### 🏗 Hosting-dependent — waiting on roadmap item 193

Nothing here can start until a provider and region are chosen. **This one decision
unblocks four items and is the highest-leverage action available.**

| Item                                                 | Note                                                                                                                                                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M-1** Deploy pipeline                              | The image is built and verified; the pipeline needs the provider. **Also owns `O-sec-5`** — an edge rate-limit rule on `POST /auth/login`, which is the only place the shared-address residual of `O-sec-3` can be closed |
| **M-3** Backups + rehearsed restore                  | **Highest severity on the whole list** — see below                                                                                                                                                                        |
| **S-1** Error tracking, metrics, alerting            | Logs are ready to ingest; the sink is missing                                                                                                                                                                             |
| **S-3** Load testing                                 | No capacity number should be quoted until this runs                                                                                                                                                                       |
| **S-7** Rehearsing the destructive-migration restore | Fold into the M-3 rehearsal                                                                                                                                                                                               |

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

| Item                                      | Note                                                                                                                                                                                                                                                                                   |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Payment rails and payouts (items 84, 135) | Deferred by decision 2026-08-01                                                                                                                                                                                                                                                        |
| Gift cards and coupons (items 142–143)    | Compose onto the split-payment seam                                                                                                                                                                                                                                                    |
| UK, US and UN sanctions lists             | EU-only is deliberate; revisit before US/UK payments                                                                                                                                                                                                                                   |
| Emergency Mode (EC-009)                   | No operational need yet. The control is in the dashboard header, rendered DISABLED — in an emergency a button that looks armed and does nothing is worse than one visibly unavailable                                                                                                  |
| Arabic for the remaining console screens  | `/staff`, `/audit`, `/settings`, partner and property detail, enrol-2fa, invitation are still English. Copy belongs in `apps/admin/src/lib/strings.ts`; the pattern is established                                                                                                     |
| Design fidelity outside the dashboard     | The handoff (§4–§8) specifies far more than is built: the sticky 64px shell header, the light theme (§9.2), a search input on **every** admin table, partner contract upload (§8.1), the staff permission matrix (§8.2). Each is a separate piece of work; see the fidelity gaps below |

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

**Status:** open, **no longer a launch blocker** · **Owner:** **Compliance, not engineering**

**Downgraded 2026-08-21 (Bashar).** Partner verification used to be an unconditional hard
gate on sanctions screening, and the platform refuses to screen against a list older than
**7 days** (`MAX_SNAPSHOT_AGE_DAYS`) — so with no automated feed, onboarding stopped
entirely and an external registration held up launch.

The gate is now governed by `compliance.sanctions_screening`, **defaulted to `advisory`**:
screening runs and is recorded, and it blocks nothing. Set it to `required` to restore the
old behaviour on both partner approval and partner payout. Every approval stamps the policy
that was in force onto `partners.sanctions_policy_at_approval`, so an approval made without
a screening stays distinguishable, afterwards, from one where the control silently failed.

**The review that produced this, including what was verified and what still needs counsel:
[`sanctions-screening-review.md`](sanctions-screening-review.md).** Two findings from it
belong here:

- **The EU lifted its Syria economic sanctions on 29 May 2025**, keeping targeted
  designations for former-regime figures, chemical weapons and the captagon trade. A
  platform onboarding Syrian businesses is therefore where the residual list is _most_
  likely to bite, not least.
- Engineering recommended defaulting to `required`. `advisory` is Bashar's decision of
  2026-08-21, taken with that stated.

**Still open, and still worth doing:** the feed is what makes `required` usable at all, so
this stays on the list. It just no longer stops a launch.

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

### O-i18n-2 — Closed: the redaction mask now follows the reader

**Status:** FIXED 2026-08-14 · **Owner:** **Bashar** · **Recorded:** 2026-08-07

**What it was:** `contentMessages().redactionMask` (`⟨محجوب⟩`) was written INTO the stored message
body when a phone number was removed, because redaction happens on the way into the database where
"whose language" has no answer yet. One stored string, three possible readers — a German customer
opening a thread a Syrian partner had written read Arabic.

**What was built,** exactly the design this entry proposed: the row stores `REDACTION_TOKEN`
(`⟦…⟧`), and `renderRedactions(body, locale)` resolves it to the reader's own word at the point of
display. Six surfaces call it — the customer's support thread and disputes, the partner's thread,
the console's inbox, disputes and الاتصالات. Proven in a browser: one ticket carrying `0955123456`,
opened once, read back in all three locales, each showing its own mask with neither the token nor
the number recoverable.

**Four things worth not rediscovering.**

**The token is punctuation, and that is load-bearing.** `⟦…⟧` matches none of the redaction
patterns, which is what keeps `redactContactDetails` idempotent. It is also the fallback rendering:
a display path that forgets to call `renderRedactions` shows "something is missing here" in no
language rather than the wrong one.

**Old bodies are NOT migrated, and never will be.** `messages` is append-only — `deny_mutation`
raises on UPDATE — so `LEGACY_MASKS` is permanent, not transitional. Those rows are evidence in a
dispute, and rewriting them to render more nicely is what the append-only guarantee exists to
refuse.

**Stripping forged markers had to move OUT of the redactor.** A writer pasting the token would
otherwise have it rendered as a mask the platform never wrote. Stripping inside
`redactContactDetails` broke its idempotence — on a second pass the marker in the text is our own,
so it un-redacted the message. Caught by the existing idempotence test. The strip lives in
`redactIncomingMessage`, which is what a service calls at the boundary, exactly once.

**The count is derived in SQL and had the old mask spelled out.** `dispute-request.service.ts`
recomputes "how many spans were removed" from the text rather than storing a counter that could
drift. It bound `'⟨محجوب⟩'` as a literal, so on the day the token arrived every dispute reported
zero and the notice silently stopped appearing — the text redacted correctly, the sentence saying
so gone. Now summed over `REDACTION_MARKERS` as bound parameters. **Caught by `pnpm e2e`, not by
any unit test**, which is the argument for running it.

**Tested:** 35 unit tests in `redaction.test.ts`, including the three-locale render, the legacy
mask, the forged marker, and the idempotence property that caught the mistake above.

### O-test-1 — `fx-rate.integration.test.ts`: cause identified and fixed 2026-08-11

**Status:** cause found, two real bugs fixed, suite migrated · **Owner:** **Bashar** ·
**Left open** until a month of green runs, because the original drift cannot be re-created on demand.

**What happened:** on 2026-08-05, and again during a `pnpm verify` on 2026-08-11, several FX tests
failed — `returns the rate once one is set`, `invalidates its cache on write`, `does not cache a
miss`, `audits the change`, and two listing tests — every one of them throwing the "no rate
configured" refusal **immediately after a rate had been set**. Never reproducible on a re-run.

**The cause, with high confidence.** `set()` stamped `effective_from` with `new Date().toISOString()`
— the APP process's clock — while `rateToSyp()` and `list()` filter `effective_from <= now()`, the
DATABASE's clock. Two clocks decide the two halves of one operation, so whenever the app's clock is
even a millisecond ahead of the database's, a rate is written future-dated and the very next read
refuses it. That is exactly the reported symptom, exactly those tests, and nothing else in the suite.

The intermittency fits too: PostgreSQL runs in Docker (`safra-pg`), so the comparison is a macOS host
clock against a Linux VM clock, and that pair drifts — most visibly after the host sleeps and resumes.
The earlier note that the failing run was "the only one made while all three app servers were live"
was a coincidence; the servers were never the second writer, as the entry itself suspected.

It is also no longer a guess: freezing `now()` inside a transaction reproduces the identical failure
**deterministically**, which is how it was found.

**What was fixed:**

1. **One clock decides both halves** — an omitted `effectiveFrom` is now stamped `now()` by the
   database itself, in the INSERT. An explicit date is still honoured verbatim, because scheduling or
   backdating a rate is a deliberate act. The audit row and the log record what was STORED rather
   than what was intended, since those differ whenever the default is used.
2. **A tiebreak, found while fixing the first** — two rates sharing one `effective_from` (an admin
   correcting a rate seconds later, or a bulk import stamping one moment) left the winner to the query
   planner, so a booking could be priced at either rate between two identical requests. Both queries
   now order by `effective_from DESC, id DESC`, and `uuidv7()` being time-ordered makes that "the one
   written last". `list()` carries the same tiebreak so the registry cannot disagree with pricing.
3. **The suite no longer commits** — moved from `createDatabase` to `createRollbackDatabase`. Its
   wholesale `DELETE FROM fx_rates` now happens inside a transaction that rolls back, and the
   `afterAll` that used to leave the table CLEARED for the whole machine is gone. Verified: a rate
   committed before the run is still there after it, and the suite passes either way.

Both bugs carry regression tests: `is in force immediately when no effective date is given` and
`prefers the last written rate when two share an effective moment`.

**A correction to this entry's own history.** An earlier version proposed scoping the cleanup with a
test marker and asserting on a comfortably-past `effective_from`. The second half would have made the
suite pass while leaving the production bug in place — the tests were right to fail, and a rate set
"now" being immediately in force is exactly the property worth keeping under test.

**Note for the dev environment:** nothing seeds `fx_rates` — neither `db:seed` nor `db:testbed`, both
deliberately, since a hardcoded rate goes stale and a wrong rate is worse than a missing one. A
USD→SYP rate of 13000.00 was inserted manually on 2026-08-11 so the local app can price bookings.
Delete it to get the "no rate configured" behaviour back.

### O-test-2 — The browser suite runs at the API's rate-limit ceiling

**What was found (2026-08-10, adding `partner-sidebar.spec.ts`):** the API's `default` throttler
allows **120 requests a minute per IP** (`app.module.ts`), and `pnpm e2e` is one IP driving every
app. A full run already produces around **500 `429`s** — 343 on `GET /admin/attention` and 157 on
`GET /admin/me/preferences` — and passes anyway, because both degrade gracefully by design: "a
failed preference read is not an error".

**Why that matters to the next person adding a spec.** Not every 429 is absorbed. `partner.spec.ts`
sorts last among the partner specs and so inherits the emptiest budget in the run; when
`GET /partner/me` is throttled, لوحة الشريك renders with an empty business name and that spec's
first assertion fails. The first draft of `partner-sidebar.spec.ts` — twenty tests, thirty-odd
navigations — did exactly that, and the failure appeared in the file the change had just touched,
pointing at markup that was correct.

**First the suite was bent, and it was not enough.** `partner-sidebar.spec.ts` and
`partner-calendars.spec.ts` group their assertions by the page load they share and sweep viewport
widths by resizing rather than reloading — both carry comments saying why. That halved their cost and
still left `partner.spec.ts` red. Retrying makes it worse, not better: the window is sliding, so a
reload-until-it-works loop keeps re-filling the thing it is waiting to drain. Four consecutive runs
demonstrated it.

**Resolved 2026-08-10 by making the per-IP ceiling configuration, not a literal.**
`THROTTLE_DEFAULT_LIMIT` (`apps/api/src/config/env.ts`, schema-validated, default **120**) is set to
1200 in the git-ignored local `.env` only. Production sets nothing and keeps 120. Result: the ~500
spurious `429`s are gone and the suite is green at 198 tests.

**What was deliberately NOT touched, and how that is proven.** The `account` throttler — ten a minute
per (person, network) on every route that names an email — is still a literal in `app.module.ts` with
no variable, as is the five-attempt lockout in `AuthService`. Those are the credential-stuffing
controls, and O-sec-1 is why they are keyed the way they are. The evidence that they still fire is in
the same run: `POST /auth/login` took **6 × 429** with the new ceiling in place, which is
`auth-throttle.spec.ts` doing its job. If a future change makes that count zero, the guard has been
weakened and that spec should fail.

**Still worth doing on its own merits:** the console's `attention` and `me/preferences` reads are what
generated most of those ~500 rejections — 343 and 157 respectively, one pair per section render.
Caching them would remove that traffic for real rather than raising the ceiling over it, and at 1M
users it is a production concern rather than a test one.

**Owner:** engineering — the caching item. The limiter question is closed.

### O-i18n-3 — Closed for the customer app: Arabic plurals use CLDR categories

**Closed 2026-08-08 for `apps/web`.** Every count-bearing message in the customer catalogue now
selects on the CLDR plural category rather than on an exact value.

**What was actually wrong.** Several messages already used ICU, with `=1`, `=2` and `other`. That
looks complete and is not: Arabic has six categories and the boundaries are not where an English
speaker puts them.

- 3–10 is `few`, and takes the broken plural — «٥ ضيوف».
- **11–99 is `many`, and takes the SINGULAR** — «١٥ ضيفًا», never «١٥ ضيوف».
- 100 and above is `other`, singular again.

With only `=1`/`=2`/`other`, everything from three upward fell into one case, so either 3–10 or
11–99 had to be wrong. It was 11–99 — the range a real result count lands in most often. Four more
messages had no plural at all and simply carried one hard-coded form.

**Pinned by two tests that can see the difference.** `plurals.test.ts` renders each message through
`IntlMessageFormat` — the same formatter `next-intl` uses — at 1, 2, 3, 15 and 100, and asserts five
DISTINCT strings; a collapsed category shows up as a duplicate. A second test fails any Arabic plural
that omits `few` or `many`, which is exactly the shape produced by translating the English string
instead of the meaning.

**And one in a browser,** because the unit test cannot see the failure that matters most: a component
that formats the count to Arabic-Indic digits BEFORE handing it to `t()` makes every message fall to
`other` silently, since `Intl.PluralRules` has nothing numeric to classify. Every category still
exists, every unit test still passes, and every reader sees the singular.

**Still open — the STAFF CONSOLE.** `apps/admin` builds copy with `fill()`, a placeholder substituter
that deliberately does not know plural rules; teaching it would make it a small translation library.
The booking detail's «{nights} ليلة» is still wrong for four nights. The fix is to move the console
onto the same message loader as the customer app, which is `O-i18n-1`'s work and waits for the
console to gain a second language. It reads as clumsy rather than as wrong information, and the
console is staff-only. **Owner:** engineering, alongside `O-i18n-1`.

### O-i18n-5 — Closed: the last four unblocked engineering items

**Closed 2026-08-08**, all four verified against a running system.

**The console pluralises.** `plural()` in `apps/admin/src/lib/strings.ts` renders an ICU message
through `IntlMessageFormat` — the same formatter the customer app uses — so the console and the
customer site now share one mechanism and one set of rules. Nine messages converted, including the
booking detail's «{nights} ليلة», which read «٤ ليلة» on a screen an operator uses all day.

`fill()` is untouched and still substitutes placeholders; teaching IT plural rules would have made a
small translation library out of a string helper, which is why `O-i18n-3` deferred this. Counts are
typed as NUMBERS at every call site: passing `count(n)` would leave `Intl.PluralRules` nothing to
classify, every message would resolve to `other`, and every test would stay green.

Two browser tests had to change, and both were asserting the bug: the pagination bar's total was
pinned to «نتيجة» whichever count it showed, and its empty state expected "0 نتيجة" where Arabic has
a `zero` category and now says «لا نتائج».

**The media address is checked at boot.** `MediaReachabilityService` fetches a key that cannot exist
and reads the status — 404 means the store answered and the bucket is readable, 403 means it is not,
anything else means the host is wrong. Probing a MISSING key means this works on an empty bucket and
on a fresh deployment, which is when a misconfiguration is cheapest to fix. Verified both ways
against a live bucket: removing the policy produced `media: unreadable` on `/health/ready` plus a
startup error naming the remedy.

It warns by default and reports on readiness rather than refusing to boot, because media is not on
the booking or payment path and a slow CDN should not become an outage. `MEDIA_REQUIRE_PUBLIC=true`
makes it fatal, and `.env.example` sets it — that is the right setting once infrastructure owns the
bucket, where a failing probe means somebody changed the policy.

**Images upload in a batch.** The manager takes a multi-file selection and sends them ONE AT A TIME:
each upload is six sharp variants, the endpoint's throttle is twenty a minute because the work is
heavy, and — decisively — the first-image-becomes-cover and append-after-the-last rules are computed
from the rows that exist when the request arrives. Parallel uploads race and the resulting order is
whatever the event loop decided. A partial failure reports how many landed rather than rolling back
seven photographs the partner would have to pick again.

**Units are edited on one screen.** Every unit of a listing, each saved separately — one price change
must not re-send five other units' fields, and a single validation failure must not reject work that
was already correct. Deliberately NOT gated behind `isStructurallyEditable`: a published listing's
address is frozen because §8.1 verified it, and its prices are not, because P-006 makes them the
partner's ongoing responsibility. Taking a unit off sale carries a warning that it is not a way to
close dates — a partner who blocks a fortnight that way has removed the unit from every future month.

**The seed refuses to describe something impossible.** `selfCheck` runs at the end of `db:testbed`
and throws on: an unpublished listing carrying a rating, an unpublished listing with bookings, a
published listing with no unit, a missing fixture that a browser spec names by slug, and a fixture
customer with no stay awaiting review. Proven by reintroducing the exact regression that took an hour
to find last week — it now fails the seed, by name, in one line.

Scoped to the seed's own listings: integration-test debris shares the database and follows a
`*-test-*` slug, and refusing to finish over rows the seed did not write is how a useful check gets
disabled.

**Owner:** engineering. Nothing remains in this group.

### O-i18n-4 — Closed: the console's English copy is in the catalogue, and a test keeps it there

**Closed 2026-08-07.** All ~40 strings moved to `packages/i18n/src/messages/admin/ar.ts` across
seven files — `screening-panel`, `review-property`, `verify-partner`, `document-review`,
`two-factor-enrolment`, `accept-invitation-form` and the property detail. Button labels,
client-side error messages and the «غير محدَّد» value label.

**And the sweep is now a test.** `apps/admin/src/lib/no-english-copy.test.ts` fails the build on
sentence-shaped English in any `.tsx` under `apps/admin/src`, comments excluded. It was verified to
fail — naming the file and the string — when one is reintroduced.

**Why a test rather than widening the lint rule.** `safra/no-hardcoded-text` visits JSX text,
user-facing attributes and exception messages. Every string this catches was a literal in an
EXPRESSION instead: a ternary inside `{…}`, a `Record<string, string>` lookup, a `setError(…)`
argument. The rule's own header explains why widening it to every literal would mean flagging
imports, class names and HTTP headers. A test can afford a heuristic and an explicit allow-list;
a lint rule that cries wolf gets switched off.

**The remaining exception**, and it is small: the allow-list holds four entries — `Content-Type`,
`application/json`, `Not signed in.` (a proxy's own 401 body, never rendered) and `Desktop Chrome`.
Each is exempt for a stated reason.

### O-sec-2 — Closed: registration no longer reveals whether an address is registered

**Closed 2026-08-08**, on Bashar's instruction, after it was flagged as the remaining oracle when
`O-sec-1` closed the lockout one.

**What it was.** `POST /auth/register` answered `409 auth.email_taken`. One request, no side
effects, a definitive answer — cheaper than the lockout oracle, which at least cost five requests
and denied somebody service. It was a documented, deliberate trade: "a signup form reveals this by
design, so hiding it buys no privacy". The first half is only true if the form must REFUSE, and it
does not have to.

**What it is now.** `202 { ok: true }` for every address. The difference moves into the inbox: a
new address gets a verification link, a taken one gets "you already have an account, here is how to
sign in or reset" — plain links, no token, nothing changed on the account, so a stranger triggering
it achieves nothing but sending somebody an email.

**The cost, accepted:** registration no longer signs the customer straight in, because an identical
response for a taken address cannot carry a session — that would sign the caller in as somebody
else. Both paths end at «تحقّق من بريدك الإلكتروني». One extra step, in exchange for the endpoint no
longer answering "does this person have an account".

**Audited either way, with different actions.** `auth.registered` and
`auth.register_existing_email`. The caller learns nothing; §15 still records what happened, and a
burst of the second against many addresses from one source is a defeated enumeration attempt that
is visible to whoever reads the log.

**Verified over real HTTP**: identical status, identical body, no `Set-Cookie` on either. Five
integration tests cover the four leak channels, including a spy proving the password is hashed on
BOTH paths — Argon2id dominates the endpoint, and hashing only when creating would have made the
timing difference roughly tenfold.

**Residual, named rather than papered over:** timing differs by ~1.5× (35 ms vs 52 ms) because the
create path does four inserts. Far weaker than a status code — it needs many samples and a stable
path — and bounded by the rate limits and the audit trail. `docs/auth-rate-limiting.md` records
what would close it fully and why that is not worth doing yet.

**A test this shook out.** The i18n completeness suite asserted every email body contains `{url}`
literally. `accountExists` carries TWO links, `{signInUrl}` and `{resetUrl}`, because "I already
have an account" and "I cannot remember my password" arrive together. The assertion now matches the
SHAPE of a URL placeholder, which is what it always meant.

### O-sec-1 — Closed: auth throttling no longer punishes a shared address

**Closed 2026-08-07**, on Bashar's approval.

**The problem.** `POST /auth/login` was throttled at ten a minute per IP. Carrier-grade NAT puts
thousands of Syrian subscribers behind one address, so one hotel's front desk retrying a typo
consumed the budget for every other partner on that carrier — and the symptom on somebody else's
FIRST attempt was «محاولات كثيرة», which reads as the product being broken. This project's own test
suite hit it repeatedly and worked around it with a sixty-second wait.

**The fix, and why the obvious version was wrong.** Keying on the email ALONE would have solved the
NAT problem and introduced a worse one: anybody who knows an address could spend that account's
budget from anywhere and keep the owner locked out — a targeted denial of service available to a
stranger. The key is IP **and** a hash of the email, so each (person, network) pair has its own
budget. Neither can starve the other.

**What still stops credential stuffing**, because the rate limit is now more permissive:

1. **A per-IP ceiling stays on every auth route**, at forty a minute — loose enough for a NAT'd
   office signing in at the start of a shift, tight enough to bound an attacker cycling addresses
   from one host, which is the shape of a stuffing run.
2. **The five-attempt account lockout is untouched.** It is enforced against the USER ROW in
   `AuthService`, not against a counter in Redis, so it does not care where attempts came from —
   which is what bounds a distributed attack. It had no dedicated test; it has seven now.

**The email is hashed into the key.** Redis keys turn up in `MONITOR` output and in whatever a host
captures; an address is personal data and the counter has no use for a readable one.

**Verified against the running API**, and both properties are now e2e tests: account A throttled at
ten while account B on the same address is still served, and a 45-request stuffing run across 45
different accounts from one address stopped at forty.

**And it uncovered an enumeration oracle, now closed.** `auth.locked` was returned BEFORE the
password was checked, so five wrong guesses locked a real account and a sixth confirmed it existed
— while an unregistered address answered the generic message forever. Six requests to confirm
anybody's registration. Raising the IP ceiling would have made that roughly four times faster from
one host, so rather than narrow the ceiling back and reintroduce the NAT problem, the password is
now verified FIRST: `auth.locked` requires knowing it, which is exactly the legitimate user who
needs to hear it. Verified live — a locked real account and an address that never existed both
answer `401 auth.credentials_invalid`. Net enumeration risk is LOWER than before the change.

**The full design and its rationale are in `docs/auth-rate-limiting.md`**, including what these
controls deliberately do not protect against.

**A side effect worth recording:** `e2e/partner.setup.ts` no longer needs its sixty-second wait —
`ops`, `partner1`, `partner3` and `customer` each have their own budget now. The suite is half a
minute faster and no longer competes with itself, for the same reason a NAT'd office no longer
competes with itself.

### O-data-1 — Closed: the append-only guarantee now survives TRUNCATE

**Closed 2026-08-07.** All seven tables — `audit_log`, `ledger_entries`, `timeline_events`,
`wallet_transactions`, `gift_card_transactions`, `settings_history` and `messages` — carry a
`BEFORE TRUNCATE` statement trigger alongside the row-level one. PostgreSQL does not fire row
triggers on TRUNCATE, so until now every one of them could be emptied by anyone with table
privileges, with no error and no trace.

**Probed live, and the probe found a miss.** The first version added the trigger inside the
`FOREACH` loop, which covers six tables — `messages` gets its trigger from a separate statement
because it arrived with the messaging tables in a later pass, and was left as the ONE table still
truncatable. Caught by running the probe rather than by reading the loop.

**The cost, accepted deliberately.** `db:reset-dev` and `db:testbed` legitimately clear these on a
development machine, and both now suspend the triggers explicitly with `ALTER TABLE … DISABLE
TRIGGER USER` inside their transaction, then restore them. That is the improvement, not the price:
clearing history is a thing somebody wrote down rather than an accident of which statement they
happened to use. `assertTriggersIntact` at the end of the reset proves they came back, and the full
reset → seed cycle was run to confirm it.

**A second thing this shook out.** The reset's unlisted-table check — added on 2026-08-06 after
`partner_payouts` was missed — caught `scheduled_job_runs`, which had been added hours earlier and
not registered. The guard doing its job on the person who wrote it.

### O-data-2 — Closed for every suite that can roll back: 18 of 22

**2026-08-08.** `createRollbackDatabase` in `@safra/db` gives a suite one dedicated connection, a
real `BEGIN` before each test and a real `ROLLBACK` after it. Eighteen of the twenty-two database
integration suites use it and leave **nothing** behind.

**Measured on the same database, one full `pnpm vitest run`:**

| Rows added per run  | Before | After |
| ------------------- | ------ | ----- |
| users               | ~100   | **0** |
| partners            | ~37    | **0** |
| properties          | dozens | **0** |
| **partner_payouts** | 66     | **0** |
| bookings            | ~40    | 30    |
| audit_log           | ~60    | 23    |

The payout number mattered most: `deny_paid_payout_mutation` refuses to delete a paid payout —
correctly, it records money that left the company — so that debris was PERMANENT, no `afterAll`
could ever have removed it, and it had already blocked `db:testbed`.

**Why the wrapper is on the CONNECTION.** Every drizzle path — `execute`, the query builders,
`db.query.*`, its own `transaction()` — bottoms out in one `client.query`. Wrapping there covers the
SERVICES, which hold a `Database` and open transactions internally where no test-side discipline
reaches. A nested `BEGIN` becomes `SAVEPOINT`, `COMMIT` becomes `RELEASE`, `ROLLBACK` becomes
`ROLLBACK TO`; drizzle's OWN savepoints pass through untouched, and every ordinary statement gets a
savepoint of its own so a deliberately provoked constraint violation stays local instead of poisoning
the transaction.

**Append-only guarantees are untouched.** Real triggers, real constraints, real indexes; a test that
violates an append-only rule is still refused by the rule. Only durability is removed.

**FOUR suites still commit, and each for a reason a transaction cannot solve:**

| Suite      | Why                                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `job-run`  | Two SESSIONS contending for an advisory lock — a lock is held by a session, not a txn                                                             |
| `wallet`   | Concurrent movements racing; the harness serialises statements, removing the at-once                                                              |
| `payments` | Webhook redelivery and idempotency under concurrency, same reason                                                                                 |
| `fx-rate`  | **`now()` is transaction START time** — a rate inserted after `BEGIN` is invisible to its own transaction, so the suite cannot see what it writes |

The `fx-rate` reason is the one worth remembering when writing a new suite: anything comparing a
database `now()` against a timestamp generated in JS during the test cannot run inside one
transaction. They account for the 30 bookings and 23 audit rows a run still adds.

**Owner:** engineering, and no longer costing an afternoon every few weeks.

### O-partner-1 — Reviews, shipped; the sidebar badge and the customer form remain

**Shipped 2026-08-07.** §7.3 exists end to end: schema, API, partner UI, staff moderation, and
P-006 enforced by the database rather than by a code path.

**P-006 is a property of the TABLE.** _"لا يمكن حذف تقييم — يمكنك الرد عليه أو الإبلاغ عنه"_. A
trigger refuses `DELETE` outright and a second freezes `rating` and `body` after insert, so the
rule survives a service somebody writes later, a migration, and a console with database access.
There is no `review.delete` permission and there never will be — a permission naming it would be a
promise the system cannot keep. Staff hold `review.moderate`, which HIDES, with an actor, a
timestamp and a required note.

**Why a review needs a completed booking.** `properties.rating` is the heaviest input to the
search ranking (`WEIGHTS.rating = 3.5`, "the strongest signal"), so an unearned review is a ranking
exploit rather than a rudeness. Three checks stand between a request and a rating change: the
booking must belong to the caller, it must be `completed`, and one review per booking is enforced
by a unique INDEX rather than by a service check that races with itself.

**The aggregate cannot drift.** `properties.rating` and `reviews_count` were documented as
"worker-maintained" while no worker existed. They are now recomputed by an `AFTER INSERT OR UPDATE`
trigger over PUBLISHED rows only — so a hidden review leaves the average and the ranking the
instant staff hide it, rather than carrying on working on a listing's position after it has been
taken off the page.

**Reporting is not removing**, and both screens say so. A partner who reports sees «بلاغك قيد
المراجعة … التقييم يبقى ظاهراً حتى يصدر القرار». Without that, a partner reports every review below
four stars and is angry twice.

**Ten constraints probed live** against the running database, all refusing: rating outside 1–5, an
empty body, two reviews on one booking, hidden with no moderator, a report with no reason, a reply
with no timestamp, DELETE, and edits to the body or the score. The aggregate was checked in both
directions in the same session.

**Tests.** 25 integration tests. `e2e/partner.spec.ts` asserts the rule is printed and that no
delete control exists — by ABSENCE, because a screen can state a policy and still ship the button
that contradicts it. `e2e/admin-sections.spec.ts` does the same for the staff queue.

**What remains:**

1. ~~**No customer-facing form.**~~ **Shipped 2026-08-07.** `/[locale]/review/[reference]` behind
   the account, with the prompt on `/account` listing exactly the stays `POST /reviews` would
   accept — so the invitation and the endpoint cannot disagree. `/review` joined `/account` in the
   middleware's `PROTECTED` list; a booking that is not yours answers 404, indistinguishably from
   one that does not exist, because references are sequential (§13.2). The whole lifecycle was
   verified against real data end to end: prompt → write → property rating 4.0 → 3.0 → partner
   sees it → partner reports (still published) → staff queue → uphold → hidden → rating back to
   4.0 → author still sees their own hidden review → row survives.
2. ~~**The sidebar badge.**~~ **Shipped 2026-08-07**, both of them.
3. **No notification** to a partner that a review arrived, or to a guest that a partner replied.
4. ~~**No public display.**~~ **Shipped 2026-08-08.** `/property/[slug]` shows the ten most recent
   PUBLISHED reviews, the partner's reply under each, and names the sample against the total so it
   is never mistaken for the whole. `status = 'published'` is in the API's WHERE clause rather than
   a filter afterwards, so a hidden review is never read out of the database. A visitor sees the
   guest's FIRST NAME and nothing else — a surname would make an ordinary opinion searchable
   against its author for ever, which the reader gains nothing from.

   **Two things this uncovered.** The seed declared `rating: '4.9', reviewsCount: 118` as literals,
   so `beit-al-yasmine` published «★ ٤٫٩ من ١١٨ تقييماً» with not one review behind it — a trigger
   has owned both columns since reviews shipped, and the fixture was overwriting it with a number
   nothing could explain. Removed; a property's rating is now whatever its reviews say, and one
   with none has none. And the seed cycled six review bodies across twenty-four reviews, so a probe
   searching the page for a review's words matched a DIFFERENT review — which read as "moderation
   does not remove it publicly" and cost an hour to disprove. Bodies are unique now, because a test
   that searches for a review has to mean what it says.

   **One accepted latency:** `/property/[slug]` caches for 60 seconds (`revalidate: 60`), so a
   review staff hide stays on the public page for up to a minute. The API is immediate. Bounded and
   defensible for a shop window; if an immediate takedown is ever needed the remedy is to unpublish
   the listing, which is not cached.

**Owner:** engineering.

### O-partner-2 — The payout ledger, read and operated

**Decided 2026-08-06 (Bashar): SAFRA operates a payout ledger.** The backend shipped in `a84a67d`;
the screens on both sides shipped 2026-08-07.

**What is DONE.** `partner_payouts` and `partner_payout_items`; the `accruing` → `pending_release`
→ `scheduled` → `paid` lifecycle with `on_hold` and `cancelled`; `PayoutService` covering accrue /
close / release / markPaid / hold / liftHold / cancel; eight database-level guarantees each probed
live; nine error codes in ar/en/de. `markPaid` is the only method that touches the ledger — it
posts DEBIT `partner_payable` / CREDIT `partner_payout` and stores the `entry_group_id`, which is
what makes the books and this table reconcilable in BOTH directions.

**And now the reads.** `GET /admin/payouts` is a paginated registry behind `PAYOUT_READ` — the
console could previously ACT on a payout but never see one, so every action route took an id an
operator had no way to obtain except by querying the database. `GET /admin/payouts/:reference`
returns the payout, the bookings it covers, the audit trail and the ledger movement together,
because "why was this partner sent this amount" is not answerable from any one of them.

**The screens.**

- **Console** — `/payouts` registry (status filter, search, `TablePagination`, reached from الدفع
  والفواتير rather than a twentieth sidebar section) and `/payouts/[reference]` with the four
  sections and the transition controls. The action route handler validates each action against ITS
  own schema and takes the action from an ALLOW-LIST, so a crafted URL cannot reach an arbitrary
  route under `/admin/payouts/:id/…`.
- **Portal** — `/payouts` and `/payouts/[reference]`, read-only and saying so. A partner cannot
  release their own transfer: `PAYOUT_EXECUTE` is a staff permission and the partner controller
  exposes no write at all.

**Two rules held throughout.** The dashboard line reads a ROW or renders nothing — proven by a test
that gives a partner a completed booking with money owed and asserts the line is still absent. And
the payout statuses joined `statusTone` with six distinct tones and six distinct Arabic labels,
both enforced by the existing per-vocabulary tests, so a status is one colour and one word here as
everywhere else.

**Verified end to end against the running API**: an accrual over real bookings, then close →
release → paid, producing a balanced movement (credit `partner_payout` 558.00, debit
`partner_payable` 558.00), a three-entry audit trail naming the actor, and three covered bookings.

**What remains:**

1. ~~**Accrual is invoked by hand.**~~ **Shipped 2026-08-07.** Hourly, behind a PostgreSQL
   advisory lock so exactly one replica runs it. The manual endpoint calls the same path, so a
   hand-run is recorded like any other — see `docs/runbook-scheduled-jobs.md`.
2. **No CSV export**, unlike the other finance registries.
3. **Fines are never attached.** `fine_amount` is on the table and every payout so far carries
   zero: `partner_violations` records a fine and nothing deducts it from the payout that covers the
   offending booking. Until that is wired, a partner with a violation is paid as though they had
   none, and the alerts panel says a fine «خُصمت من المستحقات» that in fact was not.

**Owner:** engineering. Item 3 is the one with money attached.

### D-fine-1 — What a fine actually does to a payout is undecided

**Status: a DECISION waiting on Bashar, not an engineering gap.** Held open deliberately on
2026-08-07: _"keep them recorded only for now, do not deduct them from payouts until we define the
exact business rule."_

**Where it stands.** `partner_violations` records the offence, the occurrence number, the fine
amount and the split between what compensates the customer and what SAFRA retains (§6.4).
`partner_payouts.fine_amount` exists and the accrual already computes `net_amount = gross_amount −
fine_amount`, enforced by a CHECK constraint. Nothing populates `fine_amount`, so every payout so
far nets to its gross.

**Why it was not simply wired.** The plumbing is one query; the rule is not. At least five
questions have to be answered before any deduction is correct, and each has a defensible answer
that contradicts the others:

1. **Which payout does a fine land on** — the one covering the offending booking, or the next open
   period? The offending booking may already be paid, and a paid payout is immutable.
2. **What if the fine exceeds the period's gross?** `net_amount >= 0` is a CHECK constraint, so a
   large fine against a quiet month cannot simply be subtracted; it has to carry forward, be
   capped, or become a debt outside the payout model.
3. **Does a waived fine reverse a deduction that already happened?** `waived_at` exists and a paid
   payout cannot be restated — so a waiver after payment needs a compensating movement, not an
   edit.
4. **Does the customer's compensation come out of the same amount?** §6.4 splits the fine; the
   ledger has to show both halves going to different places.
5. **When is the partner told?** A transfer that arrives smaller than the dashboard said is the
   complaint this whole feature exists to avoid.

**What was done instead, and it matters.** The dashboard's alert line said «غرامة ١٠$ خُصمت من
المستحقات» — the handoff's own wording, and a statement that the money had already been taken. It
now says «مسجَّلة» (recorded). Leaving the original would have had partners reconciling against a
deduction that never happened, which is the exact failure the payout ledger was built to prevent.
The wording returns to the handoff's the moment a deduction is real.

**Owner:** Bashar for the five questions above, then engineering. Not blocking anything else.

### O-ops-2 — FIXED: the payment-webhook alert could only ever be a false positive

**Status:** fixed 2026-08-13 · **Found:** by scraping `/internal/metrics` off the running dev API
while looking for something else

`safra_payment_events_unprocessed` counted every `payment_provider_events` row with
`processed_at IS NULL`. That reads as "waiting to be processed" and is not: a webhook whose signature
failed, or whose body would not parse, is stored deliberately for forensics as `event_type =
'unparsed'` and **can never be processed**. Those rows sit unprocessed for the thirty days until
`WebhookRetentionService` prunes them.

Alert 14 is severity **PAGE** with a 15-minute threshold. So the first malformed request any
environment received armed a page that could not be cleared for a month. The development database
was **8.8 days into exactly that**, reporting 219 events with the oldest at 761,811 seconds — and
every single one of the 219 was unsigned, meaning **the alert had never once had a true positive.**

**Fixed by splitting the question in two,** because both halves matter and they are not the same:

| Gauge                               | Means                               | Alert shape        |
| ----------------------------------- | ----------------------------------- | ------------------ |
| `safra_payment_events_unprocessed`  | Parseable, signed, not yet acted on | backlog AGE, page  |
| `safra_payment_events_rejected_24h` | Refused on arrival in the last day  | RATE, ticket (14b) |

A burst of rejections is a forged-signature attempt or a provider changing their payload format —
worth knowing, and not "a paid booking did not advance". After the fix the same database reports
`unprocessed 0`, `oldest 0`, `rejected_24h 40` (today's browser-suite runs).

**The data was NOT touched.** Giving rejected rows a terminal `processed_at` would have been the
tidier-looking fix and would have broken retention: `pruneUnverified` deletes on
`signature_verified = false AND processed_at IS NULL`, so they would never be pruned again.

**Guarded by four tests** in `metrics.integration.test.ts`, including one that asserts the two
predicates between them account for EVERY unprocessed row — an event invisible to both gauges would
be worse than the false positive this replaced.

**Also corrected in `docs/alerting.md`:** it listed `GET /internal/metrics` as "(to build)". It has
been built for some time. A readiness document that understates what exists is its own hazard.

### O-ops-1 — Scheduled jobs are visible; alerting is not

**Shipped 2026-08-07.** `payout-accrual` runs hourly and `ranking-recompute` nightly, both through
`JobRunService.runExclusively` — one advisory lock, one recorded run, released in a `finally`.

**Why a table and not just a log.** The failure that matters is not a job that threw; that lands in
the log and in the row's `error`. It is a job that STOPPED FIRING, and silence lands nowhere — six
weeks later somebody asks why no partner has been paid since March. `scheduled_job_runs` makes the
absence of runs queryable, which is the thing worth alerting on.

**Three decisions worth keeping:**

- **A skip is its own outcome**, not a failure. On a four-replica deployment three of every four
  ticks skip; a table showing only completions would make an operator believe the job runs a
  quarter as often as it does. Skips are also excluded from "latest", so a health check never reads
  the replicas that did nothing.
- **The manual endpoint shares the path.** `POST /admin/payouts/accrue` calls the scheduler, so a
  hand-run is recorded and takes the same lock — otherwise the console's footnote and the runbook's
  "run it again" step would disagree about whether anything happened.
- **Accrual accrues and stops.** It does not close, release or pay: those move money and §4.1
  requires a person holding `PAYOUT_EXECUTE` to decide each one.

**Visible where somebody looks**: the console's payout registry states when accrual last ran and
what it attached, and `GET /admin/jobs` (behind `audit_log.read`, not the public `/health`) answers
the same for every job. `docs/runbook-scheduled-jobs.md` is the on-call procedure.

**What remains:**

1. **No alert.** The data supports one — "last completed run older than two hours" — and there is
   no alerting anywhere in the project (see **S-1**). This is the prerequisite, not the thing.
2. **Still in-process.** §14 calls for a background queue; these are `@Cron` decorators inside the
   API with an advisory lock standing in for a scheduler. Retries, backoff and per-job concurrency
   arrive with BullMQ.
3. **No retention on `scheduled_job_runs`.** ~8,760 rows a year at one accrual an hour, so it can
   wait for the general retention work (**S-4**) rather than inventing a policy here.

**Owner:** engineering, after S-1 lands.

### O-media-1 — Property images are managed; a defect and two guarantees came with it

**Shipped 2026-08-07.** Upload existed and nothing else did — no list, no reorder, no cover change,
no alt text — so a partner could add photographs and never arrange them.

**The defect this uncovered.** Archiving the COVER did not promote another. `is_cover` was read in
the delete handler and never used, so a property kept its photographs while its card rendered «لا
صورة بعد» and every search result showed a placeholder. Fixed by promoting the next image by sort
order, in the same transaction, with a regression test.

**Two guarantees added at the database.** A partial unique index — one cover per property, over
LIVE rows only, so an archived image keeps its flag as a record of what the listing looked like at
the time. And `sort_order >= 0` plus positive dimensions, because the frontend divides by height to
hold the aspect ratio and a zero would be a division by zero in somebody's browser.

**Two rules the service enforces that the old handler did not.** A published listing keeps at least
one image — archiving the last one left a live listing rendering a placeholder to customers, and it
is now refused with the remedy named. And a reorder must name EXACTLY the property's live images: a
partial array is ambiguous about whether an omitted image goes last or was meant to be archived,
and guessing either way silently changes what a customer sees.

**Verified end to end** against the running API with a real JPEG carrying EXIF: upload, list,
reorder, set cover, alt text, archive-the-cover-and-promote, and a 404 for another partner. EXIF —
including GPS — is stripped as a side effect of re-encoding, confirmed directly rather than assumed.

**Closed 2026-08-08 — the browser test, and the four defects it found.** `e2e/partner-images.spec.ts`
drives the real pipeline: `setInputFiles` with actual JPEGs generated by sharp, through the client
component, the multipart proxy route, `FileInterceptor` and back. Upload, refusal, alt text in three
languages, reorder, cover selection and archive, each asserted after a RELOAD so a change that only
happened in React state fails. It found four things, none of which any existing test could see.

1. **Nothing could display a photograph. `img-src` did not name the media host.** The partner
   portal declared `img-src 'self' data: blob:` and the object store is a different origin, so every
   thumbnail was blocked by our own policy — in production as well as locally. The upload succeeded,
   the bytes were stored, the URL was right, and the browser refused to fetch it. A CSP violation
   appears in NO server log, and no test in the suite had ever looked at an image. `mediaOrigins()`
   in `@safra/session` now derives the origin from the configured media base and every app names it.
2. **The customer app allowed `img-src … https:`** — the whole internet as an image source, which
   is an exfiltration channel, not a convenience. Replaced with the named origin.
3. **A new photograph landed in the MIDDLE of the gallery.** The position was the live COUNT, and
   archiving does not renumber: one image left at position 2 with a count of 1 means the next upload
   claims position 1 and sorts ahead of it. Positions could also collide, with the tie broken by
   `created_at` — an order nothing on screen explains. Now `max(sort_order) + 1`, with a regression
   test proven to fail against the old code.
4. **The screen described the wrong mechanism.** The note said the first image in the order was the
   cover. It never was — the cover is a flag set by «اجعلها صورة الغلاف». A partner reordering to
   change what search results show would have watched nothing happen. The copy now says what the
   code does, and a browser test holds the two together.

**Closed 2026-08-08 — alt text in all three languages.** The manager edits `ar`, `en` and `de`, each
optional, saved together, each field carrying its own `dir` so Latin text is not bidi-reordered as
it is typed. An empty field is sent as ABSENT rather than `''`, so "no description" stays
distinguishable from "deliberately blank". The customer site is trilingual and an alt attribute is
chosen by the READER's locale; storing three and editing one meant an English or German visitor got
`alt=""` — the same as no description at all, on the field that exists for people who cannot see the
photograph.

**New, and NOT closed — nothing verifies that the media URL is reachable.** `publicUrl` composes an
address from configuration and hands it to the browser; whether that address serves the bytes
depends on the bucket policy and the CDN, which live outside this codebase. Three separate
misconfigurations were live at once here — a private bucket, a `NEXT_PUBLIC_MEDIA_URL` pointing at
the API's local-disk route while the API stored to S3, and the CSP — and the platform's only symptom
was blank tiles. `pnpm media:bootstrap` fixes the local bucket and `.env.example` documents the URL,
but a deployment can still be wrong in the same way, silently. **A startup check that fetches one
known object and refuses to boot on a 403 would turn all three into a failed deploy.** Owner:
engineering, alongside `S-1`.

**What remains:**

1. **No bulk upload.** One file at a time; §7.2's form draws three slots.
2. **The API's `urls` field and the apps' own URL builders are two sources for one address.**
   `coverUrl()` in the partner portal and `imageUrl()` in the customer app compose from
   `NEXT_PUBLIC_MEDIA_URL`, while `GET /partner/properties/:ref/images` returns `urls` composed from
   `S3_PUBLIC_URL`. They agree only because the configuration makes them agree. One of the two
   should go.

**Owner:** engineering.

### O-partner-5 — Closed: the two disabled partner screens are built

**Closed 2026-08-08.** عقاراتي offered تعديل and التقويم as greyed-out `<span aria-disabled>` labels
saying «لم يُبنَ هذا القسم بعد». Both backends already existed — `PATCH /partner/properties/:reference`
and `GET`/`PUT /partner/units/:id/calendar` — so what was missing was only the screen.

**تعديل, and the honest refusal.** A published listing CANNOT be structurally edited: §8.1 verified
the address, the photographs and the documents against each other, and letting the address change
afterwards would leave «موثّق» standing over a claim nobody checked. The screen does not show a
disabled form — it says why, and names what IS still editable (the calendar, the photographs), with
links. `isStructurallyEditable` is computed by the API next to the `update` that enforces the same
rule, so the screen and the endpoint cannot disagree about whether to offer a form; a UI that decided
for itself would eventually take somebody's work and then refuse the submit.

A REJECTED listing shows the reason it was rejected above a form that can fix it. Reopening the form
without the reason is asking somebody to guess.

**The form sends only what CHANGED.** A PATCH built from every input re-sends the whole record, which
turns "I fixed a typo in the address" into a write that also overwrites the English description with
whatever the form happened to hold — including an empty string, if that language was never filled in.

**التقويم.** One unit's month with a range editor: status, nightly price, minimum nights and a private
note over a span, written in one transaction. The status select offers متاح, مغلق and صيانة and
**never محجوز** — that is derived from real bookings, and a partner able to write it by hand could
hold inventory back from سفرة while appearing available (§8.4). The unit and the month live in the
URL so a view is shareable, and both are clamped: an unknown unit falls back to the property's own
first rather than erroring.

**A new endpoint, `GET /partner/properties/:reference`.** The card list returns what a card draws; a
form has to PREFILL, which needs the address, the coordinates and the descriptions in three languages
plus the city and policy CODES rather than their Arabic names. A form prefilled from a response that
omitted a field silently blanks it, and the partner who saves has erased their own copy without ever
seeing it — so the integration test is mostly a completeness assertion.

**11 browser tests** cover both screens, each asserting after a RELOAD and undoing its own writes.

**What remains:** the add-property form's three image slots stay absent by design (an image uploads
against a property that already exists, and the form says so), and there is no bulk unit editor —
units are edited one at a time through `PATCH /partner/units/:id`, which has no UI yet.

**Owner:** engineering.

### O-notify-2 — BullMQ is built, phases 1–6, and a total Redis loss is now re-drivable

**Status:** DONE 2026-08-13, phases 1–6 · **Open:** nothing, with two stated deviations below

Bashar took the decision the design was waiting on (2026-08-13), so Redis is now durable job
infrastructure rather than a cache. What shipped:

| Piece                             | Where                                                       |
| --------------------------------- | ----------------------------------------------------------- |
| Five queues declared, `mail` live | `queue/queue.definitions.ts`                                |
| Worker process                    | `apps/api/src/worker.ts`, `pnpm worker`, 30 s SIGTERM grace |
| `notify` enqueues; a worker sends | `NotificationService.notify` / `.deliver`                   |
| Dead letters, durable             | `dead_letter_jobs` + `DeadLetterService`, payload redacted  |
| Backoff with jitter               | `jitteredBackoff`, capped per queue                         |
| Alerting                          | `safra_dead_letter_jobs{queue}`, alert 17 (page)            |

**Phases 3 and 4, also 2026-08-13:**

| Piece                                  | Where                                                          |
| -------------------------------------- | -------------------------------------------------------------- |
| `media` — encoding off the request     | `queue/media.processor.ts`, `storage/image.service.ts`         |
| Unvalidated uploads held privately     | `incoming/` prefix, outside the `properties/*` read grant      |
| Four readers agree on what is visible  | `storage/image-visibility.ts`                                  |
| A processing state the partner can see | `image-manager.tsx`, polls only while something is rendering   |
| `scheduled` — five repeatable jobs     | `queue/scheduled.registrar.ts`, `queue/scheduled.processor.ts` |
| Rollback without a deploy              | `JOBS_VIA_QUEUE` (default `true`), `CronGate`                  |
| Stuck-render alerting                  | `safra_images_processing_oldest_seconds`                       |

**Phases 5 and 6, also 2026-08-13:**

| Piece                                 | Where                                                          |
| ------------------------------------- | -------------------------------------------------------------- |
| `exports` — CSV off the request       | `queue/export.processor.ts`, `admin/export-request.service.ts` |
| The 20,000-row truncation, removed    | `MAX_ROWS` is now 250,000 and is a real ceiling, not a budget  |
| Collecting a file                     | `/bookings/exports`, polls while anything is building          |
| Two audit rows                        | `booking.export_requested` and `booking.exported`              |
| Re-driving lost notices               | `notifications/notification-redrive.service.ts`, every 5 min   |
| `@Cron`, `JOBS_VIA_QUEUE`, `CronGate` | Deleted                                                        |

**The re-drive gap is closed, and what it can honestly do is stated.** The design claimed a lost
Redis was survivable by re-driving from `notifications`; reconstruction did not exist and could not
be written as described, because a row deliberately carries no recipient, subject or body. So the
one notice whose row IS a complete instruction — `booking.needs_action`, from its `booking_id` — is
rebuilt in full, and the other three are re-driven as "something is waiting, here is the screen".
That is less than the original and much more than the silence they got before. **Proved on real
data:** the 34 notices stranded by the phase-2 job-id defect were found, rebuilt and delivered, and
there are now no `queued` rows at all.

**Two deviations from the design, both deliberate.**

1. **`webhooks` was not built.** The queue is declared for "outbound partner/PSP callbacks" and no
   such capability exists — `PaymentWebhookService` RECEIVES webhooks and nothing sends them. A
   delivery subsystem with retries, a dead letter and an alert, for a feature nobody has specified
   and no receiver can be tested against, is infrastructure pretending to be progress. The retry
   policy stays declared, so the decision is already made when an outbound webhook is specified.
2. **The advisory lock stays.** Phase 6 lists dropping it, on the grounds that concurrency 1 beats
   "a lock this codebase has to remember to take". The lock now lives inside `runExclusively`, which
   is the only way a job body is reached, so there is nothing left to remember — and it still covers
   the case the queue does not: anything invoking a body outside the queue, such as the "run now"
   button somebody will eventually want. Two round trips is not worth the deletion.

**Two things the build found that the design did not say.**

1. **The design's "upload stores the original" omitted WHERE**, and a queue necessarily creates a
   window in which the platform holds a file exactly as a stranger sent it — the one thing the image
   pipeline otherwise guarantees never happens. It goes under `incoming/`, which the bucket policy
   does not grant anonymous read to, and is deleted as soon as the variants exist.
2. **Three of the five recurring jobs never wrote `scheduled_job_runs` at all.** The design says that
   table "must keep being written — from inside the job, exactly as now"; "as now" meant two of five.
   The SLA sweep was one of the three, which makes the job whose silence costs customers their §6.4
   compensation the job `safra_job_last_success_age_seconds` could not see. All three now record.

**`JOBS_VIA_QUEUE` is not in `.env.example`** — that file is outside what tooling here may write. It
defaults to `true` and needs no entry to work; add the line when convenient.

**The boot-time durability guard is the part worth keeping.** The design's operational requirements
say `maxmemory-policy` must be `noeviction` — "this single setting is the difference between a queue
and a cache" — and a managed Redis sold as a cache defaults to `allkeys-lru`, under which jobs are
accepted and silently discarded under memory pressure. Retrying cannot detect that, so
`assertQueueRedisIsDurable` reads the policy and the AOF setting at boot and REFUSES to start in
production. A documented requirement that cannot verify itself is one waiting to be violated.

**Two defects the build found in the design itself:**

1. **The job-id convention was not implementable.** The document specified `notification:<id>`;
   BullMQ answers `Custom Id cannot contain :`, because the colon is its own key separator. Every
   enqueue threw for the ten minutes before it was caught — and threw QUIETLY, because `notify`
   swallows enqueue failures so that a booking is never undone by Redis. 34 rows sat at `queued` as a
   result, which is precisely the recovery state the design intends. Now `notification-<id>`.
2. **The re-drive half of the recovery story does not exist, and cannot be written as described.**
   The design says "a total Redis loss is survivable: re-drive from the database rows". Detection
   works — a `queued` row identifies exactly what was lost, and
   `safra_notifications_1h{status="queued"}` already alerts on it. **Reconstruction does not.** A
   `notifications` row deliberately carries no recipient, no subject and no body (rule 1: every
   support agent reads that table), so the row says what was lost and cannot say what to send.
   Re-sending means re-deriving the email from the subject FKs per template — a reconstructor keyed
   by `template_key`, which nobody has written and the design never mentioned.

**Why (2) matters beyond tidiness.** It is a precondition of launch blocker 2: a restore drill that
cannot re-drive has not been passed, it has been performed. Either each template gains a
reconstructor, or `notifications` gains a non-PII parameter bag sufficient to re-render, or the
recovery claim is downgraded to "identifiable and unsendable" and said out loud. **That is a decision,
and it is Bashar's** — the third option may well be right for four low-volume notices.

**Tested:** 9 integration tests in `queue/mail-queue.integration.test.ts` against a real Redis and a
real BullMQ worker, on their own obliterated key prefix — the row reaching `sent` on the far side, the
deterministic id refusing a duplicate enqueue, a dead letter recorded with neither the payload nor the
provider's error carrying an address, and the backoff's bounds, growth and per-queue cap. Plus a
browser run with a worker live: the staff support reply crossed the queue and was delivered.

### O-notify-1 — Notifications exist for four events, and are now QUEUED

**Shipped 2026-08-08.** Three notices, in the recipient's own language, each recorded:
`booking.needs_action` to the partner, `review.received` to the partner, `review.replied` to the
guest. Full design in **`docs/notifications.md`**.

**The delivery log was the point.** `notifications` had existed since the first migration and nothing
had ever written to it, so «سجل المراسلات» showed a catalogue of templates over an empty table. Every
send now writes a row — sent OR failed, with the provider's reason — because "was the partner
actually told?" is the first question asked when somebody disputes a §6.4 fine.

**A security fix the test found.** The failure reason was stored verbatim, and an SMTP rejection
routinely quotes the address it refused (`550 5.1.1 <someone@example.com> …`). That would have put
email addresses into the one table designed to hold none. Reasons now pass through
`redactContactDetails`. Found by writing the assertion, not by inspection.

**Visibility is derived, never requested.** A guest writing a review causes mail to reach the host of
the booking they stayed at, taken from the booking row; a partner replying reaches the guest who
wrote that review, taken from the review. Neither party names the recipient.

**ACCEPTED DEVIATION — sends happen in the request.** There is no queue: `notify` calls the transport
inline after the transaction commits. That is honest for three low-volume notices and wrong for a
platform — a slow mail server becomes a slow API, and rule 3's p95 budget does not survive an SMTP
timeout on the booking path. The fix is item 9 (BullMQ), deferred by Bashar until the hosting
decision is made. This service is the seam that move happens behind: every send already goes through
one method with a recorded outcome. **The consequence, stated plainly: an unreachable mail server
adds its connection timeout to the request that triggered it.** Nothing is lost — sends are after the
commit and failures are recorded — but the caller waits.

**What remains:**

1. **WhatsApp is unwired** (roadmap item 192, provider undecided). Email is the only channel.
2. **No digest or preference.** A partner receiving twenty bookings gets twenty emails, and there is
   no way to opt out of anything. Acceptable at launch volume; not at scale.
3. **No retry.** A failed send is recorded and abandoned. Retrying belongs with the queue.

**Owner:** engineering (1 and 3 follow the hosting decision; 2 is product).

### O-partner-3 — The dashboard is built; the calendar shows one unit

**Shipped 2026-08-07.** `GET /partner/dashboard` answers the whole §7.1 screen in one round trip:
four KPI cards, the pending-request queue with its SLA clock, a month calendar and the alerts panel
carrying the payout line. Every section is one indexed query, scoped by the partner id in the
VERIFIED token — the service accepts no partner id, so "show me another partner's dashboard" is a
question it cannot be asked.

**Two rules the implementation keeps, and both are load-bearing:**

- **Null is not zero.** Earnings, occupancy and response speed return `null` where the platform has
  no data, and the card renders «—». A partner with no units has not achieved 0% occupancy; a
  partner never asked to confirm a booking does not have a 0-minute response time. Both would be
  read as a verdict. Occupancy DOES report a real zero for a partner who has units and no stays,
  because that is a fact rather than an absence — asserted separately in the tests.
- **The payout line describes a ROW or nothing.** It reads `partner_payouts` and never sums
  `partner_payable_amount` into a sentence about a transfer. «مجدول» and «قيد التجميع» are two
  separate catalogue strings so an open accrual cannot be rendered as a dated transfer. Proven by a
  test that gives a partner a completed booking with money owed and asserts the line is still
  absent.

**The calendar, replaced 2026-08-08 — it now covers the WHOLE portfolio.** It used to draw one unit
chosen by creation date, which is a defensible sample of one and a misleading picture of a business:
a partner with six units saw one room's month on the screen they open every morning. Each square now
carries how many units are booked, how many are closed, and how many are still open, with the
breakdown in a `title`. A booking still overrides the availability table where they disagree, since a
booking means somebody is arriving; and a unit that is both booked and closed is counted ONCE, as
booked, or the three numbers would exceed the portfolio and «متاح» would go negative.

**It does not get slower as a portfolio grows.** The obvious query is units × days then `GROUP BY`,
which is 15,500 rows for a 500-unit partner before it aggregates anything. This one expands the
BOOKINGS and availability rows that exist — bounded by what the partner did rather than by what they
own, both indexed by `unit_id` — and answers thirty-one rows whatever the portfolio looks like.
Inactive units are excluded: a unit taken off sale is not inventory, and counting it as available
would overstate what a customer can book.

**Two fixture defects this found.** `db:testbed` created `pending_confirmation` bookings with no
`confirmation_deadline_at`, so the SLA sweep could never expire or fine them and the dashboard's
countdown had nothing to count — the seed now sets it the way `BookingCreationService` does. And
`e2e/responsive.spec.ts` has never covered لوحة الشريك at all; the four widths are now asserted
inside the partner sign-in test, where they cost no extra login.

**The calendar became a way IN, 2026-08-10 (Bashar).** Its numbers were correct — checked against the
seeded bookings — but it was read-only, so a partner who spotted a problem had no way to act on it.
Every square is now a link to **التقويمات** (`/calendars`) at that date. The aggregate square itself
cannot be edited and never will be: it counts every unit, so there is no single room to open or close.
`prefetch={false}` on those links is not incidental — thirty-one links to a dynamic page would
otherwise let a framework default turn opening the dashboard into a month of server renders.

**التقويمات, new 2026-08-10.** Every unit's month on one page, grouped under its property, each with
its own weekday-aligned grid and its own range editor. `GET /partner/calendars` answers it in TWO
queries whatever the portfolio — a page of properties by keyset, then one expansion of the month for
their units — and takes a `month` rather than a `from`/`to` because `calendarQuerySchema` accepts any
range and units × days over a century is a denial-of-service shaped like a calendar read.

**Both grids are now real calendars.** They were seven-column strips: day one in column one whatever
weekday it fell on, and no weekday header. `MonthGrid` offsets the first day into its true column,
names the columns from `Intl` (Saturday first, the week as it is read in Syria), dims the past and
rings today. The old shape withheld the one thing a lodging calendar is asked — which of these is a
weekend. **The dashboard's own strip was left as the design specifies it**; the working screen is the
one that got the real grid.

**Four defects found and fixed on review, 2026-08-10.** Recorded because three of them are classes of
bug rather than one-off slips:

1. **Every day cell carried `id="day-<date>"`** — fine on the one-grid screen, invalid on التقويمات
   where four units draw the same month, so each id existed four times. Removed rather than
   namespaced: nothing links to them, because the dashboard hands over by `?date=` and cannot know a
   unit id to build a fragment from.
2. **The range editor kept the previous month's dates.** `useState` seeds once, and a client-side
   month change re-renders `RangeEditor` without remounting it — so the dates stayed on آب while the
   bounds moved to أيلول, and «تطبيق على المدة» wrote to **August** while the reader was looking at
   September. Fixed by adjusting state during render when the month prop changes. The regression test
   CLICKS the arrow; a `goto` remounts the component and passes against the bug.
3. **"Today" was computed in UTC** (`toISOString().slice(0, 10)`) on three screens. Damascus is UTC+3,
   so from 21:00 UTC the wrong square was ringed and the real yesterday was left undimmed — and at
   21:30 on the 31st, the screens opened on **the month that had just ended**. Now `marketToday()`,
   which goes through `cityLocalNow` and the IANA database rather than assuming a constant offset.
4. **A cursor page was a dead end.** `عرض عقارات أخرى` moves forward only and the month arrows carry
   the cursor, so page two had no way back except the browser button. There is now a
   «العودة إلى أول العقارات» link.

**Known limits, deliberately not built:**

- **Paging is per PROPERTY, so one property with hundreds of units is one large response.** Chosen so
  a page boundary can never split a hotel's rooms away from their heading. A 500-room hotel would
  want unit-level paging inside a property; nothing in the fixtures approaches it.
- **No composite index for the keyset.** `properties_partner_idx` serves the filter and Postgres sorts
  one partner's properties, which `EXPLAIN` confirms is an index scan plus a small sort.
  `(partner_id, created_at, id)` would make it a pure seek and is the right index if portfolios grow.
- **Pressing a day does not scroll to it.** It opens the month and rings the date in every grid; on a
  long page the ring can be below the fold. A fragment cannot be built without a unique target — see
  defect 1.
- **A nightly price of `0` cannot be submitted.** `if (price)` treats `"0"` as absent, so the contract
  accepts a free night that the UI cannot send. Left alone: rejecting a zero price is the safer
  behaviour of the two, and changing it is a pricing decision rather than a bug fix.

**التقويمات re-shaped 2026-08-19, and the ten-property ceiling with it.** Bashar asked for the page
to be split by عقار with a unit-number search, and the pager («عرض عقارات أخرى») removed. Removing a
pager from a page that expanded every listed property would have put a partner's eleventh property
out of reach, so the read was split in two: the API LISTS every property with its units, and expands
the DAYS of only the one named by `?expand=` — the folder the reader has open. Days are the whole
cost of the screen (a property × its units × every day of the month), so the cost is now flat in the
size of the portfolio. An `expand` naming somebody else's property does not match a row the caller
was given and falls back to their own first one; the scoping is still the page query and not a check
on the parameter. `calendar.integration.test.ts` covers all three cases and
`partner-calendars.spec.ts` asserts one open folder in the browser.

**What is still bounded, and deliberately:** the LIST stops at 200 properties, and the page draws no
pager, so a partner with more than 200 would not see the rest. 200 is a bound rather than a budget —
listing a property is four columns and one indexed seek — and a portfolio past it is a conversation
before it is a paging problem. The cursor is still returned by the API, so restoring a control is a
page change and not a service change. **Unblocks:** nothing. **Owner:** engineering, if a partner
ever approaches it.

**Owner:** engineering.

### O-partner-6 — «انضم كشريك» is built; three of its limits are deliberate

**Shipped 2026-08-19.** Bashar specified a seven-step joining flow: a public page with information
and a form, the request reaching the super admin, a phone call, an acceptance, a contract and
account hand-over, an account that stays pending while documents are checked, verification, and
only then the ability to set prices, dates and images. All seven are built.

**Three decisions were taken WITH Bashar rather than assumed**, because each conflicted with a rule
already in this repository:

1. **The applicant's customer account is CONVERTED, not deleted.** Step 4 as first described said
   to delete it. That account owns bookings, invoices, a wallet balance, reviews and disputes, and
   `.claude/CLAUDE.md` records P-003 «suspension, never deletion». The role changes
   `customer → partner` instead, so nothing is orphaned and the person keeps their own history.
2. **The account is handed over by a single-use INVITATION, never a password.** Step 4 said "email
   - password". A password in an inbox is a credential that outlives its usefulness and is readable
     by anybody who ever reaches that mailbox. The link expires in 72 hours and can be re-sent.
3. **Self-registration is closed.** `POST /partner/register` created a partner account outright.
   Two doors into the same relationship would have meant two review queues that must agree.

**Applying requires a SESSION** (Bashar, 2026-08-19). The page and the endpoint both refuse an
anonymous visitor, and the request is filed against the signed-in account: the address, the
eligibility check and the account that eventually becomes a partner are all read from the verified
token. That deleted a whole class of problem rather than defending against it — an earlier version
took an anonymous form carrying a typed address, which is a CLAIM about a mailbox nobody had
checked, and every later step had to be built so that a forged one cost the real owner nothing.
"Apply as somebody else" is now unexpressible.

**The conversion still happens at REDEMPTION, not at acceptance,** for two reasons that survive
the session requirement: a partner account is privileged, so its password is re-established rather
than inherited, and a live mailbox is confirmed before somebody is handed a business relationship.
A staff account and one that is already a partner are refused — when the request is FILED, so
nobody is telephoned about a request that could never be accepted, and AGAIN at acceptance,
because days pass in between and an ordinary customer on Monday can be staff by Thursday.

**Deliberate limits, recorded rather than hidden:**

- **No email reaches the super admin when a request arrives.** The queue and its sidebar badge are
  the notification, which is how every other staff queue in this console works. An address to
  notify would be the first piece of configuration; there is no staff-alert address in `env.ts`
  today. **Unblocks:** nothing. **Owner:** engineering, if the queue is ever worked by somebody who
  does not open the console daily.
- **Signing is offline.** SAFRA uploads the contract, the partner downloads it, signs it and
  returns it, and staff record the signature — `awaiting_partner_signature → active`. There is no
  e-signature integration and the schema never assumed one. A partner asserting their own signature
  is not a signature, so a self-service "I have signed this" button is not the missing piece.
- **The verification gate blocks unit CREATION too.** A unit carries a base price, so creating one
  is setting a price. The consequence — an unverified partner can write a property's address and
  description and nothing else — is stated on the public page, in the invitation email and on the
  partner's own العقود والمستندات screen, so it is expected rather than discovered.

**Owner:** engineering. **Status:** complete.

### O-partner-10 — تسجيل شريك جديد: a super admin can onboard a partner in one sitting

**Shipped 2026-08-23.** Bashar asked for the case where the super admin and the partner are
physically together and have already had the conversation «انضم كشريك» spreads over a week: fill in
the form, upload the documents, produce and sign the contract, and approve — without the partner
ever touching the partner app or waiting for an invitation.

`الشركاء → «تسجيل شريك جديد»` opens `/partners/new`; saving lands on
`/partners/[reference]/onboarding`, a numbered checklist that composes the EXISTING document,
contract, screening and approval panels rather than reimplementing any of them.

**Four decisions were taken WITH Bashar**, because each one had a defensible alternative:

1. **The partner still sets their own password, from a link mailed to them.** The super admin has no
   field in which to express a password and no way to read one. Everything else completes on the
   spot, so the partner leaves approved and signs in whenever the email reaches them.
2. **No `partner_applications` row is written.** Nobody filed a request, so «طلبات الشراكة» stays a
   true record of requests people actually made. The origin lives in one audit action and one
   timeline event instead.
3. **A stepped screen of its own,** not extra controls on the partner detail page — because the
   ORDER of the contract steps is load-bearing and four equal panels would hide it.
4. **The wizard gates nothing.** Every step is reachable at any time. The sanctions feed (`M-2`)
   already taught this repository what happens when onboarding is made to depend on a control that
   can be unavailable.

**Why it is a separate action with a separate name.** `partnerApplicationAcceptSchema` deliberately
has no field naming an account, and its docblock says why: letting a reviewer name one would turn
"accept this request" into "make an account of my choosing a partner". This feature IS that second
action, so it does not get to wear the first one's label. It has its own permission
(`PARTNER_ONBOARD`, super admin only), its own audit action (`partner.onboarded_in_person`) and its
own timeline event, so «how did this partner get here» can never come back with an answer that fits
both paths. The operator's reason note is REQUIRED and lands in `audit_log.reason`, because this
path bypasses the queue that normally produces the request, the call log and the decision note.

**What stops it being a way in — three mechanisms, each asserted directly in
`partner-onboarding.integration.test.ts` and confirmed against the running database:**

- The account is created with `password_hash` NULL, exactly as `staff.invited` leaves one.
- Its role stays `customer`. `token.service.ts` only attaches `partnerId` to a token whose user is
  already `partner`, and permissions come from the role — so the `partners` row grants the named
  account nothing until the invitation is redeemed FROM the mailbox.
- A staff address and an address that is already a partner are both refused, as «انضم كشريك»
  refuses them. An address with an OPEN request is refused too: onboarding around it would leave a
  request nobody will ever close, and the reviewer working that queue would telephone somebody who
  was onboarded last week.

**Residual exposure, stated rather than hidden.** A super admin can bind a partner record to a
stranger's account, occupying `partners_user_unique` and putting a name in the registry. That is a
super admin misusing a super-admin power in a fully audited way, and it is not an escalation —
nothing about it yields a session. **Owner:** accepted risk.

**RESOLVED 2026-08-23 — the sitting can now finish the contract too.**

This entry originally recorded that a single sitting could only reach `awaiting_partner_signature`,
because `contract_signature_party = 'partner'` meant "uploaded from their own account" and during
the sitting that account has no password yet. Bashar's answer was better than the workaround being
considered: when both people are at one table they sign ONE sheet, so there is a single scan
carrying both signatures and nothing to wait for.

«ارفع النسخة الموقّعة من سفرة والشريك» sits beside the ordinary upload. It writes two signature
rows against one file, sets `sent_at` and `signed_at`, and puts the contract straight to `active`,
skipping `awaiting_partner_signature` entirely. The partner is emailed their countersigned copy and
can download it from their dashboard.

**Onboarding only, and enforced on the server** (Bashar, 2026-08-23). The control is not general
contract management: it appears only while the partner is still `pending`, and the API refuses it
otherwise with a coded 409. Both halves read the same fact so the screen never offers a button the
server has started refusing — which matters because the onboarding screen is reachable for any
partner and step ⑤ can approve one without leaving the page.

**The enum was NOT extended, and that was a decision.** A third `partner_via_staff` value was
considered — this entry proposed it — and rejected. `contract_signature_party` answers "whose
signature is on this paper", and on a jointly signed document the partner's ink genuinely is;
"who filed the scan" is a different question that `uploaded_by_user_id` already answers. A third
value would encode in one column what two columns already say, at the cost of a migration and a
new case in every reader. The enum's docblock was corrected in the same change, because it said
"uploaded from their own account" and that clause is false for a joint upload — a record that
disagrees with its own documentation is worse than the missing value.

**DEFECT FOUND IN USE, 2026-08-23 — the screen said "done" while the partner could not sign in.**

Bashar onboarded `test@gmail.com`, approved them, and then could not sign in: "it says the login
data are wrong, but I am sure it is correct." They were not wrong — there was no account to be
right about. The address already existed as a CUSTOMER (since 2026-08-14), onboarding adopted it
as designed, and the invitation was never redeemed — so the role was still `customer` and the only
password on the account was the customer one it had always had. Seven attempts locked it.

Two failures, and the second is worse than the first:

1. **Nothing on the onboarding screen mentioned the account.** All five steps read «تم», so the
   operator finished, saw a complete checklist, and reasonably concluded the partner could log in.
2. **There was no remedy, and this document claimed there was.** The paragraph above used to say
   the invitation "is re-sendable from the screen". It was not:
   `PartnerApplicationService.resendInvitation` is keyed on an APPLICATION reference and refuses
   anything without one, and an onboarded partner deliberately has no application row. A
   capability was asserted in this register and never built.

**Fixed.** `partnerDetail` now returns `accountActivated` (derived from the ROLE, which only
redemption sets — not from the presence of a password, since an adopted account already has one)
and `invitationPending`. A panel under step ① states whether the partner can sign in and offers
«إعادة إرسال الدعوة», backed by a real `PartnerOnboardingService.resendInvitation` behind
`PARTNER_ONBOARD` and throttled to three a minute, since it mails a live credential. It refuses an
already-activated account with a coded 409 — a second link for an account whose owner has chosen a
password is not a resend, and losing a password is what reset is for.

It is a line under step ①, not a sixth step: nobody in the room can complete it, and the rest of
onboarding genuinely does not wait for it. `e2e/partner-onboarding.spec.ts` asserts the control is
present, and still present AFTER approval — the moment an operator is most likely to think they
are finished.

**Related, found while diagnosing and fixed alongside:** `auth.not_staff` was one code shared by
three login routes that reject three different mismatches, so its message could only ever be right
for one. A partner in exactly this state was told «هذا الحساب لا يملك صلاحية الدخول إلى مركز
القيادة» — pointed at the staff console. Now three codes with correct copy each.

**Accepted consequence:** a corrected joint copy cannot be filed after approval. If the scan turns
out to be the wrong page once the partner is approved, the remedy is the ordinary two-step path —
SAFRA re-uploads and the partner signs from their own account, which by then they can do because
the invitation has been redeemed. Recorded rather than discovered.

**Two smaller notes:**

- **`PartnerInvitationService` was extracted** out of `PartnerApplicationService`, because both
  routes to a partner account now issue the same link and two copies of "how long is an invitation
  valid" would drift without ever failing a test.
- **The staff document upload is MULTIPART**, so it never reaches `body-parser` and `FILE_BODY_PATHS`
  did not have to grow a prefix that would have given a 15MB JSON limit to a dozen `/admin/partners`
  routes that should keep 100kb.

**Verified:** `partner-onboarding.integration.test.ts` (18 tests), `e2e/partner-onboarding.spec.ts`
(the whole walk in a browser, plus the refusal in Arabic and no sideways scroll at
390/768/1024/1440), and a direct database read confirming `verification=approved`,
`account_role=customer`, `password_hash IS NULL`, one document, one contract at
`awaiting_partner_signature`, zero application rows.

**Owner:** engineering. **Status:** complete, except the partner-signature decision above.

### O-partner-4 — Partner 2FA is mandatory and enforced; what remains is operational

> **SUPERSEDED 2026-08-20 for partners — see `O-sec-9`.** Partners no longer enrol an
> authenticator; they prove a six-digit code emailed at every sign-in, and an authenticator is an
> upgrade they may choose. STAFF are unchanged, so everything below still describes them. This item
> is left in place as the record of the decision it made, not as a description of today.

**Decided and shipped 2026-08-07.** Bashar's decision was **mandatory, not optional**. Partner
accounts now require a second factor exactly as staff accounts do.

**What is DONE.** `TWO_FACTOR_ROLES` and `requiresTwoFactor()` in `@safra/contracts`, kept
deliberately separate from `STAFF_ROLES` so widening one did not widen console admission;
`StaffTwoFactorGuard` generalised to `TwoFactorGuard`, which refuses every request from an
unenrolled staff member OR partner and admits only `@AllowsUnenrolled` routes; `AuthService.login`
demanding the code from partners; enrolment, recovery-code issue and consumption reusing the staff
`TwoFactorService`; a two-step partner sign-in that accepts a TOTP code or a recovery code in one
field; a `/enrol-2fa` screen the portal middleware routes every unenrolled partner to; and a
staff-driven reset behind its own `partner.two_factor_reset` permission.

Three properties worth not losing:

- **The migration needed no outage.** Login still asks for a code only from accounts that HAVE
  enrolled, so every partner that existed on 2026-08-06 could still sign in — into a session
  `TwoFactorGuard` allows to do exactly one thing. Refusing the login instead would have locked out
  every partner with no way back, because enrolling needs a session.
- **The reset only CLEARS.** It never sets, returns or accepts a secret, so a staff member never
  holds a credential that authenticates as a partner. It refuses any target that is not a partner —
  without that check the permission would be a way to strip a factor from a super admin and then
  need only a password.
- **Enforcement is server-side.** Verified against the running API: an unenrolled partner's token
  is refused 403 on `/partner/properties`, `/partner/me` and `/partner/payouts`, and accepted only
  on `/auth/2fa/setup`.

**Tests.** `partner-two-factor.integration.test.ts` (23 against a real database: enrolment, secret
encryption, recovery codes stored only as hashes, single-use consumption, the reset clearing the
secret rather than only the flag, session revocation, the audit row and what it must not contain,
and the escalation guard); `two-factor.guard.test.ts` and `second-factor-required.test.ts` for the
role logic; `e2e/partner.spec.ts` for the forced-enrolment journey in a browser. `db:testbed` seeds
partner1 and partner2 enrolled and partner3 **unenrolled on purpose** — the permanent fixture for
the migration case.

**What remains, and it is operational rather than structural:**

1. **Staff 2FA has no reset path.** Partners now have one; staff do not, so a locked-out staff
   member is still a database edit. The same service is the obvious model, with a stricter rule
   about who may reset whom — a support agent must not be able to reset a super admin.
2. **Recovery codes cannot be regenerated.** A partner who uses seven of eight has no way to get a
   fresh set short of disabling and re-enrolling, which the portal offers no screen for.
3. **No "you have N recovery codes left" anywhere.** The count exists in the database and nothing
   surfaces it, so the first sign a partner gets is running out.

**Owner:** engineering.

### O-scale-2 — FIXED: search went from 144 seconds to 0.6

**Status:** fixed 2026-08-13 · **Found:** 2026-08-12, the first run against production-shaped data ·
**Was:** the primary traffic path returned HTTP 500

Search is 80 % of real traffic (`docs/load-testing.md` §1). At the documented volumes — 50,000
properties, 200,000 units, 73M availability days — one search took **144 seconds**, and since the pool
sets `statement_timeout: 15_000`, what a customer received was **HTTP 500**. Not slow at scale; broken
at scale, against a 200 ms budget.

All figures below are measured through the real endpoint against `safra_load`, warm:

| Query                                   | Before     | After    | Change    |
| --------------------------------------- | ---------- | -------- | --------- |
| One city                                | 39,705 ms  | 166 ms   | **239×**  |
| City + type                             | —          | 141 ms   | —         |
| No filters, `recommended` (the default) | 144,488 ms | 590 ms   | **245×**  |
| No filters, `rating_desc`               | —          | 575 ms   | —         |
| No filters, `price_asc`                 | —          | 2,750 ms | see below |

**Six changes. The first four preserve the plan's meaning exactly; the fifth adds indexes; the sixth
adds a second query shape and is the only one with a correctness argument to make.**

1. **Narrow before pricing.** City, type and cancellation-policy filters moved INTO the availability
   CTE. They were applied afterwards, so a search of one city priced and availability-checked every
   unit in the country first. This unlocked `properties_published_idx` —
   `(city_id, recommendation_score DESC) WHERE status = 'published'` — an index that already existed
   and that the old query shape made unusable. The predicates are REPEATED downstream rather than
   moved, so applying them twice cannot change a result.
2. **Price with algebra instead of a row per night.** `SUM(COALESCE(ad.price, u.base_price))` over a
   `generate_series` LEFT JOIN meant the date was never an index bound: the plan read all 365 of a
   unit's availability rows and hash-joined them down to the two being priced. Rewritten as
   `nights × base + Σ(override − base)` — the same total by algebra — it is a bounded range scan.
3. **Deleted a window function nobody read.** `ROW_NUMBER() OVER (…) AS row_no` was computed over
   every matching property and then deleted from each row by `stripSortColumns`. A window function is
   evaluated over the whole partition before `LIMIT` applies, so search paid to rank its entire result
   set on every request and threw the answer away.
4. **Merged two anti-joins into one scan.** The closed-day rule and the minimum-nights rule read the
   same `(unit_id, date)` range separately. The union of the predicates is the union of the excluded
   sets, so the result is identical.
5. **Three partial indexes** — `migrations/post/0006`. Every one of search's three questions of
   `availability_days` looks for the EXCEPTION, and an absent row means an available, unpriced,
   unconstrained night. The primary key can find the rows but not answer the questions, because
   `status`, `min_nights` and `price` are not in it — so each probe fetched the heap, 150,000 random
   reads into a 9.5 GB table. `availability_days_blocked_idx` is 124 MB against the key's 4,684 MB and
   turned the anti-join into a single bitmap scan; `availability_days_priced_idx` carries `price` in
   its payload, so the price sum is an Index Only Scan and never touches the heap (0.149 ms → 0.021 ms
   per probe). Cost, stated: three more indexes on the table partners write when editing a calendar.
6. **Choose the page before pricing it, where the ranking allows.** `recommended` and `rating_desc`
   rank on `recommendation_score` and `rating` — columns of the PROPERTY, owing nothing to the dates
   searched. So the page's properties are selected by rank first and only those are priced: twenty
   instead of fifty thousand. This is what took the unfiltered default from 3.9 s to 0.59 s.

**Why change 6 is exact, and where it does not apply.** It ranks with `RANK()`, not `ROW_NUMBER()`:
ties share a rank, so `rk <= n` admits EVERY property level with the last one on (score, rating). That
matters because `recommended`'s third key is the price, which the fast path has not yet computed — with
`ROW_NUMBER` a tied property would be cut arbitrarily and the cut would decide an ordering the price is
supposed to decide. A test proves it: switch `RANK` to `ROW_NUMBER` and it fails.

It is disabled for `price_asc`/`price_desc`, whose ranking key IS the thing being computed, and for any
search carrying `minPrice`/`maxPrice`, because a price filter can eliminate every unit of a property —
so a property inside the rank window can drop out and one outside it should have taken its place.
Narrowing first would return a short page and silently omit a match.

**The remaining case is `price_asc` with no filters, at 2.75 s.** It must price all 150,000 candidates
to know which are cheapest; there is no ordering trick available. It is a deliberate user action rather
than the default, and it is 52× better than it was. Closing it needs a precomputed nightly total — a
materialised view refreshed on availability writes — which is real work for a case nobody lands on
first.

**Guarded by `apps/api/src/search/search.integration.test.ts`** — 27 tests. Search had **none** before
this. They were written against the ORIGINAL query and all passed before a line changed, which is what
makes them evidence of preserved meaning rather than a description of the new behaviour. Two earn
their place beyond that: one asks the same question down both query shapes and requires byte-identical
answers (`maxPrice` far above every fixture disables the fast path without changing which properties
match), and one levels three properties on score and rating so the boundary tie is exercised.

### O-scale-1 — FIXED: every reference stopped working at 999,999 rows

**Status:** fixed 2026-08-12 · **Found by** building the load-test data generator · **Severity:** would
have been an outage at the volumes rule 2 targets

**What was wrong.** Twelve tables carry a human-readable reference — `CUS-000042`, `BKG-2026-000042`,
`PAY-000042` — and every default was `lpad(nextval(…)::text, 6, '0')`. **`lpad` TRUNCATES** when its
input is longer than the width, keeping the first six characters: `lpad('1000000', 6, '0')` is
`'100000'`. So the millionth row was handed the reference the hundred-thousandth row already had. And
because the digit that falls off is the LAST one, ten consecutive counter values then collapse onto a
single reference.

The unique index turned that into a failed `INSERT` — an outage rather than two bookings quoting one
number to two customers. That is the better of the two failures and still a hard ceiling of **999,999
rows** on customers, partners, properties, bookings, payments, reviews, payouts, disputes,
conversations, gift cards and both advertising tables.

**Why nobody hit it.** No environment had ever held a million of anything. The development database
has 2,703 properties and 5,871 bookings; the fixtures are smaller still. It was reachable only by
generating the volumes in `docs/load-testing.md` — 1M users, 5M bookings — which is what found it, on
the row after 999,999, before a single request had been sent.

**The relevant numbers.** Rule 2 targets **1M users**. The load plan specifies **5M bookings**. So the
ceiling sat at the documented target for one table and at a fifth of the documented volume for
another — not a theoretical limit, the actual design point.

**The fix** is a `reference_number(bigint)` function in `migrations/pre/0000_prerequisites.sql` that
pads to six digits **without truncating**, and twelve `ALTER COLUMN … SET DEFAULT` in migration
`0026`. Below a million the output is byte-identical, so no existing reference changes and no row
needed rewriting; past it, references simply grow a digit — `CUS-1000000`.

**Guarded by `apps/api/src/database/reference-ceiling.integration.test.ts`**, which drives the
sequence to 999,998 with `setval` and inserts across the boundary rather than inserting a million
rows. Its last test reads every `reference` default out of `information_schema` and fails if any of
them uses `lpad` again — because all twelve shared one bug by being copied from each other, and that
is how the thirteenth would arrive.

**The general lesson, worth more than the fix:** the defect was invisible to every test, every review
and every environment, and visible immediately to a million rows. It is the argument for building the
generator before the hosting decision rather than after.

### O-ui-1 — FIXED: the console audit Bashar asked for, 2026-08-20

**Status:** fixed · **Found by** walking every console route in a browser rather than reading it

Bashar asked for every page of the super admin console to be gone through and made
production-ready, and reported one symptom to start from: _"The partner page is written on the left,
while the current language is Arabic."_ Both halves of that were literally true, and it turned out to
be the visible end of four unrelated defects.

**Ten findings. Every one of them was invisible to `pnpm verify`, and six were invisible to
`pnpm e2e` as it was being run.**

| #   | Finding                                                                                                                                                                                                                                                                                                                                                             | Severity           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 1   | **Neither the console nor the partner portal had a `not-found.tsx`**, so a wrong URL rendered Next's English `404 / This page could not be found.` — and under `dir="rtl"` the full stop moved to the start of the sentence. That is the report, exactly. `/partners/PAR-999999` reached it too, which is a stale bookmark rather than a typo                       | Medium             |
| 2   | **43 of 73 audit actions had no Arabic label**, so السجل, الموظفون and the dashboard's activity panel printed English prose — "auth password changed", "booking export requested". Survived every guard because `auditAction()` fell back to `replace(/[._]/g, ' ')` and `navigation.spec.ts` greps for SNAKE_CASE: the fallback had already removed the underscore | High               |
| 3   | **All four notification templates the platform actually sends were missing** from the catalogue, which listed six planned ones with zero overlap — so every row of سجل واتساب والبريد printed `booking.needs_action`. The render site printed the raw key anyway, twenty lines below an inventory that resolves its own                                             | High               |
| 4   | **The partner verification queue was unpaginated**, capped at fifty by an API default. With 527 partners awaiting verification, **477 were unreachable through the console** and the sidebar badge counted the real figure beside a list that could not show it                                                                                                     | High               |
| 5   | **`request.url` is `0.0.0.0` on the runtime the containers run**, and four routes built redirects from it — so every POST-then-redirect sent the operator to a different origin. The customer app's currency switcher was worse: its CSRF guard compared `Origin` against the same value and **answered 403 to every real browser**                                 | High               |
| 6   | **`pnpm e2e` had never run against the runtime the product ships.** All three apps build `output: 'standalone'` and were being served with `next start`, which prints a warning saying it does not work. Five specs failed the first time the suite met the real runtime; finding 5 is what they were failing on                                                    | High               |
| 7   | Staff scope forgot the verification screens — see `O-sec-4`                                                                                                                                                                                                                                                                                                         | High (unreachable) |
| 8   | **No app had an `error.tsx`**, so an unhandled render error showed Next's English error page: the same defect as finding 1, one boundary over                                                                                                                                                                                                                       | Medium             |
| 9   | `listParamsFor` took a section and then ignored it for the parameter names, so `/staff`'s scope map read the query string by hand — and in doing so used `pageSize()` instead of `resolvePageSize()`, silently **not honouring that table's saved rows-per-page**                                                                                                   | Low                |
| 10  | `TablePagination` took its parameter names as PROPS defaulting to `page`/`size`, so namespacing was something each call site had to remember. The first two callers to forget were the queues added the same afternoon, whose bars would have paged the registry beside them                                                                                        | Low                |

**What the fixes are, structurally, rather than one at a time:**

- **A missing translation now looks like one.** Every fallback returns the key VERBATIM instead of
  spacing its underscores out. That is the change that matters most, because it puts the existing
  snake_case sweep back in charge of catching the next one — 43 labels went missing precisely because
  the fallback disguised them as chosen English.
- **`AUDIT_ACTIONS` in `@safra/contracts`** is the canonical list, with two tests holding both ends:
  one that every declared action has an Arabic label AND that no label is orphaned, one that every
  action in the DATABASE is declared. The second caught a fourth notification template
  (`support.replied`) written by a browser run the same afternoon.
- **Parameter names come from `TABLE_SECTION_PARAMS`** — in the bar, in the page reading the query
  string, and in the endpoint writing the preference. One answer to "what is this table's page
  parameter".
- **Redirects are RELATIVE and the origin check reads the `Host` header** (`seeOther`, `isSameOrigin`
  in `@safra/session`). There is no host for a deployment to get wrong, and no `HOSTNAME` to remember.
- **`pnpm e2e` now runs against the standalone servers.** 250 tests, up from 244.

**Two residuals, both recorded rather than hidden:**

1. **A runtime `notFound()` renders blank without JavaScript.** An unmatched path is
   server-rendered and fine; `notFound()` thrown from a page makes Next serve an error shell and
   deliver the UI in the RSC payload. Closing it means detail screens rendering their own "no such
   record" panel inside the console shell instead of calling `notFound()` — which keeps the nav and
   works without JS, at the cost of answering 200. Reasonable for an internal tool behind auth with
   `robots: noindex`, and it touches every detail screen, so it is its own change.
2. **`AuditEntry.action` is still `string`.** `AUDIT_ACTIONS` should be its type, which would make a
   typo a build failure rather than a permanent row in an append-only table. Five call sites build the
   action with a template literal — `partner.${nextStatus}`, `property.${…}`, and three more — so the
   union needs those narrowed by hand. Those five are exactly why the two REJECTION actions were
   missing while their approvals were present: a reader of the source sees one action where there are
   two.

**Not defects, checked and left alone:** the permission matrix on الموظفون shows permission KEYS
(that is the audit surface — a translated label could not be matched against the guard); الإعدادات
shows setting keys, and geography's three bounded tables are the documented pagination exception;
Latin digits in the pagination bar are the "Arabic copy, western digits" decision of 2026-08-06; and
the redaction that keeps email addresses out of `notifications.failure_reason` works on every SMTP
error shape probed — one unredacted row survives from 2026-08-08, before it existed.

### O-sec-4 — FIXED: staff scope reached nine registries and not the verification screens

**Status:** fixed 2026-08-20 · **Severity:** High as a design gap, **unreachable in practice** ·
**Found by** the console audit Bashar asked for

**What.** `scope.sql.ts` carries this warning in its own comment: _"Duplicating the predicate per
service is how a scope ends up enforced on eight resources and forgotten on the ninth — and the ninth
is the one somebody finds."_ `review.service.ts` was the ninth. It serves both P-002 verification
queues, both detail screens and both decision endpoints, and **none of its methods took an actor at
all** — `pendingPartners.length > 1` was false, so there was nothing to scope by.

A city-scoped operations manager could therefore see every partner in the country awaiting
verification, open any partner or listing by reference, and — the serious half — **approve or reject
either of them, anywhere.** `assertCanWrite` existed and was called in exactly two other services;
§8.2's rule is that a write outside scope is refused in BOTH modes.

**Why it had never bitten.** Every staff row in the database is `all_cities`. The gap needed somebody
to use the console's own scope map first, so the feature that would have exposed it is the feature
that describes it. Nothing was exposed.

**Fixed** — `assertCanRead` and `scopeCondition` added beside `assertCanWrite`, and all six paths now
take the actor:

| Path                     | Enforcement                                                                                                                                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Both verification queues | `scopeCondition` in the predicate, and the **capped count carries the same scope** — a count that ignored it would print «٥٢٧ نتيجة» over an empty list                                                   |
| Both detail screens      | `assertCanRead` on the row, answering 404: "not yours" reads the same as "not there". The city uuid is selected for the check and stripped from the response, because no admin route returns internal ids |
| Both decisions           | `assertCanWrite`, which refuses in both modes — 404 under `none`, 403 under `read_only`                                                                                                                   |

**Two helpers rather than one, and that is the point.** `read_only` means "look at the country, change
your cities", so a read outside scope is exactly what it permits and a write outside scope is exactly
what it forbids. Reusing the write guard for reads would break the mode it exists for.
`scopeCondition` exists because the queues are built with the relational query builder, which cannot
take a `sql` fragment — that mismatch is why they were the two queries nobody scoped.

**Held by `review-scope.integration.test.ts`** — 11 tests, including that the count agrees with the
list for a scoped member, that `read_only` sees what an unscoped member sees, and that a `read_only`
write is refused as 403 rather than 404.

### O-sec-3 — An attacked address cannot sign in at all, and that is the per-IP ceiling

**Status:** **RESOLVED** 2026-08-20 — change approved and built, ceiling set to 300 by Bashar the
same day · **Severity:** High for the Syrian market · **Owner:** closed · **Recorded:** 2026-08-20
· **Measured by** scenario 4 of the load test

**What.** A legitimate customer with correct credentials, on the same egress address as an attack,
pacing themselves well inside their own per-account allowance, signed in **0 times out of 30**. The
cause is the per-IP `@Throttle({limit: 40, ttl: 60_000})` on `/auth/login`, which everybody behind one
address shares.

**This is not a regression.** Forty per IP on auth routes is the deliberate stuffing bound agreed with
Bashar on 2026-08-07 and recorded in §2. The finding is that the mitigation recorded under `O-sec-1`
closed the collateral damage in only ONE of the two limiters: keying the `account` throttler on
(IP, account) removed its share, and the per-IP ceiling still starves the address. Nobody had measured
it, because only load can — which is precisely what the plan said scenario 4 was for.

**The threshold is the problem, and this part is arithmetic, not a laptop measurement.** Forty a
minute is 0.67 a second. An attacker making ONE request a second — unremarkable in any log — consumes
sixty a minute and denies sign-in to that address about a third of the time; at two a second, two
thirds. Behind carrier-grade NAT, where thousands of Syrian subscribers share an address, that is live
availability risk.

**What the same run proves still works,** so the fix does not have to trade it away:

|                                          | Single source                  | Distributed (one address per attempt) |
| ---------------------------------------- | ------------------------------ | ------------------------------------- |
| Password checks reaching `AuthService`   | ~200 of 2,412,503              | 11,477 of 11,477                      |
| Accounts locked after five attempts      | 0 of 5,000 — nothing needed to | **40 of 40**                          |
| Bystander on an UNRELATED address        | —                              | **5 of 5**                            |
| Refusals generic (no enumeration oracle) | pass                           | pass                                  |
| 5xx                                      | 0                              | 0                                     |

**Recommended fix: count only FAILED sign-ins against the per-IP ceiling.** A stuffing run produces
failures; a legitimate customer produces a success. That keeps the bound exactly where it is.
Raising the ceiling instead weakens the bound; a CAPTCHA is new scope.

### APPROVED and BUILT, 2026-08-20

Bashar approved counting only failed sign-ins. Implemented as a REFUND rather than a deferred
count, because a throttler decides before the handler runs and "did this sign-in succeed" is only
knowable afterwards:

| Piece                             | What it does                                                                                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RedisThrottlerStorage.refund`    | One Lua script. Gives a hit back, never creates the key, never goes below zero, never touches the TTL or the block. Fails CLOSED — the opposite of `increment`       |
| `CodedThrottlerGuard.generateKey` | Records the key it is about to increment. Reconstructing a `sha256` over class, handler, throttler and tracker downstream would drift from the dependency in silence |
| `SignInRefundInterceptor`         | On `POST /auth/login` only. Refunds the per-IP hit on success, and on `auth.code_required` — the password was right and only the code is outstanding                 |

**Preserved, and each of them is asserted rather than argued:**

- **The account lockout is untouched.** Five failures locks the account for fifteen minutes, in
  `AuthService` against the user row. It is what stops a DISTRIBUTED attack, measured at 40 of 40.
- **The per-(IP, account) throttler is NEVER refunded.** Ten a minute still counts every attempt,
  successes included. That is what bounds the Argon2id verifications one address can force for one
  account — without it, anybody holding a single valid credential could drive password checks
  without limit. `sign-in-refund.integration.test.ts` asserts the account counter is untouched by a
  refund.
- **A refund cannot mint budget.** Not below zero, not on an expired window, not on another
  throttler, and not a way to lift a block.
- **A failed refund never fails the sign-in.** Detached from the response and caught — an unawaited
  rejection would terminate the process under Node's default.

**Held by 20 tests**: 9 unit (`sign-in-refund.interceptor.test.ts`), 5 against real Redis proving
the guard's key and the refund's key are the same (`sign-in-refund.integration.test.ts` — a
one-character drift would refund nothing and report success), and 8 storage properties
(`redis-throttler.storage.integration.test.ts`).

### What this does NOT fix, and the number that is still Bashar's

**The bystander is not yet safe, and the recommendation above overstated it.** "Makes the bystander
unreachable by it" does not follow from the change, and the same run's numbers say why: **2,412,273
of 2,412,503 attempts were 429s** — the attacker's traffic is FAILURES, and failures still count. An
attacker filling the ceiling with failures still starves the address, so scenario 4 re-run today
would still measure 0 of 30.

What the refund does deliver is real but different: **legitimate traffic no longer spends the
ceiling at all.** The NAT'd office of partners signing in at the start of a shift — the case that
moved this limit from 10 to 40 on 2026-08-07 — now costs nothing. The ceiling has become a pure
budget for FAILED sign-ins, which is what makes the remaining question answerable.

**The remaining question is the number.** At 40 a minute the budget is 0.67 failures a second, so
an attacker at ONE request a second still exhausts it. Arithmetic, not a measurement:

| Per-IP failure budget | Attacker rate needed to starve the address | Accounts a single address can drive to lockout, per minute |
| --------------------- | ------------------------------------------ | ---------------------------------------------------------- |
| 40/min (today)        | 0.67/s — unremarkable in any log           | 8                                                          |
| 120/min               | 2/s                                        | 24                                                         |
| **300/min**           | **5/s**                                    | **60**                                                     |

**Recommendation: 300 a minute — and Bashar chose it, 2026-08-20.** An attacker must sustain five
FAILED sign-ins a second from one address, 7.5× louder than what starved it in the measurement and
a trivially alertable signature. The cost is bounded and was measured rather than guessed: Argon2id
verify is **11.2 ms** at the configured parameters (19 MiB, t=2, p=1) on this hardware, ~250/s
throughput, so 5/s from one address is about 5 % of one machine's hashing capacity; memory is
bounded by the libuv threadpool rather than by the request rate.

**The accepted cost is the third column** — a single address can now drive 60 accounts to lockout a
minute rather than 8. That is a genuine trade and it is why the number was Bashar's. It is bounded
by the fact that a DISTRIBUTED attacker already bypasses the per-IP ceiling entirely (measured: 40
of 40 accounts locked, zero 429s), so what this slows is the single-source case — which is also the
case an edge rule blocks most easily.

`@Throttle({ default: { limit: 300, ttl: 60_000 } })` on `/auth/login`. `e2e/auth-throttle.spec.ts`
pins both halves: 300 wrong passwords are refused as wrong passwords and the 301st as too many
requests, and one failure plus three successful sign-ins charges the address twice rather than five
times — asserted through `X-RateLimit-Remaining`, so it is the real counter being read.

**The honest limit of the whole approach, and the one thing still outstanding.** A limiter keyed on
an address that strangers share cannot be both low enough to bound guessing and high enough to
protect a bystander. An attacker willing to be loud — five failed sign-ins a second — can still
starve an address. The answer to that residual is rate limiting at the EDGE, and it is now a
**required deliverable of `M-1`** rather than a note here: see `O-sec-5`.

### O-sec-10 — FIXED: two gaps in the emailed sign-in code, found by reviewing it

**Status:** **FIXED** 2026-08-20, before either shipped anywhere · **Severity:** one High, one
Medium · **Found by** a security pass over `O-sec-9` at Bashar's request

Both were introduced by the emailed-code work earlier the same day, and neither would have been
caught by a test that only asked "can a partner sign in".

**1 · The resend endpoint bypassed the account lockout. (High.)**
`POST /auth/login/resend-code` verifies a password and — by design, so it cannot be used to
enumerate accounts — answers `{ ok: true }` whatever the outcome. It did not count a failure. So it
was a password oracle the five-failure lockout could not see: an attacker could guess there for
ever while `/auth/login`, the route the lockout watches, stayed untouched. That control is the one
`docs/auth-rate-limiting.md` calls the heavy lifting against a targeted attack.

The original reasoning — "a resend button should not lock somebody out of their own account" — was
backwards. A legitimate resend is pressed from step two by somebody whose password has ALREADY been
accepted; a wrong password there is never a real partner. Failures now count, and a locked account
is issued no code. Held by two tests in `account-lockout.integration.test.ts`.

**2 · The same endpoint had `SignInRefundInterceptor` on it. (Medium.)**
The interceptor gives the per-IP hit back when a handler SUCCEEDS — and this handler succeeds every
time, including for a wrong password. That is the per-IP ceiling switched off on a route that
spends an Argon2id verify per call: one address could drive password checks across as many accounts
as it had addresses for, bounded only by the per-(IP, account) ten a minute. Removed, with a note
on the route saying why it must not come back.

**3 · The sign-in code was logged in clear where no SMTP is configured. (Also fixed.)**
`MailService` writes a whole mail body to the log when there is no transport, deliberately, so a
developer can follow the link inside it — safe for a link, not for a mail whose body IS the secret.
`partnerLoginCodeMail` now sets `sensitive: true`, the flag the two gift-card mails already use for
exactly this. Held by `mail.templates.test.ts`.

**What the same pass checked and found clean**, so the result is a statement rather than a shrug:
every `sql.raw` call site (all take literals or module constants; the one that takes a parameter is
regex-guarded AND passed literals by every caller); parameterisation of every new query;
the invitation token's lifecycle (hashed at rest, single-use and expiry checked in one atomic
`UPDATE`, purpose-scoped, one error code for every failure); the ordering of the sign-in checks (a
code is never emailed on a wrong password, a locked account or a suspended one); and that nothing
logs a code or a token.

### O-ops-3 — FIXED: two scheduled jobs shared an advisory lock, so one could skip in silence

**Status:** **FIXED** 2026-08-20 · **Severity:** Medium — invisible by construction · **Found by**
writing the runbook's job table while adding `credential-retention`

Every scheduler carries a comment reading "distinct advisory-lock key per job". Two of them said
`8_421_002`: `payout-accrual` and `booking-sla-sweep`.

`pg_try_advisory_lock` returns immediately rather than queueing, so the second job to ask did not
stall — it **skipped**, and recorded `skipped`, which is precisely the status `JobRunService`
documents as meaning "another replica did this one" and which alerting is therefore told to ignore.
The sweep runs every MINUTE and the accrual hourly, so across replicas the accrual could be skipped
at the top of an hour with nothing saying so until signal 1 fired two hours later — if the next
hour did not simply succeed and reset the clock.

**One process could never show it.** The `scheduled` queue runs at concurrency 1, so the two never
overlap in a single worker; it needs more than one replica, which is the production topology and
the one nobody is watching a debug log in.

Fixed by moving the sweep to `8_421_006`. The runbook now lists all seven jobs with their keys, and
the mechanism paragraph no longer claims they are `@Cron` decorators — untrue since the queue
landed.

### O-sec-11 — FIXED: dead credentials are swept nightly (closes `O-sec-6` too)

**Status:** **FIXED** 2026-08-20 · **Severity:** Low · **Owner:** closed

`login_codes` gained a row per partner sign-in attempt and `refresh_tokens` one per sign-in and per
rotation — every fifteen minutes, per active session — and nothing deleted a row from either.
Nothing was wrong: an expired token is refused on its expiry and a spent code is invisible to
`verify`. It was unbounded growth, which is the shape rule 2 exists to catch before it becomes
something worse.

`CredentialRetentionService` runs at **03:30** through the scheduled queue, batched at 5,000 like
`WebhookRetentionService`, and records a `scheduled_job_runs` row so alerting can see it stop.

**The predicate asks about LIFECYCLE, never about age alone**, and that is the whole safety of the
job. A session refreshed this morning on a token issued in January is a person who is signed in;
deleting it to save a few bytes signs them out — everybody at once, silently, at half past three in
the morning. Four of the nine tests assert the rows it must NOT touch.

**It is a retention job as much as a capacity one.** Both tables carry `ip_address` and
`user_agent` against a user id — personal data kept for a purpose (investigating account takeover),
which §14 says should stop being kept when the purpose has passed. **Seven days for spent codes,
ninety for dead tokens**, chosen for that reason and named as constants so blocker #6 changes one
line each. They are engineering defaults awaiting a policy answer, not the policy.

**`auth_tokens` is deliberately out of scope** — password resets, email verifications and partner
invitations are single-use and short-lived like the codes, but they are also the evidence that an
account was recovered. Pruning them belongs with the retention decision rather than ahead of it.

**And the other half of `O-sec-6` is closed too.** Ten concurrent sessions per account, oldest
retired on the eleventh sign-in (`MAX_CONCURRENT_SESSIONS` in `token.service.ts`, Bashar's call to
pick a number). A person with a phone, a laptop, a desktop and a tablet is at four; add a second
browser and a private window and they are at six. Ten leaves room and still bounds the tail. It is
a product judgement, not a security threshold — nothing breaks at eleven — so it is one named
constant.

The point is not the table. It is that every stale session — a shared machine, an old phone, a
browser somebody forgot — was a live way in for as long as its token lived, and nobody could see
it.

**Sessions are retired as FAMILIES**, ordered by when each STARTED. A family is one sign-in and
every rotation descended from it, so revoking a family ends a session while revoking a row would
end one fifteen-minute slice and leave the rest usable. Ordering by start rather than last use
retires a session that is merely old before one that is merely quiet — the alternative would retire
the tablet somebody uses monthly ahead of a browser an attacker refreshes hourly.

**A rotation is not a new session**, which is the assertion that matters most: `issue` runs on every
refresh, so counting those would retire somebody's oldest session four times an hour until only the
busiest survived. Four of the five tests in `session-cap.integration.test.ts` are about what the cap
must NOT touch.

### O-partner-8 — FIXED: the partner joining process could not be completed by anybody

**Status:** **FIXED** 2026-08-20 · **Severity:** **High** — the entire partner onboarding, dead ·
**Reported by:** Bashar, who accepted a partner and asked what to do next

**There was nothing to do next.** Accepting a partnership request creates the partner record,
leaves the applicant's account as a CUSTOMER account, and emails a link to `/invitation/{token}`.
Redeeming that token is the only thing that promotes the role — `acceptInvitation` sets the
password and the role in one statement.

**The endpoint existed and worked. The page the mail pointed at had never been built.** The portal
answered the link with a 307 to `/login`, and the sign-in refuses a customer account with «هذا
الحساب ليس حساب شريك». So every accepted partner was stranded, in silence, with a correct-looking
email in their inbox.

That is why every partner in the database came from the seed: the flow had never been walked end to
end by anyone, and nothing failed loudly enough to say so.

**Built:** `apps/partner/src/app/invitation/[token]/page.tsx`, `invitation-form.tsx`, the proxy
route at `api/auth/invitation`, Arabic copy, and `/invitation` added to the middleware's
`PUBLIC_PATHS`. That last part is the fix as much as the page is — the whole point of the page is
that the account cannot sign in yet, which is exactly why the middleware was bouncing it.

**Two deliberate choices.** The page never says whether a token is real, before or after
submission: a page that answers "expired" rather than "never existed" tells somebody probing links
which guesses were close. And success issues no session — the partner signs in normally, so one
code path mints partner sessions.

**Demonstrated end to end in a browser**, from the console accepting the request through the
invitation page, the first sign-in and the emailed code, to the dashboard.

### O-partner-9 — FIXED: accepting a fixture partner broke `db:testbed` for good

**Status:** **FIXED** 2026-08-20 · **Severity:** Medium — a developer-facing dead end · **Found by**
running the seed after Bashar accepted `customer@safra.test`

`partner_applications.partner_id` points at what a request became, so a testbed partner created by
ACCEPTING a request could not be deleted while the request survived. `db:testbed` died on
`DELETE FROM partners` with a truncated `Failed query` naming nothing useful, and stayed dead —
re-running it could not clear the row that was blocking it.

Anybody who accepted the seeded request in the console — which is the obvious thing to do when
testing the queue — could never seed again. The seed already anticipated that acceptance a few
lines further down, where it soft-deletes the partner a previous run created; this was the same
event, one foreign key earlier.

**Fixed** by deleting the requests that produced a testbed partner, and their logged calls, before
the partners themselves.

### O-sec-9 — Partners prove a code emailed at sign-in, not an authenticator

**Status:** **DONE** 2026-08-20, Bashar's decision · **Severity:** a posture change, recorded rather
than a defect · **Owner:** closed

**What.** Partner 2FA was mandatory TOTP enrolment (`O-partner-4`, 2026-08-07). Partners now prove
a **six-digit code emailed at every sign-in**; an authenticator is an upgrade they may choose.
Staff are unchanged. Full mechanics in `docs/auth-rate-limiting.md`.

**Why it was asked for:** to make joining simple. A hotel owner finishing onboarding should not
have to install an app first.

**The trade, accepted with the decision:** a mailbox is a weaker second factor than an
authenticator — whoever reads the partner's email can complete a sign-in — and a mail outage stops
every partner signing in, with no bypass by design, so it is an incident rather than a hole. Staff
were kept on TOTP because the console holds every registry, the ledger, payouts and emergency mode.

**Migration `0035`** created `login_codes` and cleared the authenticator from all **78** enrolled
partners in the same transaction. Nobody was locked out: the next sign-in emails a code.

**Three things this changed that were not obvious:**

- **`TwoFactorGuard` stopped holding partners**, and the portal's middleware stopped redirecting
  them to `/enrol-2fa`. Left in place either would have trapped every partner on an enrolment
  screen they were never asked to complete — the 78 whose enrolments the migration had just
  cleared most of all.
- **The seed stopped enrolling fixture partners.** Otherwise the browser suite would have kept
  exercising the TOTP form while the emailed-code form, which is what every partner meets, went
  untested.
- **The resend limit was retuned from 3-per-15-minutes to 5-per-5.** The counter cannot tell a
  resend from an ordinary sign-in, because both send a mail, so the first shape locked out anybody
  who signed in on a phone and then a laptop. The browser suite hit it on the first run.

**What `O-partner-4` said is now history rather than current** — it is left in place as the record
of the decision it described.

### O-ui-3 — FIXED: طلبات الشراكة lost its badge on the dashboard, and the audit log printed JSON

**Status:** **FIXED** 2026-08-20 · **Severity:** Low each, and both on screens a super admin uses
constantly · **Reported by:** Bashar

**The badge.** The dashboard renders `AdminSidebar` ITSELF, from the dashboard payload; the other
eighteen sections go through `ConsoleShell`, which fetches `/admin/attention`. Two builders for one
list of badges, and the dashboard's was missing `partnerApplications` — so طلبات الشراكة showed its
number everywhere except لوحة الإدارة, the screen a super admin opens first. Nothing failed: the
key was optional, so leaving it out was legal.

Fixed by adding `partner_applications_open` to the dashboard counters — **scoped**, like every
other counter in that query, because `partner_applications` carries a `city_id` and a badge
counting cities somebody cannot open is a number they can do nothing about.

**And the recurrence closed structurally:** `SidebarCounts` now REQUIRES every key. Optional keys
made "I have no number for this" and "I forgot this exists" the same expression; required ones
force the choice, the way `Field` does for `dir`. The type change immediately found a second
instance — see `O-ui-2`. `e2e/sidebar.spec.ts` asserts the two screens agree, because a type cannot
see that two sources produce the same VALUES.

**The audit payload.** سجل التدقيق rendered `JSON.stringify({ before, after })` on one line in an
`overflow-x-auto` box. In a column that narrow the reader met the middle of it —
`e":{"status":"contacted"},"after":…` — scrolled away from both ends, in a machine format, in the
column that is supposed to answer "what exactly changed".

Now a small `الحقل / قبل / بعد` grid: one line per field, values wrapped rather than scrolled,
`قبل` omitted entirely for a creation, and **fields whose two sides are equal dropped**. The module
note's rule that the payload is shown VERBATIM rather than summarised still holds — every field and
both values are there. What is gone is the JSON punctuation and the horizontal scroll.

Values are wrapped in `<bdi>`, not `Ltr`: they are arbitrary — a reference, an amount, an Arabic
address — and forcing `dir="ltr"` is right for `BKG-2026-074038` and wrong for «باب توما، دمشق».

**And then the words themselves, because the first version printed identifiers** (Bashar, same
day). The grid was readable and entirely in English: `status`, `basePrice`,
`confirmationWindowMinutes` under «الحقل», `pending_payment` under «قبل». `payloadKey` and
`payloadValue` already existed — built for the booking timeline — and held **eighteen keys and one
value** against the seventy-four keys and twenty-two codes the platform actually writes. The
resolution now lives in `payloadChanges` in `strings.ts`, beside `payloadEntries`, so the two
renderings of the same jsonb cannot drift into two vocabularies. Booleans read «نعم»/«لا» rather
than `true`/`false`.

**The value list is deliberate rather than merged from the status vocabularies**, and that is worth
recording: those disagree with each other ON PURPOSE — `active` is «نشطة» for a gift card and «نشط»
for a coupon, `rejected` is «مرفوض» in three maps and «مغلق — مرفوض» in disputes. A merged lookup
would print whichever map came first, which is how a screen ends up with the wrong agreement.

**Held by two new checks in `audit-catalogue.integration.test.ts`**, read from the DATABASE rather
than the source — a payload is built from a spread at several call sites, so grepping under-reports
what reaches the column. They pass over 26,141 real rows. The coded-value check matches only
lower snake_case, so a `reason` somebody typed still falls through as their own words.

**The entry in the screenshot was also a no-op**, and that half was mine: `markContacted` wrote
`before: {status: 'contacted'}, after: {status: 'contacted'}` on a second call, because the status
does not move twice. It now records the transition only when there IS one; the action itself is the
record of the call. The note is deliberately NOT copied into the audit log — free prose about a
named person, already stored, and `audit_log` is append-only and unredactable.

### O-web-6 — FIXED: every city page went empty at 17:00 Damascus and stayed empty

**Status:** **FIXED** 2026-08-20 · **Severity:** **High** — the browse surface, dark for seven
hours a day · **Found by** `customer-locale.spec.ts` failing for the first time in the evening

**What.** `/{locale}/city/{slug}` opens with a teaser search whose own comment reads "A
representative sample of what is bookable, **so the page is never empty**". It searched with
`checkIn = todayInDamascus()`. `booking.same_day_cutoff_hour` is **17**, and past it the search API
refuses an arrival of today — correctly, and with `firstBookableDate` attached.

`searchSafely` turns that refusal into `items: []` plus a notice. `/search` reads the notice and
tells the customer why. The city page did not: it rendered the empty list. So from 17:00 Damascus
until midnight, **every city page in the product showed no listings at all** — no error, no
explanation, just a city with nothing in it.

**Why nothing caught it for so long.** The whole suite has to run after 17:00 Damascus to see it,
and it never had. It failed today at 16:34 CEST — 17:34 in Damascus — on the first evening run.
That is the entire reason it surfaced, and it is worth stating: a bug that is invisible before
tea-time is invisible to every test schedule that finishes before tea-time.

**The fix.** When the teaser comes back refused, ask again for the first day that IS bookable —
using the date the API itself supplied, not arithmetic repeated in the web app over a setting it
does not read. One extra request, only after the cutoff. `/search` keeps the refusal and the
notice, which is right: a customer who TYPED today's date has to be told why it cannot be today.

**What this does NOT cover.** The home page builds property-type links with `checkIn=today`
(`page.tsx`), so after the cutoff those land on `/search` with a date the API will refuse. `/search`
handles it — it shows the notice and offers the first bookable date — so the customer is told
rather than shown an empty page. Worse than it should be, better than the city page was, and left
alone here because changing it means deciding what a category link should mean after hours.

### O-ui-2 — The الموظفون badge is declared and has never been produced

**Status:** open · **Severity:** Low · **Owner:** product, then engineering · **Recorded:**
2026-08-20, found by the type change in `O-ui-3`

`NAV` in `admin-sidebar.tsx` declares `badge: 'staff'` for الموظفون. Nothing has ever supplied the
number — not `/admin/attention`, not the dashboard payload — so the badge has never rendered, on
any screen, since the section was built. It went unnoticed for the same reason `O-ui-3` did: the
key was optional, so an absent count and an absent feature looked identical.

Making `SidebarCounts` require every key turned it into a line somebody has to write, and both
builders now say `staff: undefined` with a note pointing here.

**What is unresolved is the product question, not the query.** Every other badge counts a QUEUE —
something waiting on SAFRA, where the number is a backlog somebody works down. Staff is a registry,
not a queue. Candidates: accounts awaiting first sign-in, accounts locked out, accounts with no
second factor enrolled. "How many staff exist" is information, and the sidebar's own note says the
warn-coloured badges are for backlogs — so the honest options are to pick one of those meanings or
to drop `badge: 'staff'` from `NAV`.

**To unblock:** Bashar, on what the number should mean — or a decision to remove it.

### O-partner-7 — FIXED: a second telephone call used to erase the first one's note

**Status:** **FIXED** 2026-08-20 · **Severity:** Medium — silent data loss on a screen an operator
works from daily · **Reported by:** Bashar, from «سجل الطلب» on the request detail

**What.** `markContacted` was `UPDATE partner_applications SET … contact_notes = $1`. The note, the
timestamp and the name of whoever rang lived in three columns on the request row, so calling an
applicant a second time OVERWROTE all three. «سجل الطلب» could only ever draw one «تم الاتصال»
line, however many times somebody had rung, and the note that disappeared was usually the one that
explained why they were being rung again — "the commercial register is with the accountant" is
exactly the context that makes the follow-up call useful.

Nothing surfaced it: no error, no warning, and the screen looked correct because it had only ever
been asked to show one call.

**The fix.** A call is a repeating EVENT, so it is a row. `partner_application_contacts` —
append-only (`createdAt` only, this codebase's marker for a table nobody may amend), one row per
call, indexed on `(application_id, created_at)`. `markContacted` INSERTs, in a transaction with the
status change, and cannot touch an earlier row.

**The three columns are GONE, not left in step.** `contacted_at`, `contacted_by_user_id` and
`contact_notes` were dropped in `0034_oval_elektra.sql` and the registry's "most recent call" is
now derived from the call log by two SELECT-list subqueries — kept out of the shared `FROM … WHERE`
so the count is not made to pay for a value it does not use. A cached column would be a second
source of truth, and the version of it being replaced was the bug.

**The migration BACKFILLS before it drops.** The single surviving call on each request was real
data an operator wrote; it is carried into the new table with its original timestamp and author
first. Verified on the dev database: two rows preserved, including a note Bashar had typed while
testing.

**Held by** five integration tests — three calls produce three notes in order, each records its
caller, the registry reports the LATEST call, and a request nobody has rung reports no contact at
all rather than an empty string. Verified in a browser as well: the fixture request now renders two
«تم الاتصال» entries, each with its own date and note.

**Two things came out of doing it:**

- The testbed fixture dated its calls BEFORE the request arrived, because the requests were seeded
  at `now()` while the calls were back-dated. A fixture describing something impossible — which
  this seed is explicit elsewhere about refusing to do. Worked requests are now back-dated too.
- `contacts` is capped at 200 in the response (`MAX_CONTACTS_SHOWN`), because rule 2 forbids an
  unbounded list and nothing stops a staff account logging calls all afternoon. The newest are
  kept, and reaching the cap is logged rather than passed over in silence.

### O-sec-8 — The call log is append-only, and erasure has no answer for it

**Status:** open · **Severity:** Medium — a §14 / GDPR obligation, not a defect · **Owner:** Legal

- engineering, with blocker #6 · **Recorded:** 2026-08-20, during `O-partner-7`'s security pass

`partner_application_contacts` carries `createdAt` and nothing else — no `deletedAt` — because a
call log that can be amended is not a log. That is the right shape for the defect it fixes and it
collides with the right to erasure: the rows are staff prose ABOUT a named applicant, attached by
foreign key to a request that carries their name, address, telephone number and email.

`partner_applications` is soft-deletable, so erasing an applicant today leaves their call notes
behind, reachable by anybody who can read the table.

**This is not new and it is not only this table** — `audit_log` is append-only by trigger and holds
the same tension, deliberately. What is new is one more place that has to appear in the retention
and erasure reconciliation, and it is better recorded now than discovered during it.

**A SECOND table joined it on 2026-08-25.** `booking_internal_notes` is the same shape for the same
reason: staff prose, append-only, attached by foreign key to a record carrying a named customer's
address and telephone number. It is enforced harder than the call log — a `deny_mutation` trigger
refuses UPDATE, DELETE and TRUNCATE, where `partner_application_contacts` is append-only by
convention alone and is in no trigger list. Both belong in the same reconciliation and both take the
same answer: **redaction in place**, keeping that a note was written and when, is the shape that
preserves the log's purpose. The note text deliberately never reaches `audit_log`, so redacting one
table is sufficient — that is what `booking-notes.integration.test.ts` walks the whole audit row to
prove.

**To unblock:** blocker #6. The engineering question that follows the legal answer is narrow —
whether erasure REDACTS the note text in place (keeping the fact that a call happened, and when)
or removes the row. Redaction is the shape that preserves the log's purpose, and it is a mutation
an append-only table has to be given deliberately rather than by adding `deletedAt`.

### O-sec-5 — The per-IP residual belongs at the edge, and `M-1` owns it

**Status:** open, blocked on `M-1` · **Severity:** Medium · **Owner:** whoever does `M-1` ·
**Recorded:** 2026-08-20

`O-sec-3` moved the per-IP ceiling to 300 failed sign-ins a minute, which raises the rate an
attacker must sustain to starve a shared address from 0.67/s to 5/s. It does not remove the
property, and no in-application limiter can: the application sees one address and cannot tell two
strangers behind it apart.

**What closes it:** a rate-limit rule on `POST /auth/login` at the CDN or WAF, above the
application — where a request can be dropped before it costs a process anything, and where the
provider's own reputation and challenge signals are available. It is the same control the
application is emulating, applied at the layer that can actually afford it.

**Why it is `M-1`'s and not schedulable now:** there is no edge until a provider and region are
chosen. Recorded here so the hosting work inherits it rather than rediscovering it, and so
`O-sec-3` is not left reading as though the problem were fully solved.

**One thing WAS fixed, because it was a defect rather than a trade-off.** `accountTracker` read
`x-forwarded-for` and took the left-most entry — the value a client writes, since a proxy appends.
Sixteen of sixteen attempts bypassed the per-account limit under the header shape a correct single
proxy produces, and forging the header to somebody else's address spent THEIR budget, reintroducing
the targeted lockout the file's own header says it eliminated. Now `req.ip`, which Express computes
under `trust proxy`. See `O-sec-1` and the results document, F-11.

### O-sec-6 — Closed: swept, capped, and the cap's test can now see what it retires

**Status:** **CLOSED** — both halves built and tested; the suite made discriminating 2026-08-25 ·
**Severity:** Low ·
**Owner:** engineering · **Recorded:** 2026-08-20, during `O-sec-3`'s security pass ·
**Corrected:** 2026-08-25

**This entry described the world as it was on 2026-08-20 and was still doing so on 2026-08-25**,
five days after both halves were built. Read as written it would send somebody to build a nightly
sweep that already runs and a session cap that already holds. `O-sec-11` recorded BOTH halves correctly — its
heading says it "closes `O-sec-6` too" and its body names `MAX_CONCURRENT_SESSIONS` — and none of it
was ever carried down to here, or to §1a, or to `docs/launch-readiness.md`. The register's own rule
is that a resolved item moves to §10 with a date; this one stayed put in three places while the
entry that closed it sat two hundred lines above.

What is actually true, verified against the code on 2026-08-25:

| Half      | Where                                                                                                                                                      | State                                                                                             |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| The sweep | `CredentialRetentionService.pruneRefreshTokens` — `revoked_at IS NOT NULL OR expires_at <= now()`, older than `REFRESH_TOKEN_RETENTION_DAYS` (90), batched | **Built and TESTED** (`credential-retention.integration.test.ts`), running nightly at 03:30       |
| The cap   | `TokenService.retireOldestSessions` — `MAX_CONCURRENT_SESSIONS` (10), newest kept                                                                          | **Built and TESTED** (`session-cap.integration.test.ts`, five cases from the day the cap shipped) |

**Corrected again on 2026-08-25, and this correction is the useful part.** The row above read
"Built, and under NO test", which was WRONG — `session-cap.integration.test.ts` shipped with the cap
and holds five cases. The claim came from grepping test files for `retireOldestSessions` and
`MAX_CONCURRENT_SESSIONS`; the suite exercises the cap through `issue()` and names neither, so the
search missed it. **A grep for a symbol is not a search for a behaviour**, and reporting "no
coverage" on that basis pointed Bashar's priorities at something already done.

**What WAS wrong is subtler and worse, and mutation testing found it.** Four of the five cases could
not fail:

| Mutation                                                                                                                                                  | Before 2026-08-25  | Now                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ---------------------------------- |
| Retire the NEWEST family rather than the oldest — signing somebody out at the instant they sign in, which the third case's docblock calls "THE assertion" | **all five green** | fails                              |
| Remove the cap entirely                                                                                                                                   | one case fails     | two fail                           |
| Drop the `isNewSession` guard                                                                                                                             | all five green     | still green — correctly, see below |

**The cause is a trap this repository had already written down.** `created_at` defaults to `now()`,
`now()` is the TRANSACTION timestamp, and the suite runs inside one rollback transaction — so every
row it wrote carried the identical instant, `ORDER BY min(created_at)` over ties is arbitrary, and no
assertion about WHICH session was retired could bite. `.claude/CLAUDE.md` records exactly this under
"`now()` is the TRANSACTION timestamp, so rows written in one test all tie". The suite now ages the
existing rows by a minute after each sign-in, so the ordering is real, and asserts the surviving
FAMILY IDS rather than their count. Two cases added, seven in total.

**And one guard turned out to be defensive rather than load-bearing.** Dropping `isNewSession` leaves
every assertion green even with the ordering observable — because `retireOldestSessions` offsets over
FAMILIES and a rotation adds a row to an existing family, never a family, so there is never anything
past the cap for it to find. The comment in `token.service.ts` claimed it prevented "retiring a
session every fifteen minutes for anybody signed in"; it does not, and it now says what it really is
— a saved `UPDATE` per refresh per session, and clarity. A comment that overstates a guard is how the
next person concludes a test exists that does not.

**The original finding, kept because it is why the two halves exist:**

Every successful sign-in inserted a row into `refresh_tokens` and **nothing ever deleted one**.
There was no scheduled sweep of expired or revoked rows, and no cap on concurrent sessions per
account. The table therefore grew monotonically with sign-ins, for ever, and rule 2 forbids
exactly that shape.

**Why it surfaced now.** `O-sec-3` changed what bounds the insert rate from ONE address. It used to
be the per-IP ceiling — 40 logins a minute whatever the accounts. It is now the per-(IP, account)
throttler, because a success no longer spends the per-IP budget: 10 a minute per credential held.
For a caller holding one valid credential that is **stricter** than before (14,400 rows a day
rather than 57,600); it only becomes looser above six credentials from one address, which is a
caller who has bigger levers than a growing table. So this is not a regression — but it is the
question `O-sec-3` made worth asking, and the answer was "nothing bounds it at all", which is worth
recording whichever way the arithmetic went.

**What closes it:** a nightly job deleting rows past `expiresAt` (and revoked rows past a retention
window — they are forensic evidence for a while, not for ever), plus a decision on whether an
account may hold unlimited concurrent sessions. `JobRunService.runExclusively` and the existing
scheduler are the mechanism; this is one more job, not new infrastructure.

**To unblock:** nothing external. It needs a retention answer, which is a §14/GDPR question as much
as a capacity one — `ipAddress` and `userAgent` are stored on every row.

### O-sec-7 — A failed query's BOUND PARAMETERS reach the logs, and one path writes them to a table

**Status:** open — one instance fixed, the sweep is not done · **Severity:** **High** (§14 / GDPR:
personal data in logs, and in one case at rest) · **Owner:** engineering · **Recorded:** 2026-08-20,
found live while proving `O-api-1`'s 503 path

**What.** `drizzle-orm@0.45.2` builds `DrizzleQueryError`'s message as

```
Failed query: <sql>
params: <the bound VALUES>
```

— the values, not the placeholders (`drizzle-orm/errors.js`, `DrizzleQueryError`). Any code that
logs `error.message` from a database failure therefore writes them out. **Verified against the
running API on 2026-08-20**, not inferred: a failing sign-in produced
`params: someone@safra.test,1`. On the paths that write a `users` row the same line carries the
**Argon2id hash** and the **encrypted TOTP secret** — the exact values `JsonLogger`'s
`REDACTED_KEYS` exists to stop, which it cannot see here because redaction works on object KEYS and
this is one flat string. The stack re-introduces it too: `Error.prototype.stack` begins with
`name: message`.

**Fixed in one place.** `AppExceptionFilter` logs the SQL and replaces the values with a count —
`— 2 bound parameter(s), NOT logged` — and logs only the stack FRAMES. Re-verified live: the
address appears zero times in the log. `safeMessage` and `framesOnly` in
`apps/api/src/common/errors/app-exception.filter.ts` are the shape the fix takes and should be
lifted into a shared module when the sweep happens.

**Not fixed: 25 other files log a raw `error.message`.** The ones on paths a database error reaches
are what matter — `job-run.service.ts`, `audit.service.ts`, `sla.service.ts`, `booking-state.ts`,
`payment-webhook.service.ts`, `export-request.service.ts`, `property-images.service.ts`, and the
four queue processors.

**One of them is worse than a log line.** `JobRunService.runExclusively` writes the raw message into
**`scheduled_job_runs.error`** — a database column, read by the staff console and by alerting. So a
failing scheduled query puts bound parameters at rest and on screen, not merely in a log stream
somebody could rotate. That is the instance to fix first.

**To unblock:** nothing external. The work is one shared helper plus 25 call sites, and a decision
on whether `scheduled_job_runs.error` should be truncated or structured rather than free text.

### O-api-1 — Pool exhaustion answers 500, and a 500 carries no code

**Status:** approved by Bashar and **RESOLVED** 2026-08-20 · **Severity:** Medium · **Owner:**
engineering · **Recorded:** 2026-08-20

**What.** Under scenario 2's deliberate concentration — 200 concurrent booking transactions against 20
units, each holding a pool connection while it waits on a row lock held by another — the pool of
`DATABASE_POOL_MAX=20` is exhausted and `connectionTimeoutMillis` fires. 1,680 of 12,231 requests
answered **500**. A lock queue becomes a connection queue, which is inherent: the exclusion constraint
IS the reservation mechanism, deliberately.

**Why it matters even though the concentration is artificial.** 500 is the wrong answer for a capacity
condition — unretryable to a client, and it will page whoever owns the 5xx signal in
`docs/alerting.md` for something that is load rather than breakage. A coded **503 with `Retry-After`**
is the honest answer.

**Verified sound while measuring it:** the body is generic — `{"statusCode":500,"message":"Internal
server error"}` — with no SQL, no parameters and no guest email. Rule 1 holds.

**Second, smaller half:** a 500 carries no error `code`, although `request.unknown` exists and is
translated in all three locales. A client cannot render it in the reader's language.

**Why it was not fixed in the load-test pass:** both halves want one global exception filter, and that
touches every error response the API produces. That is deliberate work with its own verification, not
a side effect. **To unblock:** nothing external — it is scheduling.

### RESOLVED, 2026-08-20 — `AppExceptionFilter`

Registered globally in `app.module.ts`, and it is the only thing that shapes an error the
application did not raise deliberately.

| Condition                                                                                                                           | Answer                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| The request never reached the database — `pg-pool` acquisition or connect timeout; SQLSTATE `53300`/`53400`/`57P03`/`08001`/`08004` | **503**, `code: request.capacity`, `Retry-After` jittered over **1–5 s** |
| Any other unhandled error                                                                                                           | **500**, `code: request.unknown` — the second half of this item          |
| Any `HttpException`                                                                                                                 | **Unchanged, byte for byte**                                             |

**The 503 set is deliberately narrow, and that is the security argument.** `Retry-After` is an
INSTRUCTION to send the request again, and this API accepts non-idempotent writes — telling a
client to repeat a booking that may already exist is worse than the 500 it replaces. So only
conditions where no statement was ever written to a socket qualify. A statement timeout (`57014`),
a deadlock (`40P01`), a full disk (`53100`), an out-of-memory (`53200`) and an outright
`ECONNREFUSED` all stay **500**: they are ambiguous about what happened, or they are breakage that
must page.

**The jitter is not decoration.** A fixed `Retry-After` synchronises everybody refused in the same
instant into one retry, and the second wave exhausts the pool on schedule.

**`HttpException` passes through untouched** on purpose. Every deliberate refusal is built by
`app-error.ts` and already carries a code; re-shaping the few that do not would change response
bodies this filter has no mandate to change. Those are recorded separately as `O-api-2`.

**Monitoring, and the rules this changes** — full detail in `docs/alerting.md`, new section
"Capacity refusals":

- **Signal 12 (error rate) now EXCLUDES `request.capacity`** and must be edited before it is armed,
  or it pages for load. New **12b** (ticket at >1 % over 5 min) and **12c** (page at >5 %) count
  capacity separately.
- **The access log carries the error code**, and logs a capacity 503 at `warn` rather than `error`,
  so a level-based rule does not page either.
- **Status alone is not the discriminator** — 503 is already the answer for `auth.unavailable`,
  `pricing.unavailable` and `payment.unavailable`. Match on the CODE.
- **Signal 13 (latency) interacts**: a refused request is FAST, so pool exhaustion IMPROVES p95. A
  platform refusing a third of its traffic can post healthier latency than one serving all of it.
  12b is what finds that; latency will not.
- Nothing new to build — it comes from the log stream that already exists.

**Held by 17 tests** in `app-exception.filter.test.ts`, including that the body leaks no SQL and no
address, that `Retry-After` is spread, and that the excluded conditions stay 500.

### O-api-2 — RESOLVED: every refusal answers a code

**Status:** **RESOLVED 2026-08-25** — five codes, fifteen translations, and a sweep that holds the
class at zero · **Severity:** was Low–Medium · **Owner:** closed · **Recorded:** 2026-08-20 ·
**Amended:** 2026-08-20 (still seven, different seven)

**The seven turned out to be five**, and finding that out first is why this was an hour rather than a
day. Two of the listed items needed no work:

- **`staff.service.ts` was already done.** It throws `badRequest(ERROR.STAFF_LAST_SUPER_ADMIN)`, and
  the comment beside it records the change — "It also used to throw an English SENTENCE, which the
  project's own rule forbids". Fixed on 2026-08-23 and never struck from this list.
- **`metrics.controller.ts` ×2 is a DECIDED exception, not an omission.** Both are
  `new NotFoundException()` with no argument: the 404 is deliberate camouflage, identical whether the
  bearer token is absent or wrong, so a prober cannot learn the endpoint exists. There is no sentence
  to translate — the body is Nest's own `{"message":"Not Found"}` — and giving it a code would tell
  the prober precisely what withholding one denies them. A Prometheus scraper reads status codes.

**The five, and what each answers now:**

| Was                                                                                     | Now                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wallet.service.ts` — «Wallet balance is X USD, which is less than the Y USD requested» | `wallet.balance_below_amount`, with `balance`, `currency` and `requested` in `params`. **The only one a paying customer meets.** The figures stay — "insufficient balance" with no numbers opens a support ticket instead of closing one — but as VALUES, so a translator puts them where their grammar wants them. Distinct from `wallet.insufficient_balance`, which the gift-card paths raise without figures                                        |
| `two-factor.guard.ts` — «…Enrol at /auth/2fa/setup before using this endpoint»          | `auth.two_factor_enrolment_required`. Reached by **every unenrolled staff member and partner**. The remedy is still named; the PATH is deliberately dropped — that is this API's route, and the console and portal each enrol at their own URL, so naming ours sent people somewhere they do not enrol                                                                                                                                                  |
| `settings-admin.service.ts` ×2                                                          | `setting.value_not_positive_money` and `setting.schema_not_editable`, with the key and the schema name as `params`                                                                                                                                                                                                                                                                                                                                      |
| `sanctions.service.ts` — two sentences, for `missing` and for `stale`                   | `sanctions.list_unavailable`, **one code for both**, as the plan required. The two sentences told any caller who could reach the endpoint whether SAFRA has ever imported a list and how old it is — the platform's compliance posture in a readable body. Staff keep the distinction where it belongs, in `GET /admin/sanctions/status`, which is what the console's `ScreeningPanel` renders; `reason` stays a property for the log and that endpoint |

**Two tests had to be re-pointed, and that is the finding worth keeping.** Six assertions matched the
English prose — `toThrow(/no sanctions list/i)`, `toThrow(/cannot validate/i)`. **A test pinned to a
message asserts the wording rather than the behaviour, and it is what makes the wording hard to
remove.** They now assert the code, and the sanctions ones assert `reason` too, so the
missing-versus-stale distinction they were really checking is still checked.

**The class is held at zero.** `no-english-refusals.test.ts` sweeps every production file in the API
for a NestJS exception constructed with a string or template literal. There were no survivors, so it
asserts an empty array rather than carrying an allow-list — an allow-list here would be a place to
add the eighth. `safra/no-hardcoded-text` could never see these: the prose is an argument to a
constructor rather than JSX, which is how seven of them passed every `pnpm lint` since that rule
shipped.

Found while scoping `O-api-1`'s filter and deliberately NOT fixed there — the filter's mandate was
the errors that were not `HttpException`s, and quietly re-shaping these would have changed response
bodies under cover of a different change.

Each throws an `HttpException` with a hand-written English string, so a client cannot resolve it
into the reader's language. This is the standing i18n rule ("the API answers with an error CODE, not
a sentence"), and `safra/no-hardcoded-text` cannot see them because the prose is an argument to a
constructor.

| File                           | Reaches                                          |
| ------------------------------ | ------------------------------------------------ |
| `wallet.service.ts:203`        | **A customer** — an insufficient-balance 409     |
| `rbac/two-factor.guard.ts:88`  | **Staff and partners** — the enrolment 403       |
| `settings-admin.service.ts` ×2 | Staff — the settings editor's two refusals       |
| `staff.service.ts:450`         | Staff — "this is the last active super admin"    |
| `metrics.controller.ts` ×2     | A scraper. Harmless, and listed for completeness |
| `sanctions.service.ts:94`      | Staff — the screening 503, both reasons          |

**Amended 2026-08-20.** One closed and one added, so the count is unchanged and the list is not.

- **Closed:** `admin.controller.ts:207`, the sanctions import. Its body validation moved to
  `sanctionsImportSchema` while the `local_fixture` source was being added, so the two refusals it
  can now give are `validation.sanctions_body_too_small` and `validation.sanctions_source`, both
  with ar/en/de entries. Done there rather than deferred because the endpoint's validation was
  being rewritten anyway — leaving a hand-written English string in code that was being replaced
  would have been a decision to keep it.
- **Added:** `SanctionsListUnavailableError` in `sanctions.service.ts:94`, which answers a 503 with
  "No sanctions list has been imported…" or "…older than the 7-day limit". Found while verifying
  that a fixture is refused. It was missing from the original seven. **Severity: Low** — the
  console's `ScreeningPanel` renders the list's own state from `GET /admin/sanctions/status` and
  never offers the button when the list is unusable, so a reviewer does not normally see this
  body; it reaches a direct API caller.

**The work:** one error code each, three translations each, and for the wallet one the balance and
currency must travel in `params` rather than in the sentence — the same shape the arrival-date fix
used on 2026-08-20. For the sanctions 503 the two reasons must stay ONE code — `missing` and
`stale` are already deliberately distinguished to staff and not to anyone else. **To unblock:**
nothing external.

### O-emp-2 — «عرض المزيد» on the employees list has no browser coverage

**Status:** open · **Severity:** Low · **Owner:** engineering · **Recorded:** 2026-08-23 ·
**Narrowed:** 2026-08-23

Originally four gaps. Three are now closed: `e2e/partner-employees.spec.ts` drives **suspend,
restore and remove** through the browser, including the confirmation dialogue — which proves the
control is wired to the request rather than merely rendered, since an unhandled dialogue blocks the
click and the row simply stays.

**What remains is the pager, and it SKIPS rather than fails.** The employees list pages at twenty
and the fixture partner has four employees, so the test guards itself:

```
- pages to a second page that is not the first one again   [skipped]
```

The skip names its reason, which is the honest state — but a skip is not a pass, and «عرض المزيد»
has never rendered in a browser.

**Why it is not simply fixed by inviting twenty people.** Each invitation is a real employment that
no run can tidy up: `O-e2e-3`. Worse than a dispute, because an employment somebody holds cannot be
deleted at all — the API refuses to remove a role in use and an employee's account is a person's
account. A spec that created twenty per run would grow the fixture without bound and slow every
later run walking the list it created.

**The work:** either seed a partner with enough employees once, as a fixture the suite owns rather
than something a test writes, or accept the skip permanently and verify the pager by hand at
release. The first is better and is the same shape `O-e2e-4` needs for the count cap, so the two
should probably be solved together. **To unblock:** nothing external.

### O-sec-13 — staff scope has never been swept; the coverage claim has been wrong twice

**Status:** open · **Severity:** Medium · **Owner:** engineering · **Recorded:** 2026-08-23

§4 of this register records staff scope as enforced "across 9 registries, the dashboard, all
reports, the finance ledger and the export" (2026-08-04). **That completeness claim has since been
falsified twice, by accident both times.**

- **2026-08-20** — `review.service.ts` was missed entirely. A city-scoped operations manager could
  see every partner in the country awaiting verification and APPROVE OR REJECT any of them. `O-sec-4`.
- **2026-08-23** — `partner-contract.service.ts` was missed entirely: not one of its methods called
  `scopeFilter` or `assertCanWrite`. Reproduced, not theorised — a manager scoped to one city filed
  a SAFRA signed copy and a JOINT signed copy against a `pending` partner in another. The joint path
  had made it materially worse: it writes a `partner` signature row, so the same out-of-scope reach
  went from "acts on the wrong contract" to "manufactures a signature and puts an agreement in
  force", in one request. Partner references are sequential, so finding a target was a loop rather
  than a guess.

**Why both were found by accident rather than by a check.** `scope.sql.ts` warns in its own comment
that duplicating the predicate per service is how a scope ends up "enforced on eight resources and
forgotten on the ninth". It was right twice. There is no test that iterates `SCOPED_RESOURCES` and
asserts each one is actually scoped — the enforcement tests that exist
(`review-scope.integration.test.ts`, `partner-contract-scope.integration.test.ts`) were each written
AFTER a gap was found, and each covers only the service that was found.

**So the honest position is that scope coverage is unknown**, not complete. Every service that
touches a city-bearing resource is a candidate, and `SCOPED_RESOURCES` already names them:
`bookings`, `partners`, `properties`, `disputes`, `conversations`, `ad_campaigns`, `dashboard`,
`reports`, `finance`. Sub-resources inherit a city through a join and are the easiest to miss —
a partner contract has no city of its own.

**The work:** a systematic pass over every admin-facing service, and then a test that makes the
claim checkable rather than remembered — the shape `employee-reach.test.ts` uses for the employee
boundary would transfer, reading route metadata and failing when a scoped resource's handler has no
scope enforcement behind it. Until that exists, §4's line should be read as "scoped where somebody
looked". **To unblock:** nothing external.

### O-sec-14 — Closed: enrolling in 2FA now issues the session it invalidates

**Status:** resolved 2026-08-24 · **Severity:** Medium · **Owner:** engineering · **Recorded:** 2026-08-24

**Reproduced in a browser, not theorised.** A staff member completing two-factor enrolment presses
«حفظتها — متابعة» and nothing happens. They stay on the recovery-code screen, and every navigation
returns them to `/enrol-2fa`, until the access token runs down or they sign out and in again.

The chain, all of it verified in the source:

- `POST /auth/2fa/enable` writes `totp_enabled_at` and returns `{ enabled, recoveryCodes }` —
  **no new token** (`two-factor.controller.ts:53`, `two-factor.service.ts:106`).
- The middleware decides with `hasTwoFactor(session)`, which reads the `totpEnabled` CLAIM off the
  access token (`packages/session/src/session.ts:229`), signed at sign-in and still `false`.
- `rotateIfStale` refreshes only when the token is near expiry (`apps/admin/src/middleware.ts:187`,
  `needsRefresh` = within 30s of expiry). `ACCESS_TOKEN_TTL` defaults to **15m**, so the stale claim
  survives up to ~15 minutes.
- So `router.push('/')` is bounced by `route()` back to `/enrol-2fa`
  (`apps/admin/src/middleware.ts:135-139`), and the client re-renders the same screen.

**It is in BOTH apps.** `apps/admin/src/components/two-factor-enrolment.tsx:124` and
`apps/partner/src/components/two-factor-enrolment.tsx:143` carry the same `router.refresh();
router.push('/')`, under a comment that says "the new token carries totpEnabled" — which is what the
code intends and not what it does. It affects every new staff member and every new partner, on the
first thing they are asked to do.

**Not a security hole:** it fails CLOSED. It denies access to somebody who should now have it; it
grants nothing. That is why it is Medium and not High.

**Found by** `e2e/console-role-gating.spec.ts`, whose narrow account had to enrol before it could be
signed in as. That spec now clears its cookies and signs in a second time, with a comment naming
this item — **the workaround must not be quietly deleted before the bug is fixed**, or the spec goes
red for a reason that has nothing to do with the gating it tests.

**The work.** `token.service.ts:546` shows the refresh path already rebuilds claims from the
database row (`buildClaims` → `totpEnabled: user.totpEnabledAt !== null`), so a refresh would carry
the corrected claim. Two candidate fixes:

1. **Have `enable` issue the new session** — the act that changes the claim also issues the claim.
   Cleanest semantically; changes an API response shape and the BFF route that proxies it.
2. **Refresh before refusing** — in each middleware, when the session says un-enrolled, refresh once
   and re-check before redirecting. Self-healing and no contract change; costs one refresh per
   request while un-enrolled, which is bounded because an un-enrolled reader can reach only
   `/enrol-2fa`.

Prefer (1); (2) is the contained fallback if the API surface must stay fixed. Either needs a test
that signs in, enrols, and asserts the very next navigation lands somewhere other than `/enrol-2fa`
— the gap is precisely that nothing exercised the transition, because every other spec signs in as
an account that was already enrolled.

**Fixed 2026-08-24, by option (1), and it was worse than first written up.** `enable` also calls
`revokeAllForUser` — deliberately, since any session predating the second factor was established
under weaker authentication — and that includes the CALLER'S OWN. So the reader was not merely
stuck for fifteen minutes: when the access token expired the refresh token was already dead, and
they were signed out rather than corrected. `POST /auth/2fa/enable` now returns `session` beside
`enabled` and `recoveryCodes`, minted AFTER the revocation with claims rebuilt from the row it just
wrote, and both BFF routes write it to the cookie; the user blob comes from the cookie already in
the jar, since enrolling changes an account's authentication and nothing about who they are.
`partner-two-factor.integration.test.ts` walks the transition and asserts the replacement was
minted for the account that enrolled — a session issued for somebody else would satisfy "a session
came back" perfectly.

**Confirmed end to end by the spec that found it.** `e2e/console-role-gating.spec.ts` had carried a
clear-cookies-and-sign-in-again workaround; it was REMOVED and the account reset to un-enrolled so
the enrolment branch actually ran. The narrow reader enrolled and went straight on to `/audit` —
the exact navigation that used to bounce — and all four tests passed. Verified the run really did
enrol rather than skip: `totp_enabled_at` and eight recovery codes written during that run. Note
for anyone deploying: the fix is in `dist`/`.next` only after a rebuild AND a restart, and the
standalone apps need `.next/static` and `public` copied into `.next/standalone/apps/<app>/` or the
console serves HTML with no CSS or JS.

### O-e2e-4 — a spec cannot address "the last page" once a table passes COUNT_CAP

**Status:** open · **Severity:** Low · **Owner:** engineering · **Recorded:** 2026-08-23

`pagination.spec.ts:378` («the step arrows › next is absent on the last page») started failing on
2026-08-23 and the product was behaving exactly as `.claude/CLAUDE.md` specifies.

**What happened.** `customer_profiles` crossed the count cap — 10,198 live rows against a
`COUNT_CAP` of 10,000. Past the cap the bar prints «أكثر من ١٠٠٠٠ نتيجة» and the page count is a
FLOOR rather than a total, so the spec walked to page 100 of a list the bar described as 102 pages,
found a next arrow, and reported it as a defect. The count cap is deliberate: an uncapped
`count(*)` is unbounded work on every page view of an ever-growing table, which rule 2 forbids.

**The general fact, which is not about this one spec.** Any test that derives "the last page" from
the pagination bar breaks once its table passes the cap, because **past the cap there is no way to
ADDRESS the last page** — the bar is telling the truth and the truth is a lower bound.
`customer_profiles` got there first because the load-test fixtures live in the same database; every
registry in this console eventually will.

**How it is handled today.** `project-e9` guarded the assertion with a `test.skip` when the total is
capped, rather than weakening it to assert something that still passes. That was the right call —
an assertion adapted until it goes green is one that has stopped checking anything — but it means
the last-page behaviour is unverified on any table past the cap, which is the case that most needs
it.

**The work:** decide between a small filtered fixture set the spec can own (a query narrow enough
that its total stays under the cap, so a real last page exists and is addressable) and accepting
the skip permanently. **To unblock:** nothing external. Whoever hits this on a second registry
should find this entry rather than rediscover the cap.

### O-emp-1 — an employment can stop being live without anything putting the account back

**Status:** open · **Severity:** Medium · **Owner:** engineering · **Recorded:** 2026-08-23

Activating an employee invitation sets `users.role = 'partner_employee'`, and `remove()` is what
puts it back to `customer` when a job ends. That closes the path a partner takes deliberately.

**It is not the only path an employment stops being live.** `attachOwningIds` resolves an employee
through a join that also requires the employer to be neither deleted nor suspended, the role not
withdrawn, and the employment `active` and not deleted. Any of those can change WITHOUT
`remove()` running — a partner soft-deleted, a role withdrawn from the catalogue, a data fix. The
account is then `partner_employee` with nothing to resolve: `ROLE_PERMISSIONS.partner_employee` is
deliberately empty and there is no role row left to intersect, so it carries no permissions and no
partner id.

**The result is an account that can sign in and do nothing at all, and no endpoint reverses it.**
The customer profile is reachable again — `customerProfileId` resolves whenever a profile exists,
regardless of role — but a profile nobody holds permission to read is not access.

**Narrower than the defect it is left over from.** The original needed only the invitee's own click;
this needs a staff or partner action against the employer or the role, so it is not reachable by an
outsider. It is still a real way for a person to lose their account as a side effect of something
done to somebody else.

**Why it is not fixed by inferring the answer at read time.** The obvious repair — no live
employment, therefore resolve the customer permission set — was written and reverted the same day.
It made five correct assertions fail at once: a suspended employment, a removed employment, a
withdrawn role, a soft-deleted partner and a suspended partner must each yield nothing, and a
fallback keyed on a MISSING row cannot tell those apart from a finished job. Granting authority
because a row is absent is the same shape as the `readFile` scope bypass found hours earlier, where
a missing row skipped a guard instead of failing it. The truth belongs where it is written.

**The work:** either an endpoint that restores an account whose employment can no longer be live, or
a reconciliation job that reverts the role for exactly those accounts — plus deciding whether
withdrawing a role or deleting a partner should cascade into `remove()` at the point it happens,
which would make this unreachable rather than merely repairable. **To unblock:** nothing external.

### O-e2e-3 — the e2e suite accumulates fixture data it cannot tidy up

**Status:** open · **Severity:** Medium · **Owner:** engineering · **Recorded:** 2026-08-23

The remaining half of **O-e2e-2**, which was resolved the same day. That failure was a race in the
spec, but the reason the race became reachable is that the dispute list grew past one page: every
run of the suite raises a dispute on `customer@safra.test` and nothing removes it. It stood at 21
when the timeout was diagnosed and 22 after the run that confirmed the fix.

**Why a spec cannot tidy up after itself here.** A dispute is a record, and one live dispute is
allowed per booking per reason — so the spec must pick a pair no earlier run has spent, which is
precisely the walk that became the failure. Deleting the row afterwards would be a test reaching
into a table it does not own, and a crashed run would leave it behind anyway.

**The clock is running on every other fixture the suite writes to**, not just this one. The
disputes list is simply the first that grew a second page. A test that passes for months and then
fails for everybody with no code change is the shape of problem that costs an afternoon to
attribute; this one has now cost one, and the next one will cost another.

**The work:** decide the mechanism — a `db:testbed` reset in CI before the suite, a per-run
customer account, or a teardown that truncates the fixture account's own rows — and apply it to
every accumulating fixture rather than to disputes alone. **To unblock:** nothing external.

### O-e2e-1 — The verification gate has no browser spec, for want of a stable fixture

**Status:** open · **Severity:** Low · **Owner:** engineering · **Recorded:** 2026-08-21

An unverified partner now sees only العقود والمستندات; every other route redirects there and the
sidebar drops to two links (Bashar, 2026-08-21). It is held by `gate-coverage.test.ts`, which reads
`app/` and fails on any page that neither gates nor is exempt with a stated reason — that catches
the failure mode that matters, a NEW page forgetting the call.

What it does not catch is the redirect itself breaking. That wants a browser spec, and a browser
spec wants a partner fixture that is permanently `pending`: `db:testbed` seeds three partners and
all three are `approved`, because every console screen needs them to be. The `APPLICANT` fixture
is a customer and stops being useful the moment somebody walks the journey with it.

**The work:** a fourth seeded partner, `partner-pending@safra.test`, verification `pending`, with
no documents — then a spec asserting the redirect, the two-item sidebar, and the `data-stage`
attribute on each of the four stages. Roughly an hour. **To unblock:** nothing external.

**Verified by hand on 2026-08-21** against a `pending` fixture, all four stages: `/`,
`/properties`, `/calendars`, `/payouts` and `/reviews` each redirected to `/contracts`; the
sidebar read `["العقود والمستندات","الدعم"]`; the stage advanced `empty → waiting → done`; and on
approval the sidebar returned to seven items and «انتقل إلى لوحة التحكم» led to `/`.

### O-sec-12 — An unverified partner could price a listing through the create form

**Status:** FIXED 2026-08-21 · **Severity:** Medium · **Owner:** engineering ·
**Found by:** Bashar, walking the joining journey on his own account

Step 7 puts units, prices, dates and images behind verification, and «حسابك قيد المراجعة» on
العقود والمستندات says so in as many words. Every DEDICATED route enforced it —
`POST properties/:reference/units`, `PATCH units/:unitId`, `PUT units/:unitId/calendar` and the
whole images controller all carry `@RequireVerifiedPartner()` and all answer 403.

`POST /partner/properties` deliberately does not, and correctly: writing a listing's address and
description while waiting is what makes the wait useful, and it is exactly what the banner
promises. Then `initialUnits` — «عدد الوحدات» and «السعر لليلة» — was added to that route so the
add-property form could ask for everything on one screen. It writes units carrying a `basePrice`.
**A guard is route-level and cannot refuse one FIELD of a permitted request**, so nothing stopped
it: the add-property form did precisely what the dedicated units route refuses, while the portal
told the reader they could not. Reproduced against a `pending` fixture — three units at $250, 201.

**Not a privilege escalation and not a data leak.** A partner could only write to their own draft
listing, which no customer can see: `status` is forced to `draft` on create and publication needs
`PROPERTY_APPROVE`, which no partner role holds. What it defeated was the REVIEW — the point of
holding prices back is that a human sees the partner before their money terms exist.

**The fix, both halves.** `PropertiesService.create` refuses `initialUnits` unless
`isVerifiedPartner` — a function now shared with the guard rather than a second copy of
`verification === 'approved'`. And the portal stops asking: `AddProperty` takes `verified`, hides
the three fields, omits the payload, and says «يمكنك إضافة الوحدات والأسعار بعد التحقق من حسابك».
A form that submits fields the server will reject fails after being filled in, which is worse than
one that does not ask.

**Held by five tests** in `properties.integration.test.ts`, two of which fail without the fix
(verified by reverting it). **Three of the five assert the PERMISSIVE half** — that an unverified
partner can still create the listing, that it comes out with no units, and that a verified one is
unaffected. The obvious over-correction is to put the guard on the route, which would refuse the
whole request and take away the one thing the banner promises; those three fail if anybody does.

**Also closed:** `propertyUpdateSchema` inherited `initialUnits` from `.partial()` and
`PropertiesService.update` never read it — a contract advertising a field the code silently
dropped, and an invitation for somebody to later "fix" the omission on a route with no
verification check. Now `.omit({ initialUnits: true })`.

### O-web-1 — A refused account page says «تعذّر التحميل» when it could say why

**Status:** open · **Severity:** Low · **Owner:** engineering · **Recorded:** 2026-08-21

`apps/web/src/lib/account.ts` mapped BOTH 401 and 403 to `'unauthenticated'`, so an account with
no `customer_profiles` row — which the API refuses precisely, with `customer.profile_missing` —
reached محفظتي as «انتهت الجلسة، سجّل الدخول مجدداً». False, and a LOOP: signing in again yields
the same token, the same 403 and the same sentence, so the only action the page offers is the one
that cannot work. Reachable by any of the ~3,000 partner accounts, since the customer site's
sign-in refuses staff but not partners. **Found by Bashar on 2026-08-21, on his own account.**

**Fixed on 2026-08-21**: 403 now maps to `failed`, so the page says «تعذّر التحميل» — vague, but
true, and it does not send anybody to sign in again. Held by `account-refusal.test.ts`, whose
central assertion is the negative one.

**What remains, and why it was not done at the same time.** «تعذّر التحميل» is not the useful
sentence. The useful one names the cause — «هذا حساب شريك، ولوحة العميل ليست له» — and that needs
a page state which SIXTEEN account pages do not have, plus its copy in three locales. Doing it
under cover of a bug fix would have been a large untested change to every personal screen in the
customer app. **To unblock:** nothing external; it is a decision about how much the customer app
should say to somebody in the wrong place. **Order:** after the launch blockers.

**Related, and already closed:** the fixture that exposed it. `seed-testbed.ts` created the
applicant account as a `users` row with no profile and no wallet, on the reasoning that applying
needs neither. True, and beside the point — it is a CUSTOMER account, and `AuthService.register`
writes user + profile + zero wallet in one transaction, so a customer made of only the first was
a shape no registration can produce. The fixture now writes all three.

### O-page-1 — What numbered pages cost, and when it stops being affordable

**What:** The console's fifteen registries moved from keyset cursors to `OFFSET` + `count(*)` on
2026-08-05, because Bashar asked for a page number and a total (`صفحة › [١] ‹ من ١٠٢ · ٢٥٣١ نتيجة`)
and a cursor cannot address page 40. This records what that bought and what it will cost later, so
the trade is revisited on evidence rather than rediscovered as a slow page.

**What is already mitigated:**

| Cost                                               | Mitigation shipped                                                                                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `count(*)` is unbounded work on a big table        | Capped at `COUNT_CAP` = 10,000 via a `LIMIT 10001` subquery; the bar prints "أكثر من ١٠٠٠٠". `audit_log` (13,327 rows) and `wallet_transactions` (13,530) already hit it |
| `OFFSET n` produces and discards `n` rows          | `page` ceiling of 100,000 in `pageQuerySchema`, and the console clamps before calling so a typo shows a table rather than a 400                                          |
| The count and the list can describe different sets | Every service shares ONE `fromWhere` fragment between them; `e2e/pagination.spec.ts` asserts the total responds to the filter                                            |
| A second query per page load                       | Runs in `Promise.all` with the list, on the same indexed predicates                                                                                                      |

**What is NOT mitigated, and what would fix it:** a deep page is still linear in `page × limit`.
At 1M bookings, page 2,000 at 50 rows makes PostgreSQL produce 100,000 rows and throw away 99,950.
Nobody browses there by hand, so the realistic trigger is an export or a script walking pages —
which should use the keyset endpoints or a date filter instead.

**When to revisit:** if p95 on any console list endpoint passes 200 ms, or if the audit log's
capped count starts hiding something an operator needs. **The fix is not "make OFFSET faster"** —
it is to narrow the set (a mandatory date range on the audit screen) so the reader never needs a
deep page. Measure first: the numbers above are row counts, not timings.

### MEASURED, 2026-08-20 — and the ceiling should come down to 1,000

Scenario 3 of the load test supplied the measurement this item asked for, over 5,000,061 bookings.
Buffers touched by the console's own query, which is a page the database had to read and does not
vary with hardware:

| Page    | OFFSET    | Rows read | Returned | Buffers                 | vs page 1   |
| ------- | --------- | --------- | -------- | ----------------------- | ----------- |
| 1       | 0         | 27        | 25       | 144                     | 1×          |
| 10      | 225       | 250       | 25       | 1,044                   | 7×          |
| 100     | 2,475     | 2,500     | 25       | 9,914                   | 69×         |
| 1,000   | 24,975    | 25,000    | 25       | 87,069 + 5,254 written  | 605×        |
| 10,000  | 249,975   | 250,000   | 25       | 401,578 + 5,237 written | 2,789×      |
| 100,000 | 2,499,975 | 2,500,000 | 25       | 2,663,104               | **18,494×** |

**The plan is the RIGHT plan at every depth** — `Index Scan Backward using bookings_created_idx`
feeding an `Incremental Sort`, no sequential scan, no missing index. So there is nothing to optimise:
the cost is inherent to `OFFSET` and linear in `page × limit`, exactly as `pagination.ts` says. The
only decision left is the ceiling.

**Two thresholds are visible.** From page 1,000 the sort spills to disk. At the ceiling of 100,000 a
single request reads 2.5 million rows to return 25 — roughly 20 GB of page accesses, which any
authenticated staff account can ask for repeatedly.

**Recommendation: lower `page` from 100,000 to 1,000 in `pageQuerySchema`.** That is where the spill
starts and it is 40× past anything a person reaches by hand.

### APPLIED, 2026-08-20 — Bashar chose 1,000

`MAX_PAGE_NUMBER = 1_000` in `packages/contracts/src/pagination.ts`, and `pageQuerySchema` reads it.

|                                  | Before                                                 | After                                  |
| -------------------------------- | ------------------------------------------------------ | -------------------------------------- |
| Worst-case page                  | 2,663,104 buffers ≈ 20 GB, 2.5M rows read to return 25 | ~87,069 buffers + 5,254 written        |
| Reduction in the cap             | —                                                      | **30×**                                |
| Rows reachable per filtered view | 2.5M at size 25                                        | 25,000 at size 25; 100,000 at size 100 |

**The console no longer keeps its own copy.** `MAX_PAGE` in `apps/admin/src/lib/search-params.ts`
was a second literal, kept in step by hand, and this change is exactly the kind that leaves one
behind. It now re-exports `MAX_PAGE_NUMBER`, the same way `DEFAULT_PAGE_SIZE` re-exports
`DEFAULT_TABLE_PAGE_SIZE` and for the same reason: the clamp only turns a bad URL into a table
while it agrees with the schema that would otherwise answer 400, so a stale copy would produce
precisely the error page the clamp exists to prevent.

**What it breaks, deliberately:** a script walking pages to enumerate a registry now gets a 400 at
page 1,001. That was always the wrong instrument — such a caller should use the keyset endpoints or
narrow with a date filter, which is what this item already said the real fix for depth is.

**Held by** three assertions in `pagination.test.ts`, including that the constant IS 1,000, so a
future edit that changes it has to change a test that says why.

**Two uncapped scans were found next door and are fixed** (see `docs/load-test-results-2026-08-20.md`
F-7 and F-8): the bookings registry's per-status counts were an uncapped `GROUP BY` costing 239,855
buffers on every page view — now 93 — and the console SUMMED them into an exact «٥٠٠٠٠٦١ حجزًا»
printed directly above a bar correctly saying «أكثر من ١٠٠٠٠ نتيجة». «طلبات الشراكة» had no index for
its own sort order: 765 buffers → 50.

**Owner:** closed 2026-08-20. The measurement was done, the ceiling is set.

### O-page-2 — The pagination bar needs a تطبيق button because there is no JavaScript

**What:** Bashar's screenshot has no apply button — its rows-per-page select applies on change,
which is a JS `onchange`. The console renders on the server and its forms work without JS, so the
bar carries a small تطبيق submit instead.

**Why it was built this way:** the alternative is a control that only works if you know to press
Enter, which is an accessibility failure as well as a discoverability one — the same reasoning the
search toolbar already follows.

**What would remove it:** a progressive enhancement — submit the form on `change`, and hide the
button only when the script has run. That needs a nonce'd inline script (the console's CSP uses
`strict-dynamic` with a per-request nonce) and a browser test that the no-JS path still works.
Small, and worth doing only if Bashar wants the screenshot's exact chrome.

**Owner:** Bashar's call on whether the button stays.

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

### S-1 — Partly closed: the metrics endpoint exists; the consumer does not

**2026-08-08.** `GET /internal/metrics` exposes every table-derived signal as a Prometheus gauge —
job success ages, notification outcomes, sanctions freshness, the payment-event backlog, the SLA
consequence count and media reachability — behind a bearer token that answers **404** when absent,
wrong, or missing its scheme. Timing-safe, cached 10 s, 20 ms to collect.

A job that has never completed reports `-1` rather than being omitted: an absent series is
indistinguishable from a failed scrape, and "never ran" is precisely the case alerting exists for.

`docs/alerting.md` now carries the Prometheus rule file verbatim. **What remains is a scraper, a
pager and an on-call rota** — none of it in this repository, all of it after `M-1`.

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

### S-2 — Closed: partners are told, by email, and it is recorded

**Closed 2026-08-08.** A paid booking entering `pending_confirmation` sends the partner
`booking.needs_action` in their own language, carrying the reference, the stay and the DEADLINE.

The reason this was a fairness problem and not only a product gap: §6.4 fines a partner and cuts
their score for not answering inside the window, and until now the only way to learn a request
existed was to be looking at the dashboard. **Fining somebody for missing a message nobody sent them
is not a rule, it is a trap.**

**And it is provable.** Every send writes a row to `notifications` — sent OR failed, with the
provider's reason — so "was I ever told?" has an answer months later. That table had existed since
the first migration with nothing ever writing to it. See `docs/notifications.md`.

**What is still open, and it is not this.** WhatsApp remains unwired pending roadmap item 192; email
is the channel today and the console shows that per channel rather than claiming the template works
everywhere. And sends happen IN THE REQUEST — see the accepted deviation under `O-notify-1`.

### S-3 — Load testing: the locally-honest half is DONE; capacity still needs infrastructure

**Status:** scenarios 1–4 executed · capacity still blocked on M-1 · **Owner:** Backend

The project rules require load-testing critical paths before claiming a capacity number, and require
stating the measurement rather than guessing. **No capacity number should be quoted until this runs
against real infrastructure, and none has been.** That part is unchanged and still gated on the
deployment target.

**What HAS been done** — the two things `docs/load-testing.md` says a local run answers honestly,
query plans and business invariants:

| Date       | Scenario                        | Result                                                                                     |
| ---------- | ------------------------------- | ------------------------------------------------------------------------------------------ |
| 2026-08-12 | 1 — search and browse           | `O-scale-1` and `O-scale-2`. Search 144 s → 0.59 s                                         |
| 2026-08-20 | 2 — booking contention          | The exclusion constraint HELD: 10,550 contended attempts, 20 winners, zero double bookings |
| 2026-08-20 | 3 — deep pagination             | The `O-page-1` curve, measured. Two uncapped scans found and closed                        |
| 2026-08-20 | 4 — authentication under attack | The account lockout holds; `O-sec-1`'s bystander property does NOT. See `O-sec-3`          |

**Fifteen defects, twelve fixed.** Full record: **`docs/load-test-results-2026-08-20.md`**. Three of
them meant a scenario could not produce its own result at all — a route throttle the documented
procedure could not reach, a 404 route, and an invariant that could not detect the violation it was
named after. That is the same class as `O-scale-1`, for the same reason: nothing had ever been run.

**Scenarios 5 (media/CDN) and 6 (12-hour soak) remain deferred** — both need infrastructure rather
than a decision.

**What is owed before the capacity run:** regenerate `safra_load` so the append-only tables carry
spread timestamps; teach the generator to write `payments` and `notifications` so two invariants stop
passing over empty tables; distributed load generation for scenario 2, since behind a real balancer a
forged `X-Forwarded-For` is correctly ignored and the booking route's ten-a-minute limit binds again.

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

### O-web-1 — The public pages cannot be statically generated while the CSP nonce is per-request

**Status:** city pages fixed by rendering them dynamically · **Owner:** **Bashar** ·
**Recorded:** 2026-08-12

All nine city pages returned **500 in production**, in all three locales, and both suites were green
throughout — `pnpm verify` never renders a page, and no spec had ever requested one. Found by auditing
the log noise that came out of an unrelated investigation.

**The cause.** `/city/[slug]` declared `generateStaticParams`, which commits those routes to build-time
output. The locale layout renders `ThemeScript`, which calls `headers()` to read the CSP nonce — the
inline theme/sidebar script is written by hand, so Next cannot nonce it automatically. A prerender has no
request, so `headers()` throws `DYNAMIC_SERVER_USAGE`; Next tolerates that on a route it may render
dynamically and cannot on one promised as static.

**The fix applied:** `dynamic = 'force-dynamic'` on the city page. The caching that mattered is
untouched — `getCity`, `getCities` and `searchForDisplay` each carry `next: { revalidate: 300 }`, so the
API is hit once per five minutes per query rather than once per visitor. What was given up is HTML
assembly, not data.

**The deeper item, not done.** Two things stand between these pages and real static output:

| Blocker    | Note                                                                                                                                                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The nonce  | A statically generated page cannot carry a per-request nonce. Making the inline script CSP-**hash**-based would remove the `headers()` call — `apps/web/src/lib/theme-script.ts` already notes that "the CSP has to hash these exact bytes", so the intent existed |
| The header | `SiteHeader` shows «حسابي» or «تسجيل الدخول» from the session cookie. A static page bakes one in and serves it to everybody — the same staleness reported on the navbar, made permanent. Static output needs that chrome moved out of the cached shell             |

**Also inert, and worth knowing:** `/` declares `revalidate = 300` and `/property/[slug]` declares
`revalidate = 60`, and neither can take effect for the same reason — both read a request through the
layout. They render dynamically today. Removing the declarations would be honest; keeping them is a
reminder of the intent. Neither is a fault, but neither is caching.

**Guarded by** `e2e/public-routes.spec.ts`, which crawls the public site's own links rather than checking
a list somebody remembered to write.

### O-web-3 — الدعم ships; what it does not do yet

**Status:** built on all three dashboards · **Owner:** **Bashar** · **Recorded:** 2026-08-12

Bashar asked for a الدعم page on the customer and partner dashboards, with staff managing everything.
Delivered:

| Surface                     | What it does                                                      |
| --------------------------- | ----------------------------------------------------------------- |
| Customer `/account/support` | list, open, thread, reply — three locales                         |
| Partner `/support`          | the same, Arabic, a fifth sidebar destination                     |
| Console `/messages`         | the existing three-party inbox, now showing and answering tickets |

**A ticket is a CONVERSATION, not a new table.** `conversations`/`messages` already carried the thread,
the contact-detail redaction, the staff unread counter and internal staff-only notes. What was missing was
a legal SHAPE: `conversations_exactly_one_subject` demanded a booking, a dispute or a partner. The `_v2`
constraint allows a subject-less thread provided a customer is named; a partner ticket already fitted.

**Two things this corrects in this document.** Messaging was described as "the largest gap … there are no
tables", which was already wrong — `conversations`, `messages`, a redaction module and a full admin inbox
all existed. And the console's scope filter keyed on `coalesce(booking.city, partner.city)`, which is NULL
for a customer's ticket; a NULL never matches an `IN (…)` list, so every ticket would have been invisible
to a city-scoped operator while looking present to a super admin. Both fixed.

**The reply notice — done 2026-08-12.** A staff reply on a ticket now emails the asker in their own
language: `MessagingService.notifyAskerOfReply`, template `support.replied`, copy in all three locales.
Three decisions worth not rediscovering. The email carries the REFERENCE and a link and never the
message text, because bodies are stored redacted and the original is discarded — repeating it in an
inbox would put back what the redaction removed, and the copy says so out loud so a pointer does not
read as a truncation. An INTERNAL note sends nothing, which is the worst leak this feature could have
caused and has its own test. And `notify`'s subject records the RECIPIENT's id rather than gaining a
`conversation_id` column: those FKs exist to answer "was this person told", which the recipient's id
answers, whereas a thread id would need a migration and a fourth subject FK to record what the inbox
already shows against the same person. Scoped to TICKETS — a booking or dispute thread has no route
into it from either dashboard, so a link to one would 404 for whoever followed it.

**Closing from the asking side — done 2026-08-13.** `POST /support/:reference/close`, a button on both
dashboards, and it clears `unread_for_staff` as well as setting `closed_at` — which is the point rather
than a detail: that counter is what the console's inbox SORTS by, so an abandoned ticket did not merely
linger, it sat near the top ahead of people still waiting. Idempotent, because the button is on a
reloadable page. Final, because `reply` already refuses a closed thread and reopening silently would
hide that it was ended. **No system message is written into the thread** — "the customer closed this"
is a sentence, a message body is stored once, and the console reads Arabic while the customer app reads
three languages; the `closed` state is the record and each interface says what it means in its own
language.

**Sending inside the request — done 2026-08-13** by BullMQ phase 2. See `O-notify-2`.

**The dispute route — done 2026-08-13.** `POST /disputes` plus a page at `/account/disputes`, so a
customer can raise one about a booking they paid for. Three decisions worth not rediscovering.

**The customer only.** Every value of `dispute_kind` is a complaint about the stay or the host —
`property_unavailable` (EC-006), `not_as_described` (EC-007), `partner_no_response` (EC-008),
`complaint`. There is no partner-side reason in the enum, and inventing one would be deciding what a
partner is entitled to dispute. Left as a product question rather than filled in while wiring a form.

**The scope check IS the design, because opening one stops money.** The freeze is derived — "does this
booking have a dispute that is not resolved or rejected" — so this endpoint holds a host's payout. The
booking is therefore resolved BY REFERENCE WITHIN THE CALLER'S OWN PROFILE in a single query, with no
fetch-then-compare branch that could answer differently for "exists and is not yours". The freeze is
asserted in the tests through `DisputeService.frozenBookingReferences`, the function the payout run
actually calls, rather than by reading the table.

**One live dispute per booking per reason**, and a paid booking only. The schema's own note says a
booking can be disputed twice for different reasons, so the block is per reason and lifts once the
first is answered. `paid_at IS NOT NULL` rather than a status list: an unpaid booking has nothing at
stake, and the test survives a status being added.

**What it does NOT do yet, in the order it will be missed:**

| Missing       | Why it matters                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| No attachment | A photograph of a broken heater is the evidence most complaints turn on. `dispute_evidence` has a shape for this; support threads have none |

**Tested:** 21 integration tests (cross-account 404s, partner↔customer isolation, redaction on open and
reply, internal notes never returned, closed threads read-only, unread counter incrementing rather than
resetting, keyset paging staying stable when an older ticket is bumped), 13 contract tests, and a browser
round trip in `e2e/partner-support.spec.ts` where the partner opens a ticket, staff answer it from the
console, and the partner sees the answer.

**The notice adds 11 more** in `admin/messaging.integration.test.ts` — an internal note notifying nobody,
no message body in any column of the delivery row or in the email, the recipient's language rather than
the agent's, a suspended account not written to, a booking thread staying silent, and a reply that posts
anyway when the mail server refuses it.

### O-web-4 — The public home page had no cities at all, and a stale server hid it

**Status:** FIXED 2026-08-12 · **Found by** `e2e/public-routes.spec.ts` · **Recorded:** 2026-08-12

`cities.categories` is an array of a Postgres ENUM. node-postgres parses arrays only for element types
it has a built-in parser for, so selected bare through `db.execute` the column arrived as the literal
string `'{historic}'` — while the call's own type generic declared `string[]`. A generic on
`db.execute` is an ASSERTION, not a check, so the types were satisfied and every test passed.

Then the consumer swallowed it. `apps/web/src/lib/catalog.ts` validates each response and returns an
empty list rather than throwing — right for a reference endpoint that blipped, and exactly wrong here.
`getCities()` returned `[]` on every request, so the public home page rendered its whole destinations
grid and its city selector EMPTY, and `/ar/city/*` was unreachable from anywhere on the site. The
single-city endpoint kept working, because it goes through the query builder, where Drizzle parses the
literal itself.

**Three failures had to line up, and each one is the lesson.** A typed `db.execute` that nothing
verifies; a fallback that turns a contract violation into missing content; and `next start` serving a
long-running process built from older code, which is what kept the crawl green — the bug only appeared
after a rebuild replaced the running API. Fixed with `to_jsonb(c.categories)` and held by
`catalog/catalog.integration.test.ts`, which asserts the RUNTIME SHAPE the type system cannot see, and
which fails if the cast is removed.

**The sweep, done 2026-08-12 — one bug, and the class is now enforced.**

Asked the DATABASE rather than the schema files, because the schema is what somebody believes and
`information_schema` is what is there. Ten array columns exist; `cities.categories` is the only one
whose element type is not a base type, so it was the only instance of this bug. The other nine are
`text[]` or `int4[]`, and each was confirmed to parse — at runtime, through the real driver, not by
reading node-postgres's parser table.

Widened to the same MECHANISM on non-array columns, since a lying generic is the actual fault and an
enum array is only one way to get one. All 31 `db.execute` generics declaring a `number` field were
mapped to the SQL expression that produces them: every one is `int4`/`smallint` or carries an explicit
`::int`. The `numeric` and `bigint` columns — money, `properties.rating`, the ad counters — are already
handled the house way, `::text` in the query and `Number()` at the boundary, and the two bare readers
of `properties.rating` are honest (`Record<string, unknown>`, and `string | null`). Nothing else to fix.

**Guarded by `database/array-columns.integration.test.ts`**, which reads the array columns out of
`information_schema` and fails when one appears whose element type the driver cannot parse and which
nobody has put on `CAST_REQUIRED`. It is data-independent — every check runs against an empty array
literal cast to the element type — so it works on a fresh migration and cannot pass because a table
was empty. It also holds the list honest in reverse: an entry that starts parsing must be removed.

### O-web-5 — Terms and Privacy exist; the legal particulars do not

**Status:** open, needs LEGAL input · **Owner:** **Bashar** · **Recorded:** 2026-08-13 · **Built:** 2026-08-14

`/{locale}/terms` and `/{locale}/privacy` are live in all three languages, linked from a قانوني
column in the footer, and swept by `e2e/responsive.spec.ts`.

**Everything in them was written from the code, and is checkable.** The 120-minute confirmation
window, the 17:00 same-day cutoff, the 50% refund floor, the compensation when a partner does not
answer, reviews being hidden rather than deleted, a dispute freezing a payout — each is a behaviour
with tests behind it. The privacy notice states that passwords are hashed with Argon2id, that
two-factor secrets are encrypted at rest, that contact details are masked out of messages and
disputes BEFORE storage with no original kept, that exports are deleted after seven days and
unsigned payment callbacks after thirty, and that photographs are retained deliberately as evidence
of what a listing claimed. It names the three cookies this site sets and no others, because there
are no advertising trackers and no third-party analytics to disclose — and `customer-locale.spec.ts`
fails if a fourth cookie is ever added without the page being updated.

**Four things are missing, and none of them is an engineering question:**

| Missing                                     | Needed for                                        |
| ------------------------------------------- | ------------------------------------------------- |
| The legal entity and its registered address | Both pages — the controller's identity under GDPR |
| A contact address for privacy questions     | The privacy notice                                |
| The competent supervisory authority         | The right to complain                             |
| Governing law and jurisdiction              | The terms                                         |

Both pages carry a visible notice at the top listing exactly these, so the pages read as unfinished
rather than as confident boilerplate wrapped around blanks. That is the project's existing pattern —
the console dims a control it cannot honour, and `AccountNotBuilt` names what is missing. **A legal
page that looks finished and is not is the one a person relies on.**

**Neither page has had legal review.** What is there is accurate about the system; whether it is
sufficient, and correctly worded for the jurisdictions SAFRA will operate in, is a question for a
lawyer. `LEGAL_UPDATED` in `apps/web/src/lib/legal.ts` is a constant rather than `new Date()`
precisely so the "last updated" line cannot claim a review that never happened — change it in the
same commit that changes the wording, and never otherwise.

### O-sec-2 — Registration keeps a duplicate address silent, by decision

**Status:** decided 2026-08-14 · **Owner:** **Bashar**

Bashar asked that registration not be allowed for an address that already has an account. **It
already was not**: `users_email_unique` is a partial unique index over the live rows, and `register`
returns `created: false` without inserting. What was missing was a test asserting it directly rather
than by implication — now in `registration-enumeration.integration.test.ts`.

**What was NOT changed is the visible refusal**, and that was Bashar's call when the trade was put to
him (2026-08-14): an error saying «هذا البريد مسجّل بالفعل» is one request with a definitive answer,
which is the cheapest enumeration oracle a system can offer. A stranger could test any address, and
a leaked address list becomes a verified customer list. The neutral answer stays, and the person who
owns the address learns they already have an account from their inbox, where only they can see it.

This confirms the 2026-08-07 decision rather than reversing it.

### O-sec-1 — Password strength is checked locally; a breach corpus would be stronger

**Status:** open, needs a DECISION · **Owner:** **Bashar** · **Recorded:** 2026-08-14

**Updated 2026-08-14, second pass.** Bashar asked for a visible strength checklist from a reference
design, so `PASSWORD_RULES` now also requires an uppercase letter, a lowercase letter, a digit and a
symbol, rendered live beside the field by `PasswordStrengthMeter`. That is a reversal of the "no
composition rules" position, taken deliberately: the checklist teaches what strong means and gives
immediate feedback, and **the blocklist is what makes it safe** — `Password123!` satisfies every
visible rule and is still refused. Composition alone would have been weaker than what was there.

Two things the reference design could not know. **The minimum stays twelve, not the eight it showed**
— lowering a floor on a platform holding wallet balances is a regression somebody would have to
justify. And **Arabic has no case**, so a literal "one capital letter" rule would have refused every
password written in this site's primary language; a caseless letter satisfies both case rules, which
is why «مطر أزرق فوق الجبل ٩!» is accepted.

The policy was twelve characters and nothing else, so `aaaaaaaaaaaa`, `123456789012`,
`qwertyuiop12` and `Password1234` all opened accounts on a platform holding wallet balances and
payout details. `passwordSchema` now also refuses low character variety, repeated runs, keyboard and
alphabet sequences, a few hundred common passwords in Latin and Arabic script — folded so
`P@ssw0rd!2024` and `password` collapse to one entry — and, at registration, a password containing
the person's own email or name. No composition rule was added: forcing a symbol produces
`Password1!`, which is weaker than four words.

**What would be stronger is a breach corpus.** `HaveIBeenPwned`'s range API answers "has this hash
prefix been seen" without ever learning the password — five characters of a SHA-1 go out, hundreds
of suffixes come back — and it covers hundreds of millions of real leaked passwords rather than the
few hundred shipped here. Three things need deciding, none of them engineering:

| Question                                         | Why it is not mine to answer                           |
| ------------------------------------------------ | ------------------------------------------------------ |
| Is an outbound call to a third party approved?   | "Approved tools only" — this is a new external service |
| What happens when it is unreachable?             | Fail open (accept) or fail closed (refuse to register) |
| Is the added latency acceptable on registration? | It is one more network hop on the signup path          |

Until then the local list is the floor. It is deliberately short: it ships to the browser inside
`@safra/contracts`, and the ten-thousandth entry is worth less than the bytes.

**Two gaps that remain, and are cheap to close if wanted.** The identity check needs the email, so it
applies at REGISTRATION only — a password reset or an invitation carries a token, and the API knows
the account from it, so the same check could run in those services. And nothing re-checks an
existing password: everybody who registered before today keeps whatever they chose.

### O-web-6 — Currency switching works, and only one pair has a rate

**Status:** open, needs data · **Owner:** **Bashar** · **Recorded:** 2026-08-13

The footer offers USD, EUR and ل.س (Bashar, 2026-08-13). The mechanism is complete: the choice is a
cookie, browse prices convert through the recorded rates, and **contractual amounts never convert** —
checkout, invoices, the wallet and gift cards always show the figure a card is actually charged, in
the listing's own currency. `convertForDisplay` lives in `lib/currency.ts` and the contractual
surfaces simply do not import it.

**`fx_rates` holds exactly one pair: USD→SYP, 13,000, source `verification`, effective 2026-08-11.**
So picking ل.س converts today and picking EUR does not — a euro visitor sees dollars, unlabelled,
which is the honest outcome rather than a euro figure derived from nothing. `rateBetween` returns
null rather than 1 for a pair it cannot reach, and `currency.test.ts` holds it to that.

What unblocks EUR is a rate and its provenance, which is a business decision rather than an
engineering one: which source, whether a spread is applied, and how often it is refreshed. Staff can
record one on the geography screen today. Two further points worth deciding at the same time:

- **Nothing refreshes rates.** A rate entered by hand ages, and an aged rate on a browse page is a
  price that flatters or insults. There is no scheduled refresh and no staleness warning.
- **The inverse is derived, not stored.** `SYP → USD` is computed as `1 / 13000`, which holds while a
  rate is a pure ratio and stops holding the moment a spread is baked into it.

### O-web-2 — Two public links point at pages that do not exist

**Status:** open, product decision · **Owner:** **Bashar** · **Recorded:** 2026-08-12

Found by the crawl above:

| Link                           | Where                           | Label            |
| ------------------------------ | ------------------------------- | ---------------- |
| `/{locale}/partner`            | the home page's partner section | «سجّل كشريك»     |
| `/{locale}/support?property=…` | the property page               | report-a-listing |

Both 404. Neither page has ever existed, so this is unbuilt scope rather than a regression — but a call
to action that 404s is a broken promise on the busiest page of the site, and the project's own pattern
elsewhere is to say what is missing rather than to dead-end (`AccountNotBuilt`, and the console's dimmed
sections).

Three ways out, and the choice is Bashar's: build the pages, point the links at something real (partner
registration lives in a different app on a different origin, so that needs a configured public URL), or
remove the links until there is somewhere to send people.

`e2e/public-routes.spec.ts` carries both in `KNOWN_MISSING`, and fails if either starts resolving — so
whichever way it is fixed, the list has to be updated rather than quietly outliving the problem.

### O-fin-1 — الفواتير is a receipt, and a tax invoice is a different document

**Status:** built as a receipt, deliberately · **Owner:** **Bashar + Legal** ·
**Recorded:** 2026-08-11

Handoff §6's eighth section is built (`/account/invoices`, list + detail, `GET /invoices`).
What it renders is a faithful RECORD of what a booking cost and what was paid: every figure
is read verbatim off the `bookings` row, `total_amount` included, so the document cannot
disagree with the charge. Both screens say so in a sentence, in all three languages
(`account.invoicesNotTax`).

It is **not** a tax invoice, and must not be described as one. What a real one needs, none
of which exists:

| Missing                                | Why it is not a small change                                                                                                                                                                  |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A gapless sequential number            | A register with its own sequence, separate from `booking_reference_seq` — a receipt is currently identified by the booking reference, and a gap in an invoice series is itself a finding      |
| Seller legal identity and VAT id       | Belongs to the merchant entity, which is a Legal decision (see the item above), and differs per market                                                                                        |
| A tax breakdown at the applicable rate | `bookings` stores no tax component at all. Adding one is a pricing change, not a display change, and it is retroactive: existing bookings have no rate to attribute                           |
| Immutability after issue               | The property name and city are JOINED, not snapshotted, so renaming a property changes what an old document says it was for. A document that may not change has to carry its own descriptions |

**Recommended next action:** treat this as a Legal question first — which entity issues, in
which markets, at which rate. The engineering work is meaningless until that is answered,
and answering it may make `bookings` carry a tax column, which is the expensive part.

### O-fin-2 — The receipt PDF is made by the reader's browser, not by us

**Status:** shipped as print-to-PDF, deliberately · **Owner:** **Bashar** ·
**Recorded:** 2026-08-11

Bashar asked for a downloadable PDF (2026-08-11). What ships is a «تحميل PDF» button that calls
`window.print()`, with a print stylesheet that turns the receipt into an A4 document — the colour
tokens are redefined once inside `@media print`, so the whole page becomes paper rather than each
element needing a `print:` class.

**Why not generated in the API.** The receipt has to read correctly in Arabic, and Arabic is not a
font substitution — it needs contextual glyph shaping and bidirectional layout. `pdfkit` and
`pdf-lib`, the two libraries that would run in a Node service, do neither: the output would be
disconnected left-to-right letterforms. It would look perfect to anyone testing in English and be
unusable for the primary audience, which is the worst shape a bug can have.

Correct Arabic in a PDF needs a real text engine. That means the reader's browser, or a headless one
of ours.

**What the server-side version would take**, if it is ever wanted — an emailable, byte-identical file:

| Needed                         | Note                                                                                                                    |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Headless Chromium in the image | Or a HarfBuzz-based shaper. Both are a container and deployment concern, which is **M-1**                               |
| A background queue             | Rule 2 forbids slow work on a request path, and the API budget is p95 < 200 ms. Rendering a page per request is neither |
| Object storage for the result  | The queue answers "later", so the file needs somewhere to live and a signed, expiring URL                               |
| Arabic + Latin fonts embedded  | Amiri and Cairo, subset. A missing glyph in a PDF is a blank box rather than a fallback                                 |

**The trade the current version makes:** the customer chooses the destination in the print dialog
rather than getting a file straight into their downloads folder. That is the honest cost, and the
button's helper text says «اختر «حفظ بصيغة PDF» في نافذة الطباعة» so nobody has to guess.

**Recommended next action:** none until there is a reason a browser-made PDF is insufficient — the
likely trigger is wanting to ATTACH the receipt to an email, which is a queue job and lands with M-1
anyway.

### O-ops-1 — The API image now needs a headless browser

**Status:** open · **Severity:** Medium · **Owner:** Platform engineering ·
**Recorded:** 2026-08-21 · **Blocks:** contract generation, in production only

`PartnerContractService.generate` renders the partnership agreement by printing HTML in headless
Chromium (`apps/api/src/admin/contract-pdf.ts`). The customer app has carried this dependency since
receipts; **the API had not**, and now does.

**Why a browser at all** — the same reason `O-fin-2` gives: `pdfkit` and `pdf-lib` do no contextual
glyph shaping and no bidirectional layout, so Arabic renders as disconnected left-to-right
letterforms. The contract is bilingual and its Arabic half is the operative one for most partners.

**What this means for M-1.** An API image built without the browser binary fails this call at
runtime, and nothing earlier says so — the service starts, every other route works, and the first
symptom is a staff member pressing «إنشاء العقد» and getting a failure. The image needs
`playwright-core`'s Chromium and its shared libraries, which on a slim Debian base is roughly 300MB
and a `--no-sandbox` flag (already passed).

**To unblock:** include the browser in the API image, or move generation to a worker that has one.
Nothing external. **Order:** with M-1, before the first production deploy that offers the button.

**The alternative, if the image cost is unacceptable:** generation could move to the console app,
which is a Next.js service that could carry the browser as the customer app does — at the cost of
the contract being produced somewhere other than where it is stored and hashed. Recorded rather
than chosen.

### O-staff-3 — A staff member's city scope can be READ and no longer SET

**Status:** open, and it is a lost capability rather than missing work ·
**Owner:** engineering · **Recorded:** 2026-08-23

نطاق العمل — scoping a staff member to particular cities — was a paged table on الموظفون with an
editing panel beside it. الموظفون was simplified on 2026-08-23 (Bashar: _"too complicated"_) and the
table went, correctly: a scope is a property of a PERSON, and a paged list of everybody's scope sat
on that page only because there was nowhere else to put it.

**The editor went with the table, and nothing replaced it.** صفحة الموظف now DISPLAYS the scope —
`StaffService.detail` joins `staff_scope_cities` and returns city names, with `[]` meaning every
city — and offers no way to change it. `grep -rn "PUT" apps/admin/src | grep -i scope` returns
nothing.

So the console can show a super admin that a colleague is restricted to Damascus and give them no
way to add Aleppo. **The API side is intact**: `PUT /admin/staff/:userId/scope` works, is guarded by
`STAFF_MANAGE`, and revokes sessions on a narrowing. It was deliberately NOT deleted alongside the
dead `GET /admin/staff/scopes` — removing an endpoint because its only caller went away turns a
missing screen into a missing capability, and the console would then have to grow the endpoint back
to get the feature back.

**What it needs:** a scope editor on صفحة الموظف, beside the النطاق row it already renders — the
cities picker plus the `all_cities` / `cities` choice, posting to the existing route. Roughly the
panel that was deleted, rebuilt for one person instead of a table.

**Why it is worth doing rather than closing:** scoping is the mechanism behind
`.claude/CLAUDE.md`'s standing guarantee that a scope is server-enforced, and `scopeNote` on صفحة
الموظف still states that guarantee to the reader. A promise the screen makes and cannot act on is
the same defect as a capability with no feature behind it — see `O-staff-1`.

**How it was found:** by checking what else died before deleting `GET /admin/staff/scopes` as dead
code. The read really was dead; the write only looked dead. That distinction is the finding.

---

### O-partner-11 — Enforcement mail went to `partners.email`, which can differ from the account

**Status:** **RESOLVED 2026-08-24** — every enforcement notice is addressed to the sign-in account ·
**Owner:** engineering · **Recorded:** 2026-08-24

`EnforcementService.livePartner` selects `p.email`, so the suspension notice and the fine-waiver
notice are addressed to the APPLICATION contact on the partner row — not to `users.email`, the
account that actually signs in. For the main fixture those diverged when the partner was handed a
new address on 2026-08-21: the record still reads `partner1@safra.test` while the owner signs in as
`partner1-legacy@safra.test`.

**Impact.** A suspended business may be told nothing, at the one moment the platform most needs them
to read something — and «الحساب موقوف» arriving at an address nobody watches is indistinguishable
from a suspension imposed silently. Worse in the fixture's case: `partner1@safra.test` is the seed's
APPLICANT persona, so an enforcement notice for a real partner lands in a different persona's inbox,
which is also a trap for any future spec that reads mailpit by address.

**Resolved.** Bashar, 2026-08-24: _"enforcement notifications must use the actual sign-in account
or authoritative partner contact destination. Do not rely on `partners.email` if it can diverge."_
`EnforcementNotifier.recipient` selects `u.email` joined from the partner, so the address that
operates the portal is the address that is told what happened to it.

**Held by a test with the two columns deliberately different.** `enforcement-notifications.integration.test.ts`
sets `partners.email` to a second address on purpose and asserts the notice went to the account —
a fixture with both the same would pass against either implementation and prove nothing. Watched to
fail with the query reverted to `p.email`.

**Discovered by** a browser assertion comparing the console's displayed email against the session's
account, which refused to proceed. It was guarding against suspending the wrong business and found a
different defect instead.

---

### O-partner-12 — `SuspendedRefusal` was a component with no caller

**Status:** **RESOLVED 2026-08-24** — removed, its reasoning kept where the behaviour lives ·
**Owner:** engineering · **Recorded:** 2026-08-24

`suspension-notice.tsx` exports `SuspendedRefusal`, a `<p data-suspended-refusal>` carrying the
suspension sentence. **Nothing imports it.** The twelve write components deliver the same sentence
as a string through `refusalFor()`, and `data-suspended-refusal` appears in exactly one place in the
repository: its own definition.

**Impact.** Low, and entirely of the "reads as coverage" kind — the same defect class as a grantable
capability with no route (`O-staff-1`) and an enum value nothing writes. Nobody is missing a
refusal; the risk is somebody later assuming the attribute is a test hook that exists in rendered
output, or wiring a thirteenth component to the component instead of the helper and getting a
different-looking refusal from the twelve beside it.

**Resolved by removal**, after asking what it DID rather than who called it — the check that went
wrong with `GET /admin/staff/scopes`. What it did was render one sentence, and `refusalFor()` renders
the same sentence from the same error code; nothing else was attached. Its docblock made a point
worth keeping — the notice says why the ACCOUNT is held, the refusal says why the thing you just
tried did not happen, and both are needed — so that argument now sits on `refusal.ts`, together with
why the answer is a string rather than a component: the twelve write components each have their own
message area and their own vocabulary to fall back to.

---

### O-e2e-4 — Two specs were stricter than the rules they test; and a metrics suite raced a committing one

**Status:** **RESOLVED 2026-08-24** — both, at the root ·
**Owner:** engineering · **Recorded:** 2026-08-24

Two independent instances of one shape, both found on 2026-08-24 while getting the suite green:

**`customer-gifts.spec.ts` counted every historical dispute as spending a (booking, reason) pair.**
`dispute-request.service.ts` refuses a duplicate on `status IN ('open','investigating')` and says
why in as many words — resolved and rejected are terminal, so the reason is free to raise again. The
spec counted them all, so after 32 disputes it threw «Run `pnpm db:testbed` to clear them»: pointing
at a destructive re-seed to solve a problem the API did not have. Fixed by counting only live
disputes, which also means the exhaustion cannot recur. **A test must not be stricter than the rule
it is testing** — being stricter looks safe and quietly narrows what the product is allowed to do.

**`metrics.integration.test.ts` races the committing payments suite.** Its
`safra_payment_events_unprocessed` assertions read a global count, add one event and assert
before + 1. Under vitest's parallel execution the payments suite can commit an `awaiting` event in
between, and the delta becomes 2. Observed once in eight full runs; passes alone every time. It needs
either a scoped count or a serial marker — a flake in a metrics suite is the kind nobody trusts to be
a flake when it matters.

**The metrics race, investigated and fixed (Bashar: _"I do not want intermittent failures to become
accepted background noise"_).**

**Root cause.** Every assertion in that block is a DELTA on a gauge that counts a whole table:
`scrape()`, write one row, `scrape()` again. The suite runs inside `createRollbackDatabase`, whose
transaction was READ COMMITTED — PostgreSQL's default — so the second read also saw anything another
connection had committed in between. `payments.integration.test.ts` commits by design (its teardown
keeps any booking carrying a payment or a ledger entry, because that is financial evidence), vitest
runs files in parallel, and its `payment.captured` insert could land between the two reads. The delta
became 2 and the failure pointed at metrics code that was never wrong.

**Frequency.** Once in eight full runs on 2026-08-24. Green every time in isolation, which is the
worst way for a test to be wrong — it invites being re-run rather than read.

**Impact.** No production impact: the gauge is correct and the race is between two test suites. The
cost is trust. A suite that fails one run in eight teaches people to re-run rather than look, and the
next real regression in that file arrives wearing the same clothes.

**Fixed at the root, not by loosening the assertion.** `createRollbackDatabase` now takes an
isolation level, and the metrics suite opens `BEGIN ISOLATION LEVEL REPEATABLE READ`. Both reads then
see one snapshot, so a concurrent commit is invisible and the only delta is the test's own write.
Relaxing to `>=` was rejected: it would have hidden the regressions those assertions exist to catch.

The level rides on the `BEGIN` because it has to — `SET TRANSACTION ISOLATION LEVEL` must be the
first statement in a transaction, and the harness's wrapper issues a SAVEPOINT before anything a test
sends, so a caller cannot raise it afterwards.

**Made deterministic before it was fixed.** A new test commits an event from a SECOND connection at
exactly the racing moment and asserts the gauge does not move. It fails every time without the
isolation and passes with it — watched both ways. Three consecutive full DB-backed runs afterwards:
2,858 passing each time.

**One thing the cleanup taught, worth keeping.** That test first tried to DELETE the row it had
committed, and the database refused: `deny_payment_event_rewrite` allows a delete only for an
unverified, unprocessed payload older than thirty days — _"This row is evidence."_ It permits
`processed_at` to be set, so the test marks the row processed instead. The evidence stays and the row
stops counting toward `safra_payment_events_unprocessed`, the gauge behind a PAGE-severity alert.
A test that had deleted it would have been quietly breaking the append-only rule the whole table
exists to enforce.

---

### O-cons-1 — The disputes registry said «unresolved first» and ordered by date

**Status:** **RESOLVED 2026-08-24** — النزاعات is a work queue, and the query now says so ·
**Owner:** engineering · **Recorded:** 2026-08-24

`dispute.service.ts` carries the comment _"Unresolved first, then oldest first inside each group: the
queue's job is to surface what has been waiting longest"_ directly above
`ORDER BY d.created_at DESC, d.id DESC` — newest first, with no status grouping and no ascending
order. The comment describes a queue; the code returns a feed.

**Impact.** An operator working النزاعات top-down is reading the most recently OPENED disputes, not
the ones that have been waiting longest — the opposite of what the comment promises, and payouts are
frozen for every one of them. It is also how a fixture surprise arrived: re-opening the four OLDEST
test disputes left page one showing only closed ones, and `admin-sections.spec.ts` failed on a badge
that was correct.

**Bashar's decision, 2026-08-24: it is a WORK QUEUE.** _"Disputes freeze payouts, unresolved disputes
represent operational backlog, operators should naturally work from oldest unresolved item toward
newest, queue ordering is more important than activity chronology in this workflow."_

**Implemented as three keys, not one.**

```
ORDER BY (d.status IN ('open','investigating')) DESC,          -- unresolved first
         CASE WHEN d.status IN ('open','investigating')
              THEN d.created_at END ASC NULLS LAST,            -- oldest of those at the top
         d.created_at DESC, d.id DESC                          -- closed ones, newest first
```

Closed disputes stay newest-first underneath, deliberately: nothing is waiting on them, so "longest
waiting" is meaningless there, and what a reader wants from a settled dispute is the one just
settled. Two orders for two questions, in one list.

**Held by `dispute-queue-order.integration.test.ts`**, whose fixture is out of order in BOTH
dimensions — an old resolved dispute, a new unresolved one and an older unresolved one. A fixture
where age and status happen to agree would pass against `created_at DESC`, against `created_at ASC`
and against the correct expression, which is exactly how the original defect survived. Watched to
fail against the old ordering: the two queue assertions go red and the closed-order one stays green,
which is the right shape.

**This was the third recorded instance of a true-sounding comment describing an intention rather
than a change** (`O-staff-2`, the آخر نشاط docblock, and this). The only defence that has ever
worked is asserting the behaviour instead of reading the note, and that is now what holds it.

---

### O-ops-4 — The committing integration suites grew the dev database without bound

**Status:** **RESOLVED 2026-08-24** — the blast radius removed without deleting any evidence ·
**Owner:** engineering · **Recorded:** 2026-08-24

§7b deviation 2 accepts that four integration suites COMMIT rather than roll back, on the grounds
that it is "30 bookings and 23 audit rows per run, in a development database". That arithmetic is
per run and nothing ever removes them. Measured on 2026-08-24, mid-session:

| Artefact                                          | Count  |
| ------------------------------------------------- | ------ |
| `properties` with slug `payout-test-%`            | 112    |
| `bookings` on the single `payments-test-property` | 12,636 |

The consequence is not a slow test — it is a **broken one, in another app**. That property's API
payload reached 7.1MB, over the 2MB Next.js data-cache ceiling, so the customer app logged
`Failed to set Next.js data cache` and re-fetched it uncached on every render. Any e2e spec that
happens to open the first property then times out, in the customer app, for a reason created by an
API test suite. The failure names nothing that would lead anybody to the cause.

**Impact.** Development-only today, and it does not touch production — but it costs real hours and
it costs them dishonestly. It broke thirty-three customer-app e2e specs on 2026-08-24 during a
change that touched only the console and the API, and the failures pointed at hydration in a phone
field. The cost is not the rows; it is that the symptom appears in an app nobody was working on and
names nothing that leads to the cause. Left alone it gets worse monotonically, and the next person
to lose a morning to it will also start by suspecting their own diff.

**Recommendation, in order of preference.**

1. **A teardown that deletes by the slug prefixes the suites own** (`payout-test-%`,
   `payments-test-%`). Cheapest, keeps the reasons those four suites commit — chiefly that
   PostgreSQL's `now()` is transaction-start time, which a rollback harness cannot give them — and
   needs no change to how they are written.
2. **`db:reset-dev` before `pnpm e2e`** in the documented sequence. Honest and simple, but it
   discards fixture state a developer may be mid-way through inspecting, so it is worse as a default.
3. **Make the four suites roll back.** Correct in principle and the most work, and it would have to
   solve the `now()` problem each one has a reason for.

**Re-read §7b deviation 2 with the growth rate in it.** That entry accepts the commits on the
grounds of "30 bookings and 23 audit rows per run, in a development database". Every word is true of
ONE run and silent about a thousand; the measured state was 112 orphan properties and 12,636
bookings on a single fixture listing.

---

**Resolved, and NOT by deleting the evidence.** Bashar's constraint was to implement the cleanup
"while preserving append-only audit and financial evidence", and the accumulation turned out to be
deliberate: `payments.integration.test.ts` already had a teardown that keeps any booking carrying a
payment or a ledger entry, precisely because that is financial evidence. Deleting those rows was
never the fix.

What actually caused harm was one word: the fixture property was **`published`**. That made its
public payload 7.1MB — past the 2MB Next.js data-cache ceiling — and put it in Damascus search
results, so a customer-app spec opening the first listing timed out. Three changes, no deletions:

| Change                                                                                              | Effect                                                                                                                            |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `payments-test-property` created as `draft`, plus an idempotent `UPDATE` for databases that have it | No public page, no search entry, nothing fetches it. Every booking, payment and ledger row is kept                                |
| `payout.integration.test.ts` fixtures created as `draft`                                            | The suite rolls back, so this only matters for residue — and residue must not be discoverable                                     |
| An `afterAll` sweep on its own committing connection                                                | Deletes only rows with NO evidence attached (`NOT EXISTS` on bookings, payouts, properties), and DRAFTS whatever it cannot delete |

The 112 orphan properties were all `published`; 336 `partner_payout_items` reference their bookings,
so deleting them would have unpicked financial bookkeeping to tidy a fixture. They are drafts now:
every row kept, nothing discoverable.

**And it took something with it, which is the lesson.** Drafting the payments fixture broke three
`customer-locale.spec.ts` tests that used it as their checkout property — a customer-facing spec
depending on a test suite's private fixture, which is the coupling that made one property's growth
that file's problem. The spec now resolves a seeded published property at run time, the way
`findReference` does. _Before deleting, ask what it DID._

**Why it was not noticed earlier:** it degrades gradually and the failures land on specs nobody
associates with the cause. It is also invisible to `pnpm verify`, which never opens a browser.

---

### O-fin-4 — Nothing paired `fine_amount` with `fine_currency_id`

**Status:** **RESOLVED 2026-08-24** — enforced by a CHECK constraint ·
**Owner:** engineering · **Recorded:** 2026-08-24

`partner_violations` carries **no CHECK constraints at all**. A fine is two columns that must both
be set or both be null, and only the writing code says so. `finance.service.ts` now filters on both
being present, so a half-written fine no longer takes الدفع down — but it would DISAPPEAR from that
screen instead, which is a quieter version of the same problem: money the platform levied, invisible.

**Impact.** Latent, and money-shaped. Nothing writes a half fine today — `EnforcementService.fine`
sets both columns in one statement — so the realistic path in is a future writer, a data migration,
or a manual correction. What makes it worth a constraint rather than a note is the failure mode:
before 2026-08-24 a half-written fine took الدفع down entirely for every operator, and now that the
screen filters on both columns it would instead DISAPPEAR from الدفع — money the platform levied,
absent from the screen that reconciles it. The second is quieter than the first and therefore worse.

**Resolved.** `post/0009_fine_money_pairing.sql` adds
`CHECK ((fine_amount IS NULL) = (fine_currency_id IS NULL))` — the shape the waiver already set a
precedent for, where `waived_reason` is required wherever `waived_at` is set and the column stays
nullable for un-waived rows.

Verified before applying (0 of 7,679 rows violated it) and verified after, by watching the database
refuse a half-written fine: `violates check constraint "partner_violations_fine_money_paired"`. The
filter in `finance.service.ts` is now a belt beside a brace rather than the only guard.

---

### O-staff-5 — Three enforcement actions told the operator the partner was notified, and notified nobody

**Status:** **RESOLVED 2026-08-24.** All five events notify on two channels, driven in a browser and
confirmed in the mailbox · **Owner:** engineering · **Recorded:** 2026-08-24

`EnforcementService` makes exactly two `mail.send` calls: the suspension notice and the fine waiver.
There is no notification of any kind — no mail, no queue job, no `notifications` row — for a
warning, a fine, or a suspension being LIFTED. The console says otherwise, in as many words:

| Console message                            | Says                            | Sends   |
| ------------------------------------------ | ------------------------------- | ------- |
| `suspended` «أُوقف الشريك وأُبلغ بالسبب»   | the partner was told the reason | **yes** |
| `waived` «أُلغيت الغرامة وأُبلغ الشريك»    | the partner was told            | **yes** |
| `warned` «صدر الإنذار وأُبلغ الشريك»       | the partner was told            | **no**  |
| `fined` «فُرضت الغرامة وأُبلغ الشريك»      | the partner was told            | **no**  |
| `unsuspended` «رُفع الإيقاف وأُبلغ الشريك» | the partner was told            | **no**  |

**Impact, and why this is the sharpest of the open items.** A warning nobody receives is not a
warning — it is a record that the platform can later cite against a partner who was never told. The
whole point of `warned` being its own rung (rather than inferred from a fine) is that somebody TOLD
them, and that is the fact an appeal turns on. Meanwhile the operator has been given an explicit
assurance that the telling happened, so nobody follows up. The unsuspension case is smaller but the
same shape: a business is trading again and may not know it.

This is the defect class this register keeps returning to — a true-sounding sentence that describes
an intention rather than a change (`O-staff-2`, and the docblock that claimed آخر نشاط had moved).
Here it is worse than a docblock, because an operator reads it.

**Recommendation.** Send the three notices, do not weaken the copy. The portal now renders the
warning note (fixed 2026-08-24), so the partner has somewhere to read the detail; what is missing is
the nudge that sends them there. Each is a template in `messages/email/{ar,en,de}.ts` composed by
the one helper, **Arabic first and English underneath** per the standing rule, and asserted in
`mail.templates.test.ts` per template rather than per helper. Send outside the transaction and
swallow on failure, exactly as the two existing notices do — a mail server must not roll back an
enforcement decision.

**Bashar's answer, 2026-08-24:** _"The partner must be notified whenever an administrative or
financial enforcement action changes their status, obligations, or access."_ All five events, both
channels, no exceptions.

**What was built.** `EnforcementNotifier` — one class, five callers — deciding the six things that
were previously decided twice and then not at all: recipient, language, both channels, the link, the
audit, and what happens when delivery fails.

| Requirement                                    | How it is met                                                                                                                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| In-app notice per event                        | `notifications` row, `channel = 'in_app'`, `status = 'sent'` — the row IS the delivery, so `queued` would make the `safra_notifications_1h` gauge read a success as stuck       |
| Email per event                                | Through `NotificationService.notify`, so the attempt, the outcome and the retry count are recorded like every other notice                                                      |
| Partner account's preferred locale             | `users.preferred_locale`, joined from the partner in the same row as the address — one query, so language and recipient cannot be chosen in two places                          |
| Arabic, English and German                     | `compose` already orders ar → en → theirs, per the standing email rule. Five templates, three locales, asserted per template in `mail.templates.test.ts`                        |
| Action, date, reason, secure link              | Every body carries all four. The link is always an authenticated portal page                                                                                                    |
| Amount and currency for fines and waivers      | Formatted by the caller, which holds the currency code — the template never invents a money format                                                                              |
| No internal notes or unnecessary personal data | `suspended_notes` reaches no template. The delivery audit carries `{ templateKey, inApp, email }` and no address — asserted by walking the whole payload, not by naming a field |
| Delivery failure must not roll back            | Every notice is sent after its transaction commits, and `EnforcementNotifier` cannot throw. Held by two tests that make BOTH channels fail and assert the decision stands       |
| Attempts recorded without addresses in logs    | `deliver()` already redacted; `notify()`'s ENQUEUE path did NOT and had logged «SMTP refused the message for host@example.test». Now redacted through the same helper           |
| Console must not claim more than was attempted | Creation is attempted for all five, so «وأُبلغ الشريك» is now true where it was false for warning, fine and lift                                                                |
| Audit distinguishes action from delivery       | `partner.notified` is its own action, written after the transaction. One delivery row per enforcement action — 41 for 41, verified in the browser walkthrough                   |

**Verified in the mailbox, not only in a test.** The walkthrough of 2026-08-24 cleared mailpit, drove
warning → fine → suspend → unsuspend → waive in a browser, and read the result: five distinct
subjects, each Arabic first with English after the `·`, each body carrying the date, the reason and
the portal link, each addressed to `users.email`.

---

### O-staff-6 — An enforcement action's confirmation is unmounted by the refresh that succeeds

**Status:** **FIXED 2026-08-25** — the notices outlive the controls, held by a spec watched to fail
first · **Severity:** Medium · **Owner:** engineering · **Recorded:** 2026-08-25

Found while verifying an unrelated copy change on مخالفات. `ViolationActions` holds its success
message in its own state and renders it INSIDE the guard that decides whether the component exists
at all — `apps/admin/src/components/violation-actions.tsx:130` and `:139`:

```tsx
if (!canWarn && !canFine && !waivable && !escalatable) return null;
…
{done ? <p className="text-[11.5px] text-ok">{done}</p> : null}
```

`submit()` ends `setDone(success); setOpen(null); router.refresh()`. The refresh re-renders the row
with the write applied, and the write is precisely what turns the last remaining flag false: a waive
sets `violation.waiver`, so `waivable` goes false. On a row that was already warned and already
fined, belonging to a partner already suspended, all four flags are then false, the component
returns `null`, and **the confirmation the operator was owed disappears in the same tick it was
written.**

**Why it looks random and is not.** Whether the message survives depends on whether any OTHER action
remains offerable on that row, which is data — not timing. A waive on a row that can still be
escalated keeps the block mounted and the message shows; the same waive on a fully-progressed row on
a suspended partner shows nothing at all. `e2e/enforcement.spec.ts:264` failed on this once in four
runs on 2026-08-25 and passed the other three, which is what a data-dependent branch looks like from
the outside. The captured DOM in `test-results/…/error-context.md` from the failing run shows the
row in exactly the all-four-false state: warning note present, fine present, waiver applied, partner
suspended — and no message.

**Impact.** The operator gets no confirmation for the one enforcement action that moves money back
to a partner. The ledger entries are correct and visible on reload, so nothing is lost; what is lost
is the acknowledgement, and the likely reaction to a control that vanishes silently is to do it
again. `O-staff-5` was the mirror image of this — a message that claimed more than had happened;
this is a change that happened and says nothing.

**What unblocks it.** Nothing external. The fix is to stop letting the guard own the message: either
render `error`/`done` above the `return null` (a small wrapper that renders the two notices whether
or not any control remains), or hold the notice on the row rather than in the per-action component.
Prefer the first — it keeps one component responsible. Both directions of the pair need it: `error`
is behind the same guard and disappears the same way, though a failed write leaves the flags
unchanged so it is much harder to hit.

**How to hold it.** Watch the assertion fail first. Drive warn → fine → suspend → waive on one row
in a browser; before the fix the confirmation is absent, after it the confirmation stands with no
controls beside it. The existing spec covers the happy path only by accident, so give it a row that
is deliberately exhausted rather than whichever row the fixture happens to offer.

**What was done, 2026-08-25.** The guard no longer owns the notices. `idle` names the
nothing-left-to-offer condition, and the component returns `null` only when it is idle AND has
nothing to say; when it has something to say it renders the notice with no controls beside it. Both
notices moved into one `Notices` helper, rendered from both branches — written once so the pair
cannot drift, which is the shape of half this register's entries.

`error` is fixed by the same change and is NOT separately tested, deliberately: a failed write leaves
every flag as it was, so `idle` was false when the control was pressed and stays false. Reaching
idle-and-erroring needs the row to change underneath the reader between the click and the response.
It is covered by construction rather than by an assertion, and saying so is better than a test that
cannot reach the state it claims to protect.

**Held by `e2e/enforcement.spec.ts` › «a waive that exhausts the row still confirms itself».** It
builds the state instead of hoping for it — raise, warn, fine, escalate, then waive, which is the
order that turns all four flags false — and asserts the confirmation IS on screen together with
`toHaveCount(0)` for all four controls. The second assertion is what makes the first one mean
anything: without it a future change that left one rung alive would keep the test green while never
entering the state the message has to survive.

**Watched to fail.** Reverted the component to `HEAD`, confirmed the file really changed back
(`grep -c 'function Notices'` → 0), rebuilt, re-copied the standalone static tree and restarted the
console, and the new test failed on exactly its own line — `enforcement.spec.ts:531`, «element(s) not
found» for «أُلغيت الغرامة وأُبلغ الشريك.». Restored, rebuilt, restarted: 4 passed. The first test
in the file, the one that had been failing one run in four, passes with it.

---

### O-cons-2 — The rows-per-page bar answered a JSON document on five of the console's tables

**Status:** **RESOLVED 2026-08-25** — the bar, the sibling table it sits beside, and every other
browser navigation · **Found by** Bashar, using a table with two rows in it ·
**Severity:** Medium as a defect, **High as an experience** — the console vanished and left a raw body

**What he met.** On a small table, choosing 25 rows instead of 10 — or typing a page number —
produced a bare document reading `{"message":"Unknown table or size."}`. No shell, no sidebar, the
back button the only way out.

**The cause was one word.** `/api/table-page-size` read `field('size')`, the literal name. Five of
the console's tables NAMESPACE their parameters, because they share a route with a registry that
already owns `?page=`: the two verification queues post `queueSize`, آخر نشاط الموظفين posts
`activitySize`, a partner's violations posts `vsize`, the staff scope map posts `scopeSize`. For all
five `field('size')` was `undefined`, so a perfectly well-formed submission failed validation. Both
controls live in one form, which is why the page number died with the size.

**`listParamsFor` had already learned this exact lesson on the READ side**, in almost these words —
it "took a section and then ignored it for the parameter names". This was the write side of the same
mistake, unfixed, one file away. The section must be parsed FIRST, because the size field's NAME
depends on it; a single `safeParse` of both cannot be the first question asked.

**Why 250 browser tests passed over it.** Every existing submit assertion drove `/bookings`, which is
not namespaced. Not weak assertions — the easy table, which is the same shape as
`detail-return.spec.ts` having to be written against the LAST row of a full page. The spec added here
drives a namespaced bar.

**Three more defects came out of it, none of them what was reported:**

| Found                           | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| In a browser, from the new spec | **Submitting either bar on a two-table screen threw the OTHER list back to page one.** The redirect forwarded only `q` and `status`; and `/staff`'s registry bar passed `query={{}}` under a comment saying there was no second table — true for one day, until the activity panel arrived on 2026-08-24. `/partners` and `/properties` both carried `{ q }` and had the same gap. «Every paging control carries the filters forward» failing where two tables make it invisible, because the list that moves is not the list being touched |
| Sweeping for the reported shape | **Seven routes across all three apps answered a body to a browser navigation** — the export download and request, a verification document, a contract PDF on both the console and the portal, the currency switcher, and the invoice PDF. Four of them also forwarded the API's STATUS, so a 403 and a 404 were distinguishable from outside: fixing the screen closed a small enumeration oracle as a side effect                                                                                                                          |
| Bashar, mid-fix                 | **Controls that cannot do anything were still live.** Both arrows correctly greyed on a one-page table, and beside them a page box inviting a number and a تطبيق inviting a press. His instinct and his own standing rule agreed on the remedy: DISABLE, never remove, because the bar's five parts are the same under every list                                                                                                                                                                                                           |

**What the fix is, in one line each.**

- **The section is parsed first**, then `TABLE_SECTION_PARAMS[section]` names the size field.
  `isTableSection` in `@safra/contracts` exists so the two questions can be asked in that order.
- **No exit carries a body.** Every refusal on every browser-navigated route is a `303` to a LITERAL
  path — the console root, `/login`, or the list the reader came from with one flag that a page turns
  into a catalogued Arabic sentence. `apps/admin/src/lib/no-json-screens.test.ts` asks the general
  question: it reads every `<form action>` and `href` in the three apps, resolves them to route
  handlers, and fails if one can produce a body. Nine navigations found; watched to report all seven.
- **An unusable size is IGNORED, not refused.** The redirect then carries no size and `resolvePageSize`
  falls through to what the reader had saved — rather than shrinking a hundred-row audit view to ten
  because one field was malformed.
- **The sibling table's place travels**, as clamped integers under names taken from
  `TABLE_SECTION_PARAMS` and never from the form.
- **`barState` decides which controls are dead**, and it is a function so the one case a browser
  cannot reach on this database can be asked directly: **a 25-row table shown at 100 is also one
  page, and there the size select is the only way back down.** `sizeIsMoot` is therefore
  `total <= smallest offered size`, not `pages <= 1` — collapsing the two was the tempting wrong
  answer and the unit test catches it.

**The lesson worth keeping.** A skipped test reports coverage it does not have. The first draft of the
25-rows-at-100 assertion hunted the development database for a qualifying table, found none, and
**skipped** — green, and proving nothing. A full page of 100 rows looks exactly like the first page of
many, so the guard could not tell. Moving the decision into a pure function is what made the
assertion askable.

**Where:** `apps/admin/src/app/api/table-page-size/route.ts`,
`apps/admin/src/components/table-pagination.tsx` + `table-pagination-state.ts`,
`packages/contracts/src/table-preferences.ts`, the three two-table pages, and the seven routes listed
above. `pnpm verify` 2,919 (nothing skipped, `DATABASE_URL` exported) · `pnpm e2e` 277.

### O-staff-2 — صفحة الموظف shows no per-person activity

**Status:** open · **Owner:** engineering · **Recorded:** 2026-08-23

When مصفوفة الصلاحيات and نطاق العمل came off الموظفون on 2026-08-23, the page's docblock said آخر نشاط
"moved to the member's own record". **It did not.** Nobody built it, the detail payload carries no
history, and the sentence was written describing an intention rather than a change. It was then read,
believed, and repeated back as fact in a cross-session message before anyone checked — which is the
whole mechanism by which a false comment becomes a second source of truth.

The platform-wide list is back on الموظفون at Bashar's request (2026-08-23) and سجل التدقيق has the
complete record. What is missing is the narrow one: **what has this person done**, on their own page.

**Why it is worth building rather than closing:** the two answer different questions. Somebody
reading a colleague's record is deciding whether their access is right, and "signed in twice this
month and changed one booking" answers that where a platform-wide feed does not. `audit_log` already
carries `actor_user_id`, so the query is one indexed filter on the endpoint that already exists.

**When:** الإجراءات moved directly under الحساب on 2026-08-23, which shortened the record and left the
natural space for it at the bottom.

---

### O-staff-4 — The enforcement policy is built and DRIVEN, on both sides

**Status:** **CLOSED 2026-08-24** — console and partner portal both driven in a browser ·
**Owner:** engineering · **Recorded:** 2026-08-24 ·
**Updated:** 2026-08-24 (enforcement completion pass, then the portal pass)

Bashar's three enforcement policies of 2026-08-24 — suspend a partner, manage violations, waive a
fine — are implemented across the API, the console and the partner portal, and are on `origin/main`.
**What is not done is watching some of it work.**

**Driven in a browser and confirmed:** suspend → banner → unsuspend on the console; the violation
progression from record to warning to fine; **the waived fine rendering as its pair** — the original
struck through and legible, the balancing entry, the zero net, the reason and «Admin» beside them,
with no «—» anywhere, asserted rather than eyeballed.

**CLOSED on 2026-08-24 by the enforcement completion pass:**

- **`PAYOUT_FROZEN_BY_SUSPENSION` now has a surface.** The finding was understated: the console's
  release control did not merely fail to wire THIS code, it discarded EVERY code —
  `if (!response.ok) setError(payouts.failed)` never read the response body, so all eleven refusals
  the six payout controls can raise arrived as one vague sentence. It now uses `apiErrorOf`, the
  helper written the day before for exactly this defect, which the other fourteen console
  components already used. The freeze also had NO TEST; it has two now, a refusal and its opposite
  control, both watched to fail with the check disabled.
- **The violation ladder's fourth rung existed nowhere.** `violation_stage` has run
  `recorded → warned → fined → suspension` since the enum was written and **nothing ever wrote the
  last value** — it was accepted by the enum, listed in `VIOLATION_STAGES`, parsed by the portal's
  zod schema and given an Arabic label («رُفع إلى الإيقاف»), for a state no code path could produce.
  Five places consistent with each other and none with reality. `partnerSuspendSchema` now takes an
  optional `violationId`; `EnforcementService.escalate` writes the stage inside the suspending
  transaction, scoped by `partner_id` in the PREDICATE; and «تعليق الحساب على هذه المخالفة» on the
  console's violations screen is the control that reaches it. Driven in a browser.

**CLOSED by the portal pass, and it found the whole partner-facing half INERT.**

`e2e/partner-suspension.spec.ts` now drives the journey a suspended partner actually has: suspend
from the console, read the notice and the reason, be refused a write, meet «التحويلات موقوفة» on
المحفظة, sign in COLD with an emailed code, disappear from customer search, then be lifted and
recover. It passes. Getting it to pass required fixing three defects, and none of them would ever
have failed a test:

| Defect                                                                   | Effect                                                                                                                                                                                       |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /partner/me` selected neither `suspended_at` nor `suspended_reason` | `Shell` renders the notice from that field, so **the suspension notice could not appear on any screen for any suspended partner.** المحفظة's frozen line was unreachable for the same reason |
| `GET /partner/violations` selected neither `stage` nor `warning_note`    | **Every violation a partner read reported «سُجّلت»** whatever had really happened to it, and the warning written FOR them reached nobody                                                     |
| Both were masked by a zod `.default()`                                   | A field the API never sent parsed cleanly as a plausible value. Type check green, tests green, pages rendered                                                                                |

**The lesson, and it is the one worth keeping:** `.default()` in a response schema is a lie waiting
to be told. `.nullable()` says "this may be absent and I will handle it"; `.default()` says "if it
is absent, invent this" — and the invented value is chosen to look normal, so nothing anywhere
reports a problem. All three are now required-but-nullable, so an API that stops sending one fails
the parse at the point of the mistake. **Any `.default()` on a field that comes FROM the API is
worth re-reading in this light** — it is the same shape as the `label()` fallback that prettified
snake_case and hid forty-three missing translations.

**The fixture question, resolved and recorded so nobody re-derives it.** A dedicated suspended
partner was the first choice and is not reachable: the e2e layer touches nothing but the browser and
HTTP, so a partner must come from `seed-testbed.ts`, and re-running that seed deletes
`partner_violations`, bookings, payouts and payments for every fixture partner (line 719) — which
would destroy the waiver evidence this register cites as confirmed. A partner onboarded through the
console instead has no listings, bookings or payouts, so four of the seven behaviours would be
unprovable against it. So the spec suspends the partner the suite already holds a session for, and
OWNS the window: `workers: 1`, a self-healing lift before it starts, and an unconditional lift in
`afterAll` so a mid-spec failure cannot leak a suspended partner into later specs or later runs.
Verified after the run: zero partners left suspended.

**The lesson this work produced, and it is worth more than the feature:** six defects were found by
USING a screen, and none of them would have failed a test. A guard registered nowhere. A route with
no form. A validation pattern that matched nothing, so a fine silently refused with no request and
no error. A true sentence in the wrong place, twice. **Built, green, and connected to nothing** is a
state this codebase produces routinely, and only a browser pass finds it.

---

### O-book-1 — الحجوزات was read-only, and three staff capabilities had no way to be used

**Status:** **BUILT 2026-08-25** — driven in a browser, held by 25 assertions ·
**Owner:** engineering · **Recorded:** 2026-08-25

Bashar asked what was missing on الحجوزات (2026-08-25). The registry was complete; the booking
RECORD was read-only — zero buttons, zero forms, zero textareas — while the page's own footnote
promised internal notes, a status change, and the messages/WhatsApp/email history. Behind it sat
three staff capabilities nobody could exercise; see the update on `O-staff-1` for why the capability
sweep missed them.

**What was built.**

| Piece              | Where it lives                                                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Internal notes     | New `booking_internal_notes` table, `POST /admin/bookings/:reference/notes`, the section on §9.4                                        |
| Staff cancellation | `app/api/bookings/[reference]/cancel` → the endpoint that already existed. Reason required, stored verbatim, read by the customer       |
| Capture payment    | `app/api/bookings/[reference]/capture-payment` → likewise. Offered only from `pending_payment`, which is what `markPaid` asserts        |
| Cross-links        | Three cards to النزاعات / الرسائل / واتساب والبريد, each filtered by this booking's reference, each carrying the COUNT of what is there |

**A table, not the column that was waiting for it.** `bookings.internal_notes` is a single `text`,
so the second writer would have erased the first — the defect `partner_application_contacts` exists
to fix on another screen (`O-partner-7`). The new table is append-only, and enforced: a
`deny_mutation` trigger refuses UPDATE, DELETE and TRUNCATE. The column is left alone; it holds
nothing and never did.

**The console does not own the state machine.** `allowedTransitions` has carried the docblock "for
building a UI" since it was written and had never had a caller. The detail payload now returns
`actions: { cancel, capturePayment }` computed from it, so the console draws what the API will
permit rather than from a second copy of the transition table. `booking-actions-offered` asserts the
field against `canTransition` for all seven statuses rather than against a written-out list — a list
here would be a THIRD copy and would keep passing when the table changed.

**Notes are absent, not redacted, for a reader without the capability** — the same rule the payment
section follows, keyed on `booking.add_internal_note` since there is no separate read capability.
FINANCE holds `booking.read_all` for the money and does not see staff prose about a named customer.

**No embedded messaging** (Bashar, 2026-08-25): the links go to the sections that already own those
records. Each carries a count so a link says whether it leads anywhere — verified against the
destination, not merely rendered: the e2e asserts the number on the card equals the number of
`DSP-` references the filtered screen lists.

**Held by 25 assertions across four files**, and the four that matter were watched to fail against
the defect they describe: a read that returned only the newest note, a missing capability gate, the
note text copied into `audit_log`, and `cancel: true` for every status. Plus a fifth, on the guard
metadata: weakening the note endpoint to `BOOKING_READ_ALL` fails
`booking-write-guards.test.ts`.

**Driven, not only green.** Two notes added and both kept; capture on a `pending_payment` booking
moving it to `قيد التأكيد` and the cancel control appearing as the capture one left; cancellation
with a reason landing on the record; the dispute card claiming «٧ نزاعات» above a filtered screen
listing exactly seven. 390 / 768 / 1024 / 1440 with no horizontal overflow.

**What this leaves open.** `booking_internal_notes` joins the erasure reconciliation — recorded on
`O-sec-8`. The status actions are the two the API exposes; the transition table has more staff moves
(`confirmed → checked_in`, `checked_in → completed`, the dispute edges) and **no endpoint offers
them**, so they are not reachable from anywhere and were out of scope for "use the existing
endpoints". Whether they should get endpoints is a product question for Bashar.

---

### O-staff-1 — Three capabilities are still grantable with nothing behind them

**Status:** open · **Owner:** **Bashar** (a product decision, then engineering) ·
**Recorded:** 2026-08-23

The employee feature ships with a role form that lets a super admin, and a partner, tick capabilities.
A capability with no feature behind it is a **promise gap** rather than a security hole: nobody gains
access they should not have, but somebody believes a job has been delegated and it has not. That is
its own defect and it is the one people notice last.

Two sweeps ran on 2026-08-23 — one over the console's 63 capabilities, one over the partner's 11 —
both by reading the actual `@RequirePermissions` metadata rather than grepping. Between them they
found **no unguarded route that exists**. What they found is capabilities with no feature:

| Capability         | State on 2026-08-23                                                                                                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `booking.check_in` | **Closed.** `GET /partner/arrivals`, `POST .../check-in`, `POST .../undo-check-in`                                                                                                             |
| `violation.read`   | **Closed.** `GET /partner/violations`                                                                                                                                                          |
| `price.update`     | **Closed.** Checked PER FIELD at four sites — `create` with `initialUnits`, `addUnit`, `updateUnit`, `updateRange`. See `price-authority.ts` for why it is not a route guard                   |
| `violation.manage` | **OPEN.** No route writes `partner_violations` at all                                                                                                                                          |
| `violation.waive`  | **OPEN.** Nothing writes `waived_at`. The partner screen already RENDERS a waived row, so the read side is ready and the write side does not exist                                             |
| `partner.suspend`  | **OPEN.** `partners.suspended_at` is enforced on both branches of `attachOwningIds` and written by no route. Whoever wires the button will reasonably assume enforcement is missing; it is not |

**Why the last three are not being built alongside the others.** Waiving a fine is a decision about
money that SAFRA has already levied, and suspending a business stops its trade — both need Bashar to
say who may do it and under what record, which is a product decision rather than a wiring one.

**One constraint already established, from the screen that reads them** (project-cc, 2026-08-23):
**a waive must carry a reason, enforced at the point of waiving.** The partner-facing list renders a
waived row with its reason; when the reason is absent it can only say «أُلغيت» alone, and a mark that
says a decision happened and refuses to say what it was is worse for the partner than no row. So the
waive endpoint takes a required reason and `waived_reason` becomes `NOT NULL` where `waived_at` is
set — a CHECK constraint, since the column must stay nullable for un-waived rows.

**Until then, the honest options** are to hide the three capabilities from both role forms, or to leave
them and accept that ticking one does nothing. Leaving them visible is the current state and it is the
worse one; hiding them is a small change to `STAFF_ASSIGNABLE_PERMISSIONS` and
`PARTNER_EMPLOYEE_PERMISSIONS` and can be done the day Bashar says so.

**Update, 2026-08-25 — the table above is stale in both directions, and the sweep had a blind spot.**

The three rows marked OPEN are all CLOSED: `violation.manage`, `violation.waive` and
`partner.suspend` were built by the enforcement work of 2026-08-24 (`O-staff-4`). Left uncorrected
they read as three outstanding promise gaps that no longer exist.

More usefully, **the sweep asked the wrong question of the booking capabilities.** It looked for
capabilities with no ROUTE, and these three had routes:

| Capability                  | What was actually missing on 2026-08-25                                                                                                               |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `booking.cancel`            | `POST /bookings/:reference/cancel` existed, staff-gated, commented "Staff cancellation (§9.4)" — and **no console screen called it**                  |
| `booking.update_status`     | `POST /bookings/:reference/capture-payment` existed, staff-gated — and **no console screen called it**                                                |
| `booking.add_internal_note` | Worse: a COLUMN (`bookings.internal_notes`), a role-form checkbox, an Arabic label — and **no route at all**, so nothing could ever have written it** |

All three shipped in the built-in `OPERATIONS_MANAGER` role, so a super admin naming an operations
role has been delegating them since the role existed. The console had no `app/api/bookings`
directory whatsoever, which is the single fact that would have found all three in one look.

**The lesson for the next sweep:** "does a route exist" is not the question. The question is **can a
person reach it**, and the cheapest proxy for it in this codebase is whether the console has a proxy
route for the section. All three are now built — see `O-book-1`.

---

### O-fin-3 — A gift card can only be bought with wallet balance

**Status:** built, with the funding source constrained · **Owner:** **Bashar** ·
**Recorded:** 2026-08-11

بطاقات الهدايا is built (`/account/gifts`, `GET|POST /gift-cards`, `POST /gift-cards/redeem`). Redeeming
a code credits the customer's WALLET, which is what Bashar asked for — the balance then composes with
every payment method rather than only with a booking.

**Buying is funded from the wallet, and that is a schema constraint rather than a preference.**
`payments.booking_id` is `NOT NULL`, so the payments table cannot record a purchase that is not for a
stay. A wallet debit is a complete and correct purchase today — it refuses rather than going negative,
it is audited, it locks the row — but it means somebody with an empty wallet cannot buy a gift.

**What buying with a card would take:**

| Needed                              | Note                                                                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `payments.booking_id` made nullable | A money-path migration. Every reader of that column then has to handle a payment with no booking, including the ledger and the payouts view       |
| A `gift_card_id` leg on `payments`  | So a purchase is attributable. `LedgerContext.bookingId` is already optional, so the ledger side is ready                                         |
| A pending → active card state       | A card must not be spendable before its payment captures, which means a status the redeem path refuses. `gift_card_status` has no `pending` today |
| Webhook handling for the capture    | The existing provider flow resolves a BOOKING from the payment; it would need to resolve a card instead                                           |

**Also deliberately absent: nothing is emailed.** `recipient_name` and `recipient_email` are stored as
LABELS, so a buyer can tell their cards apart, and the UI says so in as many words — «للتمييز بين
بطاقاتك فقط — لا نرسل الرمز إلى هذا البريد». Delivering a code by email means a mail template and a
queue job, and it also means deciding whether a code in an inbox is acceptable at all: it is a bearer
instrument, so an email is a spendable secret sitting in somebody's mailbox.

**Two consequences of the cash-only rule, both accepted.**

A gift card may only be bought with الرصيد الحالي — the part of the balance that did not itself come from
a gift card (Bashar, 2026-08-11). محفظتي shows the split, derived gift-first from the immutable statement
rather than stored in a second column that every debit would have to keep in step
(`WalletService.composition`).

1. **It is a one-way ratchet.** Buying a card out of cash and redeeming it back converts cash into gift
   money permanently, and that is correct — you gave a gift, and money returning from a card is gift
   money. It does mean a browser test cannot buy-then-redeem on every run: four cycles emptied the
   testbed wallet's cash entirely. `e2e/customer-gifts.spec.ts` therefore proves the page and the
   refusals, and leaves the money moves to the integration suite, where they roll back.
2. **The split assumes the balance is explained by its history.** Every movement the app makes writes a
   `wallet_transactions` row, so that holds in production — but the testbed used to seed a bare balance
   with nothing behind it, and محفظتي then reported a wallet that had never seen a gift card as entirely
   gift-derived. `seed-testbed.ts` now writes the opening credit, and clears the gift-card, favourites
   and wallet-transaction rows it had never needed to clear before.

**The code is shown exactly once**, in the response to the purchase. It is stored only as
`sha256(normalised)` plus the last four symbols, never logged, and never returned by a read. A buyer who
loses it before passing it on needs staff to cancel and reissue — the same trade every gift card makes,
and the reason the console has no endpoint that reveals a code either.

---

## 6. Deferred until after launch

| Item                                            | Why it can wait                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Disputes**                                    | Messaging is no longer part of this gap: الدعم ships on all three dashboards (O-web-3). What remains is DISPUTES — the tables and the admin service exist, but nothing lets a customer or partner raise one, so a disagreement about a stay still arrives by phone. Deferrable while support tickets carry that traffic; stops being deferrable when a refund is argued over in a thread nobody can attach evidence to. |
| Remaining 12 of the 18 §9.3 admin sections      | The six built are those that block partner onboarding                                                                                                                                                                                                                                                                                                                                                                   |
| UK (OFSI), US (OFAC/SDN) and UN sanctions lists | Deliberate: EU-only suits a German entity under EU law. **Revisit before taking US or UK payments.**                                                                                                                                                                                                                                                                                                                    |
| Emergency Mode per city/country (EC-009)        | No operational need yet                                                                                                                                                                                                                                                                                                                                                                                                 |
| Gift cards and coupons (items 142–143)          | Compose cheaply onto the split-payment seam already built                                                                                                                                                                                                                                                                                                                                                               |
| Payment rails and payouts (items 84, 135)       | Deferred by Bashar 2026-08-01. Blocks taking money; does not block staff operation. Item 84 additionally needs item 194, payout mechanism per country.                                                                                                                                                                                                                                                                  |
| Redis-backed settings invalidation              | 30-second cross-replica staleness is accepted; bookings snapshot the values they used, so no booking can be corrupted                                                                                                                                                                                                                                                                                                   |

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

## 7b. Accepted deviations, re-evaluated 2026-08-08

Every deviation on the record, re-examined against one question: **would a person be harmed by this,
and would we find out?** Three changed status.

| #   | Deviation                                                             | Verdict                                                           | Reasoning                                                                                                                                                                                                               |
| --- | --------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Notifications send in the request**                                 | **Promoted to a task** — `docs/background-jobs-design.md` phase 2 | Acceptable at three low-volume notices; NOT acceptable once an SMTP timeout can sit on the booking path under load. Phase 2 removes it in ~2 days and is worth doing on its own                                         |
| 2   | **Four integration suites commit**                                    | **Genuinely acceptable**                                          | 30 bookings and 23 audit rows per run, in a development database. Each has a reason a transaction cannot solve — the sharpest being that `now()` is transaction-start time. Not worth contorting the tests              |
| 3   | **Console uses `OFFSET`**                                             | **Genuinely acceptable, with a measurement owed**                 | Bashar asked for numbered pages; there is no third mechanism. Bounded by a page ceiling and capped counts. The load test measures the real cost and may lower the ceiling (`docs/load-testing.md` scenario 3)           |
| 4   | **`/property/[slug]` caches for 60 s**                                | **Genuinely acceptable**                                          | A hidden review can persist one minute publicly. Bounded, and the remedy for a true emergency — unpublishing the listing — is not cached                                                                                |
| 5   | **Geography screens unpaginated**                                     | **Genuinely acceptable**                                          | Held to account by `geo-bounds.integration.test.ts`, which fails and names the work if they outgrow the screen                                                                                                          |
| 6   | **Media check warns rather than refusing to boot**                    | **Genuinely acceptable, now with an enforced path**               | `MEDIA_REQUIRE_PUBLIC=true` is set in `.env.example`, so a deployment that copies it gets the strict behaviour. Warning is the right default locally                                                                    |
| 7   | **Rate limiting fails open when Redis is down**                       | **Promoted to a monitored risk**                                  | A security control silently off. Not worth failing closed — that would take the whole API down for a cache outage — but it MUST be alerted (`docs/alerting.md`, signal 11) rather than merely documented                |
| 8   | **Photographs are not malware-scanned**                               | **Genuinely acceptable**                                          | sharp re-encodes every image, so the realistic payload does not survive. The residual is a decoder exploit, which fires before any scanner would run. See `docs/malware-scanning.md`                                    |
| 9   | **Identity documents are not malware-scanned**                        | **LAUNCH BLOCKER (should-have)**                                  | Was recorded as an accepted gap. It is not: the files are stored as uploaded, come from unverified partners, and are downloaded onto STAFF machines. That is the platform acting as a courier. ClamAV sidecar, 1–2 days |
| 10  | **`NEXT_PUBLIC_MEDIA_URL` and `S3_PUBLIC_URL` must agree, unchecked** | **Promoted to a deployment requirement**                          | Cannot be closed in code — different processes, different environments. A deployment-time assertion closes it, and it is now written down as such (`docs/media-integrity.md`)                                           |
| 11  | **No retention policy; audit log is append-only**                     | **LAUNCH BLOCKER (legal)**                                        | Previously "compliance dependency". It is a direct conflict between a design decision we made and an obligation we have, and it needs a written reconciliation, not a note                                              |

| 12 | **Phone validation costs +49 kB on two customer pages** | **Accepted, decided 2026-08-18** | `libphonenumber-js/max` reaches the browser because `phoneSchema` lives in `@safra/contracts`, which the client imports: register 177 → 226 kB, checkout 170 → 220 kB first load; the SHARED chunk is unchanged. Bashar chose to keep it. The alternative — moving the refinement behind an API-only schema — buys the bytes back and removes the client's ability to reject a bad number without a round trip. Since the cost is paid either way on those two routes, the field USES it: `auth-form` validates with the same `phoneSchema` object the API does, so the two cannot drift |

**Summary of changes:** two deviations became launch blockers (9, 11), three became tasks or
requirements (1, 7, 10), six stand as accepted, and one (12) was added and accepted on 2026-08-18.

## 8. Known risks and traps

### `cp -R static dst/static` NESTS instead of replacing, and serves the previous build's client JS

Found 2026-08-24, the hard way, having followed the standing rule and still got it wrong.

The rule says build, then **copy `.next/static` and `public` for all three apps**, then restart. What
it does not say is that `cp -R apps/x/.next/static dst/.next/static` behaves differently depending on
whether the destination already exists — and after any previous session it does. The copy then lands
at `dst/.next/static/static/`, the top level keeps the PREVIOUS build's chunks, and nothing complains.

**What that looks like is not a missing asset.** The standalone tree's `server.js` and `.next/server`
ARE regenerated by the build, so server-rendered HTML is new while the client chunks are old. Every
page renders, every asset spot-check returns 200 — the hashes that changed are the ones you did not
happen to fetch — and the failure surfaces as **hydration**: a phone field rendering as its hidden
input, a password toggle that is not there, `locator resolved to 0 elements`. Thirty-three specs
failed across the customer app on a change that touched only the console and the API, which sent me
looking for data corruption and an accumulating fixture instead of at my own copy command.

- **`rm -rf` the destination, then copy.** `rm -rf dst/.next/static && cp -R src/.next/static dst/.next/static`.
- **Check for the nesting directly** — `ls dst/.next/static` showing a `static` entry is the tell.
- **Verify EVERY asset the page asks for, not one.** Extract every `/_next/static/*.{js,css}` from
  the served HTML and fetch them all. One spot-check passes against a stale tree; sixteen do not.

The existing rule is right that the artefact is what matters. This is the step between "I copied it"
and "it is there".

### `now()` is the TRANSACTION timestamp, so rows written in one test all tie

Found 2026-08-14, in a suite that had passed for weeks. `audit_log.created_at` defaults to `now()`,
and PostgreSQL's `now()` is `transaction_timestamp()` — so every row a test writes shares one value,
because `createRollbackDatabase` runs the whole test inside a single transaction.

A query ordering by it therefore leaves the order to the heap. `ORDER BY created_at` held insertion
order until a loaded parallel run happened not to, and the failure looked like a real regression in
the image audit trail.

**Order by `id` when asserting a SEQUENCE.** Every primary key here is `uuidv7()`: unique, and
time-ordered by construction. Ordering by a timestamp is fine when only one row is wanted, which is
what the other suites doing it are after.

**And it caught the load-data generator, 2026-08-20.** One statement per rung meant one `created_at`
per rung: 5,000,061 bookings across 86 distinct values, all 200,000 `confirmed` rows sharing exactly
one. That is not untidy, it invalidates measurements — the console's default order is
`created_at DESC, id DESC`, so every plan measured over that data was a sort over a nearly constant
column. A first reading of `?status=confirmed` came out at 236,526 buffers and looked like a missing
index; with realistic timestamps the same query is 46 and the planner had been right. Fixed in the
generator, and fixed in place for `bookings` (86 → 1,948,386 distinct values). `audit_log` and
`ledger_entries` are append-only by trigger, so they cannot be corrected in place and need the next
regeneration. **Any generator writing many rows per statement has this bug until it is spread
explicitly.**

### `next start` is NOT the runtime the apps ship, and it hides real bugs

All three apps build `output: 'standalone'`, which is what the container images run. `next start`
prints a warning saying it does not work with that setting, and it had been how the apps were started
for every `pnpm e2e` run in the project's history.

The two differ in one way that matters: the standalone server binds to `0.0.0.0`, and Next derives
`request.url` from the bound address rather than from the `Host` header. Under `next start` it binds
to `localhost` and the two happen to agree. Measured 2026-08-20, the first time the suite met the real
runtime:

- The customer app's currency switcher **answered 403 to every real browser** — its CSRF guard
  compared `Origin` against `new URL(request.url).origin`, which is `http://0.0.0.0:3000`.
- Every POST-then-redirect sent the browser to `http://0.0.0.0:PORT/…` — a different origin, so the
  session cookie did not travel.
- A runtime `notFound()` renders a blank body without JavaScript.

**Start the apps the way the container does** before trusting a browser run:

```bash
cp -r apps/<app>/.next/static apps/<app>/.next/standalone/apps/<app>/.next/
(cd apps/<app>/.next/standalone/apps/<app> && PORT=<port> node server.js)
```

**Build redirects with `seeOther` and check origins with `isSameOrigin`** — both in `@safra/session`.
A relative `Location` has no host to get wrong; comparing `Origin` to `Host` compares two values the
browser set.

### Drizzle's `.desc()` emits `DESC NULLS LAST`, which no plain `ORDER BY … DESC` can use

Found 2026-08-20 while indexing «طلبات الشراكة». PostgreSQL's `ORDER BY x DESC` means
`DESC NULLS FIRST`; drizzle's `index(…).on(t.col.desc())` emits `DESC NULLS LAST`. Different
orderings, so the index cannot remove the sort — and **the failure is completely silent**: the index
is created, it is valid, `\di` lists it, and the plan does not change.

| Same query, same data                   | Result                              |
| --------------------------------------- | ----------------------------------- |
| No index                                | 765 buffers, Seq Scan + Sort        |
| Index built with drizzle `.desc()`      | **765 buffers, Seq Scan + Sort**    |
| Same columns with PostgreSQL's defaults | **27 buffers, Index Scan, no sort** |

A prefix of the sort key is not enough either: a single-column `(created_at DESC)` changed nothing,
because the query's tiebreaker is `reference DESC`. **Write an index intended to remove a sort as raw
SQL in `migrations/post/`,** where the ordering can be stated exactly —
`post/0007_registry_order_indexes.sql` is the worked example. `.desc()` is still fine for an index
whose job is a range scan on an equality predicate, which is what `bookings_status_created_idx` does.

### The footer is on every page, so a loose selector is now ambiguous

Added 2026-08-13 with the site footer. Two specs broke the moment it shipped, both for the same
reason: an assertion that had been unique became a strict-mode violation.

- **`button[type="submit"]`** now matches three more buttons on every page — one per currency in the
  footer's picker. `customer-review.spec.ts` used it for a sign-in form. Name the button.
- **`getByRole('link', { name: … })`** for an account destination matches the account nav AND the
  footer's column. Scope it — and note that the account shell's `aria-label` is on the ASIDE, so it
  is `getByLabel(...)`, not `getByRole('navigation', …)`.

The older half of the same trap is already recorded: never `button[type=submit]).last()`, which
finds the sidebar's sign-out.

### Fixtures can assert things the product never could

Three times now a seeded fixture has published something impossible, and each time it was found by a
test failing for an unrelated reason rather than by anyone looking:

- A property declared `rating: '4.9', reviewsCount: 118` as literals while a trigger owned both
  columns, so a listing advertised a score with zero reviews behind it (2026-08-07).
- A DRAFT listing accumulated ninety days of completed stays and eight reviews, and the trigger gave
  it 5.0 stars — a listing no customer had ever been able to book (2026-08-08).
- The customer-review browser test depended on an un-reviewed stay that existed only by arithmetic;
  adding two listings closed the gap and broke a test with no relationship to the change (2026-08-08).

**The rule this suggests: a fixture a test depends on must be arranged on purpose and named, not left
to fall out of a loop.** The seed now reserves the customer's most recent completed stay explicitly,
by email, and restricts bulk bookings and reviews to PUBLISHED listings.

Not yet enforced by anything. A `db:testbed` self-check — no unpublished listing has a rating, every
fixture a spec names exists — would catch the next one at seed time rather than three specs later.
Owner: engineering.

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

### Second pass — 2026-08-14

A full sweep, prompted by Bashar's standing instruction that every implementation ends with a
security pass. Eleven checks: secrets in the diff, every `sql.raw` call site, XSS sinks, route
authorisation, session cookie flags, rate limiting, public routes, dangerous primitives, private
storage prefixes, PII in logs, clickjacking headers and the metrics token comparison.

**Three findings, all fixed in `e2b5394`. None would have been caught by a test.**

| Finding                                                      | Severity | Why it mattered                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A staff email address written to a log line                  | Low      | Rule 1 forbids PII in logs; every other line logs `user.id`. Logs travel to aggregation and backups                                                                                                                                                                                                              |
| `x-safra-pathname` trusted where the middleware does not run | Low      | The matcher excludes paths containing a dot, so that header is the CLIENT's on those routes. Nothing exploitable was reachable — `swapLocale` cannot leave the origin and the currency route re-validates `next` — but a request value used to build a link should not rest on two other functions being careful |
| `POST /{locale}/currency` accepted a cross-site submission   | Low      | It takes no session, so `SameSite` on the session cookie did not protect it. Another site could change a visitor's display currency — small impact, but the shape of a CSRF                                                                                                                                      |

**Verified sound this pass:** every `sql.raw` argument is a literal or a constant (10 call sites,
up from 2 — the growth is why the old claim needed re-checking); every admin and partner controller
carries a permission decorator; session cookies are `HttpOnly` + `Secure` + `SameSite=Strict`;
`frame-ancestors 'none'` and `X-Frame-Options: DENY` are both live; the metrics token uses
`timingSafeEqual` behind a length check; `exports/` and `incoming/` are absent from the bucket's
anonymous-read grant; there is no `eval`, no `new Function`, no `child_process`; and the one
`redis.eval` runs a constant Lua script.

### Verified sound — attacks attempted and defeated

Each row is a thing that was actually tried against a running instance.

| Attack                                              | Result                                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Read another customer's booking                     | `404` — not `403`, which would confirm it exists                                            |
| Cancel / partner-confirm another's booking          | `403`                                                                                       |
| Reach any `/admin/*` route as a customer            | `403` on all five tried                                                                     |
| Reach `/partner/*` as a customer                    | `403`                                                                                       |
| Set `role: super_admin` at registration             | `400`, unknown key rejected by `.strict()`                                                  |
| Set `permissionOverrides` at registration           | `400`                                                                                       |
| Enumerate accounts via login                        | Identical message for known and unknown                                                     |
| Enumerate via password reset                        | `204` for both                                                                              |
| CORS from `https://evil.example`                    | No `Access-Control-Allow-Origin` returned                                                   |
| Brute-force one account                             | `401`×5 then `429`; account locked even after clearing the IP counter                       |
| Replay a used refresh token                         | `401`, and the whole token family revoked                                                   |
| SQL injection via reference/query                   | Every `sql.raw` argument is a literal or a constant — re-verified 2026-08-14, 10 call sites |
| Path traversal on media                             | Allow-list pattern **and** a root-containment check                                         |
| 5 MB / 200 KB request body                          | `413`                                                                                       |
| Forge a log line via a newline in an email          | 0 forged lines — JSON serialisation escapes it                                              |
| Delete verified webhook evidence                    | Refused by trigger: "This row is evidence"                                                  |
| Delete audit / ledger / timeline / settings history | Refused by trigger                                                                          |
| Backdate a webhook's `created_at`                   | Refused by trigger                                                                          |

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

| Date       | Item                                                                                         | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-08-24 | **The violations that cost a partner money were the ones with no explanation**               | Reported twice from the screen. Adding a `description` column fixed only HAND-RAISED violations: the ones a partner actually receives are written by the platform — `sla.service.ts` levies `no_response` and FINES for it, `booking-actions.service.ts` records `rejected_after_payment` — and neither writes a word. So مخالفات showed a category, a date and a figure, and no explanation, on exactly the rows that took money. Fixed with a sentence per KIND resolved at render time and never stored: a generated sentence written into the row would be frozen in whichever language the sweep picked, which is «No user-facing text is written inside code» defeated one layer down, in the database, where no lint rule can see it. Both readers get one — worded for the business on the portal, for the reviewer on the console — and `violation-default-description.test.ts` fails if either catalogue misses a kind the enum has. **And المخالفات gained a page per item**, which it had never had: what happened, when, which booking, what was said, what it cost, whether it was forgiven, scoped to the partner in the WHERE clause so another business's violation answers as one that does not exist. |
| 2026-08-24 | **The partner-facing half of the suspension policy was inert**                               | `Shell` renders the suspension notice from `profile.suspension`, and `GET /partner/me` selected neither `suspended_at` nor `suspended_reason` — so the object never arrived and the portal schema's `.default(null)` read that silence as "not suspended". **The notice could not appear on any screen for any suspended partner**, and المحفظة's «التحويلات موقوفة» line was unreachable for the same reason. Separately, `GET /partner/violations` selected neither `stage` nor `warning_note`, both also defaulted, so every violation a partner read reported «سُجّلت» whatever had happened to it and the warning written FOR them reached nobody. Three defects, one shape: a zod `.default()` on a field the API never sent, which parses cleanly and renders plausibly. `O-staff-4` recorded these surfaces as "compile-verified" in good faith — compilation is exactly what they satisfied. Fixed in the API, defaults replaced with required-but-nullable, and held by `properties.integration.test.ts`, `arrivals.integration.test.ts` and `e2e/partner-suspension.spec.ts`. Found by suspending a partner in a browser and looking at their dashboard.                                                      |
| 2026-08-24 | **الدفع died on any violation that carried no fine**                                         | The fine branch of the الدفع union selected every row of `partner_violations`, including those with a NULL `fine_amount` — the ordinary state of a violation at `recorded` or `warned`. `financeItemSchema` types `amount` and `currency` as required strings, so ONE such row anywhere on the page made the console reject the whole response: «تعذّر تحميل هذه القائمة», no table, no counters, no pagination bar. The API answered 200 throughout, so no server log and no HTTP assertion could have shown it; the failure was entirely in the parse. It had gone unmet only because of ORDERING — rows come back newest first and the fixture's single un-fined violation sat thousands of rows deep. Recording a violation, the first thing the enforcement ladder asks anybody to do, puts one on page one. Fixed by filtering the branch on both fine columns; held by `finance-unfined-violation.integration.test.ts` with an opposite control proving fines still arrive. Found because two e2e specs failed on a screen the enforcement change never touched.                                                                                                                                                  |
| 2026-08-24 | **O-sec-14** — finishing 2FA enrolment left the session un-enrolled                          | `POST /auth/2fa/enable` revoked every session — including the caller's own — and returned no replacement, while `hasTwoFactor` reads the `totpEnabled` CLAIM off the access token and `rotateIfStale` only refreshes near expiry. So «حفظتها — متابعة» pushed to `/`, the middleware bounced it back to `/enrol-2fa`, and the reader watched a button do nothing for up to fifteen minutes — then was signed out rather than corrected, because the refresh token had been revoked too. Same code in both apps, under a comment in each asserting the behaviour it did not have. It fails CLOSED, so it denied access rather than granting it. Fixed by returning a replacement `session` from `enable`, minted after the revocation with claims rebuilt from the row just written, and writing it to the cookie in both BFF routes. Found by the first spec that ever created a staff account from nothing: every other spec signs in as an account that is already enrolled, so nothing had walked the transition                                                                                                                                                                                                      |
| 2026-08-23 | **O-e2e-2** — `customer-gifts.spec.ts:40` timed out deterministically                        | Neither recorded candidate was the cause. The cursor was ruled out by simulating the keyset walk in SQL against the live fixture — 21 disputes, three pages, `11/11/1` fetched, 21 rows seen, 21 distinct, no repeat and no skip, so the loop ran three times and not twenty. The cause was `waitForURL(/cursor=/)` on line 418: from the second iteration the URL ALREADY carries a cursor, so it matched instantly and waited for nothing. The loop then read the list mid-navigation — `.all()` snapshots the count from page two's ten rows while the DOM becomes page three's one row, so `nth(8)` waited for a row that would never exist until the budget was gone. That is also why the earlier attempt MOVED the failure onto «Show more»: making the read atomic left the un-awaited navigation in place, so the next thing touched was the link detaching. The read method was never the cause. Fixed by waiting for the link's OWN href and reading with `allTextContents()` — both needed, neither sufficient. Suite went 217/218 to **218/218**. The accumulation that made it reachable is now `O-e2e-3`                                                                                                  |
| 2026-08-20 | **Three load-test scenarios could not produce their own result**                             | Scenario 2 was capped at ten booking attempts a minute by a ROUTE-level `@Throttle` that `THROTTLE_DEFAULT_LIMIT` cannot reach — 2,259,751 of 2,259,812 requests refused, and **every k6 threshold passed**, because refusing a request is fast and a 409 is expected by design. Scenario 3 asked for `/admin/registries/bookings?…&size=`, which is neither the route nor the parameter name, so `setup()` threw on a 404 and there was no output at all. Scenario 4's bystander looped with no think time — 205 sign-ins a second against an allowance of ten a minute — so it starved itself and its threshold could never pass. All three fixed; the shape of the failure is the same as `O-scale-1`, and for the same reason: nothing had ever been run                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-08-20 | **The double-booking invariant could not detect a double booking**                           | `pnpm load:invariants` tested `GROUP BY unit_id, check_in HAVING count(*) > 1` — only two live bookings sharing an IDENTICAL check-in date. The constraint it stands for forbids any OVERLAP, so Aug 1–5 against Aug 3–7 on one unit returned no rows and printed `ok`. It was scenario 2's entire verdict. Replaced with a window-function check over adjacent stays per unit — deliberately not a self-join on `&&`, which would lean on the gist index the constraint itself creates and so degrade exactly when it is needed. Three tests drop the constraint inside a rolled-back transaction, write the overlap it would have refused, and require the check to find it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-08-20 | **Two uncapped scans on console request paths**                                              | The bookings registry's per-status counts were an uncapped `GROUP BY status` — no index leads on `status`, so the only plan is reading the whole table: **239,855 buffers on every page view**, and the console SUMMED them into an exact «٥٠٠٠٠٦١ حجزًا» printed above a bar correctly saying «أكثر من ١٠٠٠٠ نتيجة». The service's comment claimed it ran "over the `(status, created_at)` index", which did not exist. Now one capped count per status over a real index: **93 buffers**, with `capped` travelling alongside so the console prints «أكثر من N». «طلبات الشراكة» had no index for its own sort order — 765 buffers → 50                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-08-20 | **The per-account rate limiter could be bypassed, and aimed, with a forged header**          | `accountTracker` read `x-forwarded-for` and took the LEFT-MOST entry. A proxy appends, so that entry is client-controlled in every deployment: sixteen of sixteen wrong-password attempts against one account got through under the header shape a correct single proxy produces, against ten without it. Worse, it was aimable — forge the header to a victim's address, name their email, and their next real sign-in is refused, which is the targeted lockout the file's own header says keying on IP + email had eliminated. Now `req.ip`, which Express computes under `trust proxy`. The existing test asserted the OPPOSITE and now asserts the header is ignored                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-08-20 | **A failed idempotency release masked the real error and held the claim for 24 hours**       | `IdempotencyService` released a claim with a bare `await … DELETE` before `throw error`. When the release failed — 487 times in one run — `throw error` was never reached, the release's error replaced the real cause, and the claim stayed `in_progress` until `expires_at`. All three happen together because the reason the release fails is the reason the handler failed. The checkout form keeps ONE key per mounted form, so the customer's retry answered «الطلب قيد المعالجة» until they reloaded the page. Release is now best-effort and logged, the original error always propagates, and a claim abandoned past two minutes is reclaimed atomically                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-08-20 | **Four customer-facing refusals carried English sentences instead of error codes**           | A 429 answered `{"statusCode":429,"message":"ThrottlerException: Too Many Requests"}` — no code, English, and the framework's class name in a body anybody can read; `safra/no-hardcoded-text` cannot see it because the string is in a dependency. Losing the race for the last room threw an English `ConflictException` twelve lines below a correct `conflict(ERROR.…)`. The same-day cutoff and past-arrival refusals were two English sentences chosen by a ternary, and the customer app's fallback wrote the API's `message` straight onto an Arabic checkout form. Four new codes, translated in ar/en/de; the checkout form now resolves the code and never prints `message`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2026-08-14 | **O-i18n-2** — a German customer read Arabic where a number was masked                       | The row now stores a language-neutral token and each surface renders the reader's own word. Three traps behind it, all found by tests rather than review: stripping forged markers inside the redactor un-redacted messages on a second pass; the dispute count is derived in SQL and had the Arabic mask as a literal, so every "N details masked" notice silently went to zero; and old bodies cannot be migrated at all, because `messages` is append-only by trigger. See §5                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-08-14 | Codes reaching readers as words — property types, trip attributes, audit subjects, roles     | Bashar reported «rural_house» down العقارات and «internet business history» as chips. Four vocabularies were missing and one render site used `attribute.replace(/_/g, ' ')`, the expression the status rule names as forbidden. The staff INVITATION had the same defect in email: every language named the role in English. `navigation.spec.ts` now sweeps every leaf element on all nineteen sections for snake_case, which immediately found two more — `booking_export` on السجل and الموظفون — that no screenshot had caught                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-08-14 | Status pills stretched to their whole column                                                 | `StatusPill` was `inline-block`, which a grid or flex parent overrides with `justify-self: stretch`; several cells wrap it in a `<div class="grid">` to stack a note under it, so the pill filled the الحالة column and read as an empty input. `w-fit` on the component, and the console sweep now measures every pill against its own text                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-08-13 | Background jobs ran in requests or on unretried crons                                        | **O-notify-2, phases 1–6.** Five queues declared, four live: `mail`, `media`, `scheduled` and `exports`. Image encoding and CSV building left the request path — which removed a 20,000-row export truncation that existed only because the file was built inline — the five recurring jobs became repeatable queue jobs with retries and a dead letter, and the `@Cron` decorators are gone. Three of those five had never written a `scheduled_job_runs` row, including the SLA sweep, so the job whose silence costs customers their §6.4 compensation was the one alerting could not see. `webhooks` is deliberately not built: nothing sends an outbound webhook                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-08-13 | A lost queue was detectable but not re-drivable                                              | The recovery half of **O-notify-2**, and a precondition of launch blocker 2 — a restore drill that cannot re-drive has been performed rather than passed. `booking.needs_action` is rebuilt in full from its `booking_id`; the other three templates cannot be, because a `notifications` row deliberately holds no recipient, subject or body, so they are re-driven as a notice saying something is waiting and linking to the screen it is on. Runs every five minutes on the `scheduled` queue. Verified against the 34 notices stranded by the phase-2 job-id defect: all 34 found, rebuilt and delivered                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-08-13 | Remaining 11 of the 18 §9.3 admin sections                                                   | **The row was wrong, not the work.** All eighteen have been built for some time — each queries its own registry, pages it with `TablePagination` and paints its statuses through `statusTone`, and `navigation.spec.ts` sweeps every one of them. The register and a comment in `admin-sidebar.tsx` both still described a seven-built console, which is the kind of staleness that costs real time: it reads as a backlog and invites somebody to plan work that exists                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-08-13 | Disputes — no customer route into raising one                                                | Built. `POST /disputes` plus النزاعات in the customer account: the booking is resolved BY REFERENCE INSIDE the caller's own profile in one query, because opening a dispute freezes the partner's payout and a caller who could name a stranger's booking could freeze a stranger's money. Paid bookings only, one live dispute per booking per reason, prose masked by the same redactor as every stored message, `opened_by_user_id` left NULL as the schema intends. 18 integration tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-08-13 | A browsable bookings list — the SLA alert had nowhere to go                                  | The privacy reasoning stood, so this is not an index of every booking: EC-008's alert now links to `/bookings?expiring=1`, the same registry FILTERED to §6.4's confirmation windows about to lapse, ordered soonest-first rather than newest-first. The dashboard's count and the filter read one `SLA_EXPIRY_WARNING_MINUTES` from `@safra/contracts`, and `booking-sla-filter.integration.test.ts` fails if the number and the list ever disagree                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-08-02 | Staff 2FA enforced in the console but not the API                                            | `AuthService.login` demanded a TOTP code only if the account already had one enabled, so never enrolling was a way to opt out entirely — verified live: a `support_agent` with `totp_enabled_at IS NULL` read booking detail on a password alone. Closed by `StaffTwoFactorGuard`, with narrow exemptions for enrolment, `/auth/me` and public routes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2026-08-02 | Production could store ID documents on local disk                                            | `StorageModule` fell back to `LocalDiskStorage` with only a warning. Now a boot-time refusal, matching the `SMTP_URL` guard.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-08-02 | `settings_history` was mutable                                                               | Its siblings were append-only by trigger; it was not. Same trigger applied, with a regression test verified to fail when the trigger is dropped.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-08-02 | Booking timestamps rendered in the server's timezone                                         | `column::text` formats in the session timezone; correct only because the container is `Etc/UTC`. Now explicit `AT TIME ZONE 'UTC'`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-08-02 | Audit log unreadable without SQL access                                                      | `/audit` console screen plus a filtered, keyset-paginated endpoint.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-08-02 | Settings editable only by hand (P-005)                                                       | Rules Engine screen with per-schema validation, history and audit in one transaction.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-08-02 | Booking detail and timeline (§9.4)                                                           | Built. Payments section present only for `PAYMENT_READ` holders — absent, not redacted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-08-02 | Auth token table and mail delivery                                                           | Shipped earlier; tracker entry closed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2026-08-02 | Password reset, email verification, guest-booking claiming                                   | Shipped earlier with 24 integration tests; tracker entries closed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-08-04 | The listing review queue had NEVER loaded                                                    | `pendingPropertySchema` required a `status` field that `GET /admin/properties/pending` does not select, so `staffFetch` returned `'failed'` on every response and the queue showed "could not load this list" permanently. Silent — no log, no error. Fixed and covered by `apps/admin/src/lib/api.test.ts`, which asserts against a captured response and was verified to fail when `status` is reintroduced. See the trap in §8.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-08-04 | The dashboard did not resemble the approved design                                           | Rebuilt from `SAFRA - موقع سفرة 29.07.html`: 220px sidebar with all eighteen §9.3 sections, KPI row, attention panel, latest bookings, revenue sparkline, partner queue, recent activity. Backed by a new `DashboardService` that answers the whole screen in one round trip. Unbuilt sections and Emergency Mode render disabled rather than as dead links.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-08-04 | The console showed raw English identifiers in Arabic                                         | Booking statuses, staff roles and audit actions were rendered as `pending_confirmation`, `super_admin`, `auth.login_succeeded`. All three now map through `apps/admin/src/lib/strings.ts`, falling back to the raw key rather than blank.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-08-04 | Seeded partner named after a sanctioned individual                                           | `PAR-000002` renamed to `Sham Hospitality Farms` / `مزارع الشام للضيافة` by `UPDATE` — 3,148 bookings reference it, so deletion was not an option. The sanctions test fixtures keep the real designation deliberately: per ADR 0002 the residual EU Syria designations ARE those figures, and the name-folding rule exists to match them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-08-04 | The console palette was eyeballed, and wrong                                                 | Every colour in `apps/admin/src/app/globals.css` had been sampled from a screenshot before the handoff arrived: `--card` was `#15132a` against the specified `#17142F`, `--field` two shades too light, `--text` a neutral grey where the design uses a warm cream, and `--ok` / `--bad` / `--warn` / `--sky` were Tailwind defaults rather than SAFRA's. Individually invisible; together a different product. Replaced verbatim from handoff §9.1 and verified by reading computed styles in the browser rather than by looking at it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-08-04 | The console used the wrong UI font                                                           | Cairo, chosen as a guess before the handoff. §4.1 specifies IBM Plex Sans Arabic, which every spacing value in the handoff was measured against. Swapped for the console; the customer app has NOT been — see §8a.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-08-04 | `text-good` / `bg-good` matched no token anywhere                                            | The colour token is `ok` in both the handoff and the customer app, but twelve console files and two customer files used `good`. Tailwind generates nothing for an undefined token, so those elements silently kept their inherited colour — including two success banners in the customer app. Renamed throughout.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-08-04 | `pending_confirmation` was rendered in gold                                                  | The handoff makes it an explicit rule: pending confirmation is purple (`--pend`), never gold. Gold is SAFRA's affirmative accent, and a paid booking still waiting on a partner is not good news.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-08-04 | The last 4 console sections had no tables                                                    | `disputes` + `dispute_evidence`, `conversations` + `messages`, `notifications`, `advertisers` + `ad_campaigns` and `partner_contracts` created in one forward-only additive migration, with 6 enums, 2 sequences, 13 constraints and 3 permissions. Every constraint was probed against the live database to confirm it rejects the bad row. All 19 sections now render real data.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-08-04 | Contact-detail redaction leaked the local part of an email                                   | `ahmad@x.com` stored as `ahmad@⟨محجوب⟩`: the URL pattern matched the bare domain before the email pattern saw it. The test passed because it asserted only that a mask appeared and the count rose. Reordered email-before-URL; the test now asserts the original substring is wholly absent. Found by probing the live endpoint.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-08-04 | The ads screen could never load                                                              | `impressions` is `bigint`, which the driver returns as a string, against a `z.number()` schema. Same silent-parse-failure shape as the listing queue in the morning. Cast to text and coerced with `Number()`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-08-04 | A partner contract could never become active                                                 | Every upload starts `awaiting_partner_signature` and nothing could move it, so `active` was unreachable and a whole branch of the status vocabulary was dead. Added the mark-signed action; replacing now supersedes an unsigned contract too, which it previously did not.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2026-08-04 | The dashboard and the disputes section disagreed                                             | The dashboard KPI still said "the disputes feature does not exist" while `/disputes` showed six. Wired to the real count; a browser test now asserts the two screens agree, because two screens disagreeing is worse than either being wrong alone.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-08-04 | Staff scope existed only as a design column (B-12)                                           | Implemented as an enforced server-side model on Bashar's decision: two modes (`none` / `read_only` outside scope), writes refused outside scope in both, 404 rather than 403 under `none` so absence leaks nothing, and the audit log explicitly exempt and verified byte-identical for a scoped member. Applied to 9 registries, all 8 dashboard counters, all 4 reports, the finance ledger and the export. 26 unit tests plus live two-mode verification. Rules in the gap report §4a.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-08-04 | Scope enforcement was silently inert (found during B-12)                                     | `issue()` enumerates the claims it signs and `scope` was missing, so a real token carried none and every guard defaulted to unrestricted — while 26 unit tests passed. Found by decoding a live token. See the trap in §8.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-08-04 | Every scoped query returned 500 (found during B-12)                                          | `= ANY(${array}::uuid[])` — Drizzle sends a JS array as JSON and Postgres rejects it as a malformed array literal. Rewritten as individually-bound parameters. Invisible to unit tests by construction.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-08-04 | Booking exports left no trace (B-13)                                                         | The export generated CSV in the web tier, which cannot write inside the API's transaction. Moved to `GET /admin/bookings/export`, which records `booking.exported` with the actor, the filters, the row count and whether scope narrowed the set — before the bytes leave, so an abandoned download still leaves a record. Immutable by the append-only trigger; verified by attempting an UPDATE.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-08-04 | Arabic and German customers were shown ENGLISH API errors                                    | `auth-form.tsx` and `checkout-form.tsx` wrote the API's `message` straight into the field error under the input, so the screens where wording matters most ignored the locale. The API now answers with a stable `code` the client resolves against the reader's locale. Three browser tests assert the Arabic and German wording renders and that the English does not leak into either.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-08-04 | Eleven staff-console screens were written entirely in English                                | The booking, property and partner detail pages plus eight components had no catalogue import at all — invisible to a scan for Arabic literals precisely because they contained no Arabic. Found by the `no-hardcoded-text` lint rule, which is why it exists. ~118 strings translated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2026-08-04 | The password show/hide toggle was English on four of five fields                             | `PasswordField` defaulted its labels; they are now required. See the trap in §8.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-08-04 | The customer app had no `amenities` catalogue at all                                         | `getTranslations('amenities')` named a namespace that does not exist — the catalogue calls the city-attribute list `attributes` — so all twelve amenity codes rendered raw (`air_conditioning`) in all three languages. Found by the next-intl `Messages` type augmentation, which had never been wired up.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2026-08-04 | Upstream field errors never reached a customer's inputs                                      | `callAuth` returns a field→code map and the route forwarded it unchanged, but the form checks `Array.isArray(errors)`. Every API-side field error was silently dropped and the form fell back to a status-based message.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-08-04 | The staff console had no light theme                                                         | Recorded in the gap report as an accepted deviation; Bashar asked for the toggle. §9.2 implemented verbatim including the `*A` alpha triples — overriding only the `--color-*` set would have left every gold tint reading as the dark theme's over a white card. Seven browser tests, one of which runs under a light OS preference to prove the console stays dark until somebody presses the button.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-08-05 | The console was not responsive, and the title row had drifted                                | Bashar reported the date/role line sitting too far from the title on الشركاء and العقارات: the shell put it after the whole title block, which is as wide as its widest child, so a long subtitle pushed it across the header. The dashboard and the shell had each written their own header — they now share `ConsoleHeader`, so it cannot drift again. Measuring for the new responsive rule then found 7 of 19 sections scrolling sideways at 390px, caused by grid items defaulting to `min-width: auto`; one zero-specificity CSS rule per app fixed the whole class.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-08-05 | The console assumed the sidebar was always visible, and controls were too small to tap       | Audited first (see O-resp-2): 39 routes × 7 breakpoints found 13 distinct controls between 17px and 39px and the customer nav hidden below `sm`. The sidebar now collapses at any width with the choice persisted; the touch floor is CSS below `lg` rather than a convention. Re-audited to 0 findings. 25 new browser tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-08-05 | `/admin/staff` returned every row, and no table let the operator choose a page size          | The staff endpoint is now paginated like every other registry; `staff` is kept as an alias for `items` so existing readers keep working. All 14 paged registries gained a size control that survives search and paging and is clamped server-side. Geography's three reference tables are the documented exception, guarded by a bound test rather than a comment. (The keyset cursor this shipped with was replaced by numbered pages the same day — see the row below.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-08-05 | The console's tables offered only a forward-only "next page" — no page number, no total      | Bashar asked for the bar in his screenshot: `صفحة › [١] ‹ من ١٠٢ · اعرض [٢٥] صفًا · ٢٥٣١ نتيجة`, under the table. A cursor cannot address page 40, so all 15 console list methods moved to `OFFSET` + a count, 4 controllers and 14 pages moved from `cursor` to `page`, and `TablePagination` replaced `Pager` and the standalone size form. The count is capped at `COUNT_CAP` (10,000) over a LIMIT-ed subquery so it stays bounded work; past it the bar prints "أكثر من". Totals verified against SQL on the live database — bookings 4,298, partners 3,959, customers 6,868, payments 6,238 (a three-way UNION), audit 13,327 → capped. 21 browser tests, 15 unit tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-08-05 | The الحجوزات stay column printed over المبلغ, and the arrow pointed the wrong way            | Bashar reported the overlap. Three causes: the cell rendered two FULL dates (159px in a 133px `table-fixed` column, which spills rather than widening), `Ltr` forced the run left-to-right so «←» led away from the check-out, and the table's `minWidth` floor was below what its own content needed. Now `dateRange()` collapses the shared month and year (`04 ← 08-09-2026`), the cell is left to the RTL context, and four tables' floors were re-derived by measurement. A sweep of all 15 sections at three widths found the same defect class in `/partners`, `/properties` and `/comms` — all fixed, and `e2e/table-overflow.spec.ts` now holds every table to it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2026-08-05 | «القوائم» was unstyled text, linked to the dashboard, and lost the reader's place            | Bashar reported both. The control is now «رجوع» with the arrow on its right, styled like the console's other secondary controls, and returns to the exact page, size and filter: each registry row carries its list position into the detail link, and the detail screen rebuilds the list URL from a LITERAL base path — never from the URL, so a crafted link cannot redirect off the console. Unified across all four detail screens, which each had their own copy. Reached without a list (bookmark, dashboard, reference lookup) it falls back to the plain registry. `e2e/detail-return.spec.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-08-05 | The back control's arrow drifted to the left edge, and naming the section overshot           | Two corrections to the above, same day. «→» is bidi-NEUTRAL, so `'← {section}'` as a single string let the bidi algorithm choose the side and it chose the left; the arrow is now its own flex item, placed by `flex-direction: row` under `dir="rtl"`, which puts the first item on the right unconditionally — only the GLYPH is now a translation decision. And the visible label became the action, «رجوع», because naming the destination repeated the section the reader had just clicked out of; the destination survives as the `aria-label`, so four identical-looking controls are still distinguishable to a screen reader. Asserted on painted geometry, not DOM order.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-08-05 | The booking detail printed `confirmed`, `Unit`, `damascus` and `Booked as a guest`           | Bashar's screenshot. Only the last was copy written into a component; the other three were the API selecting the wrong COLUMN — `u.name_en`, `ci.slug`, and a `name_en ?? name_ar` that made the same booking read Arabic in the الحجوزات registry and English on its own detail screen. All three now coalesce Arabic first, like every other admin service. The status pill goes through `bookingStatus()`, the same lookup the registry's pill uses, so the two cannot disagree. Regression test asserts the pill against the catalogue and the city line against the slug shape.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-08-06 | لوحة الشريك did not exist — partners could only be driven by curl                            | A fourth app, `apps/partner` on 3002, for the reason ADR 0001 gives for the console being the third: a partner sees their own listings, guests and money and nothing of the other two surfaces. Own cookie, own CSP, own catalogue. Sign-in, the §7 shell, عقاراتي and an honest empty التقييمات. No 2FA gate, deliberately: the API asks partners for no second factor, so a gate would lock every partner out of an app they cannot enter.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-08-06 | The partner card showed a name and nothing else; the sidebar showed an email                 | `listOwn` now returns cover image, trip traits, "from" price, unit count, city, type, rating and badges in ONE query with two lateral joins — per-listing fetches would be the N+1 rule 2 forbids. The price is the CHEAPEST unit: a property with a $45 single and a $140 suite has no single nightly price and an average matches nothing bookable. Traits come from `TRIP_ATTRIBUTES`, the shared vocabulary the checklist says not to fork. The name comes from a new `GET /partner/me` rather than a JWT claim — tokens are cached 15 minutes and are sent on every request — and it takes no id, so ownership cannot be forgotten.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-08-06 | The partner image proxy pointed at an endpoint that does not exist                           | Found by the gap analysis, not by a test: no listing has a photo yet, so the route never fired. It was wrong twice — there is no GET to serve an image, and a listing photo is PUBLIC content already on safra.com, which is the line `StorageService` draws between `publicUrl` and an authenticated read. Replaced with the customer site's established `imageUrl` pattern, picking from `variantWidths` because the pipeline never upscales.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2026-08-06 | The database held 12,297 users and nothing anybody could test against                        | Bashar asked for the test data cleared and three شريك accounts added. `db:reset-dev` (guarded, transactional, refuses without `--yes` and outside localhost) removed 12,296 accounts and cleared 27 tables, keeping `ops@safra.test`, reference data and the append-only triggers. `db:testbed` then built three approved partners with six published properties, 88 bookings in every status, 28 payments, 16 guests, 12 staff, a dispute and a three-party thread. Both are idempotent. Amounts are computed the way `PricingService` computes them so the console's figures reconcile by hand.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-08-06 | Property title links on the customer search page were 21px tall                              | Under the 40px touch floor the responsive rule requires, and `responsive.spec.ts` had been GREEN — because the search page had no results to render. The clean testbed gave it six published properties and the violation appeared immediately. An anchor is inline, so the global floor in `globals.css` cannot reach it; it needs `inline-flex min-h-10 … lg:min-h-0`, and it is not exempt as an "inline" link because it is the card's main action.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-08-06 | Three fixture bugs the database refused, correctly                                           | Writing the testbed hit three guarantees in a row: the `EXCLUDE USING gist` double-booking constraint (the generator reused units with overlapping dates), `conversations_exactly_one_subject` (a thread attached to both a booking and a partner would appear in two inboxes), and the append-only trigger on `messages` — a SEVENTH immutable table the reset script's own check had missed. Each was the schema doing its job; the fixture was wrong every time.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-08-06 | Tables opened at 25 rows and forgot a change the moment you left                             | Bashar asked for ten everywhere, remembered against the ACCOUNT. Stored per table in a new `users.table_page_sizes` jsonb column, because ten bookings is a queue you scan and a hundred audit rows is a log you search. The section is an allow-list of fourteen literals — it becomes a KEY in a column read on every authenticated request — and the endpoint takes no user id at all, so ownership is not a check that can be forgotten. The bar became a POST that redirects: it was a GET form, and a GET that writes would let a prefetch or a pasted link change somebody's saved preference.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-08-06 | Saving a preference made the e2e suite stateful, and it failed a LATER run                   | Found by the change itself. `pagination.spec.ts` submits the size bar, which now writes to the shared staff account, so `navigation.spec.ts`'s "every table starts at ten rows" failed on the next run — a failure with no relationship to the code that caused it. The submitting spec now restores what it changed and the asserting one resets first, and the rule is written down: any spec that submits the bar puts the size back.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-08-06 | One status was three different colours depending on the screen                               | Bashar's instruction. Eleven tone functions and four hand-rolled pills across two apps: `expired` was red in الدفع, grey in الإعلانات, amber in بطاقات الهدايا; `approved` was sky for a property and green for a partner; a cancelled booking was red to staff and grey to the customer. One `statusTone()` in `@safra/ui` now keys every vocabulary by the status VALUE, and one `StatusPill` draws them. Three conflicts had to be settled — `expired`→warn, `approved`→ok, `completed`→ok — each recorded with its reasoning. A browser sweep over all 19 sections fails if one status text is painted two colours.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-08-06 | Six statuses reached an Arabic screen as raw English enums                                   | Found by the same sweep. The partner detail printed «approved», the property detail «pending review», document review named all five document kinds in English, and the partner type read «accommodation» while `partner_types.name_ar` sat unread — the same column-selection defect the الشركاء registry had fixed. All now go through the catalogue, and the sweep fails on any pill whose text is lower_snake_case Latin.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-08-06 | `statusTone('constructor')` returned the Object constructor                                  | Caught by its own new test. A plain object literal inherits `Object.prototype`, so a bare `MAP[status]` lookup returned a FUNCTION for `constructor`, `toString` and `hasOwnProperty` — a non-Tone escaping a return type that promised one, then indexing the class map to `undefined`. `Object.hasOwn` now guards it, the same guard `resolveOrigin` uses. The input is a database enum string with no compiler between it and the lookup, which is why it is tested.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-08-06 | Opening the الشريك or العقار card from a booking lost the booking                            | Bashar reported it. A detail screen only knew its own registry, so «رجوع» from the partner went to الشركاء — a list the reader had never been in. Cross-links now carry `?from=`, and the trip COMPOSES: partner → the booking → the right page of the filtered الحجوزات. The same defect was found and fixed on three more links the report did not mention — the العقارات partner column, the النزاعات booking link, and the property detail's partner link — plus the two dashboard queues. `e2e/navigation.spec.ts` now crawls every link on all 19 sections.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-08-06 | `?from=` is a redirect surface, so it is an allow-list and not a path                        | A URL picks a KEY from a six-entry literal map and may add a reference matching `^[A-Z]{3}-[A-Za-z0-9-]{1,48}$`; it never supplies a path, host or scheme. A screen with no rows refuses a reference outright, because `dashboard` has path `/` and appending a segment would build `//PAR-000002` — protocol-relative, and a real open redirect. 22 refusal cases are pinned, including `//evil.test`, `javascript:`, `..%2F..`, `__proto__` and `constructor`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-08-06 | A typo'd `?status=` showed «تعذّر تحميل القائمة» instead of a table                          | Found while auditing navigation, and older than the navigation work. The registries forwarded whatever the URL said to the API, whose `.strict()` enum answers 400, which the console renders as a screen with no table. A status is something a person types or keeps in a bookmark, so `oneOf()` now drops an unrecognised one to "no filter" — the same reasoning that makes `pageNumber` and `pageSize` clamp. Disputes and bookings have different vocabularies, and the disputes filter now reads its options from the same list it validates against.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-08-06 | `+963900000001` rendered as `963900000001+`                                                  | `+` is bidi-NEUTRAL, so a neutral leading a digit run on an Arabic line is pushed to the far end. The DOM was always correct, which is why only a browser could see it — a test reading `textContent` would have passed. Every phone is now inside an explicit `Ltr` run, on the booking detail and the partner detail, and the check asserts `dir="ltr"` INSIDE the paragraph rather than walking up to `<html dir="rtl">`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-08-06 | The booking detail printed `2625870.00` and `13000.00000000`                                 | Both columns reached the screen raw. `money()` groups the SYP total; a new `rate()` drops the `numeric(18,8)` padding but deliberately does NOT round — the rate is printed beside the total it produced so the pair can be multiplied out by hand months later, and `12,999.88` would not reproduce it. The money rows had the same defect plus a trailing ISO code the bidi algorithm moved to the front (`USD 201.99`); they now go through `amount()` + `Ltr` like the rest of the console.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2026-08-06 | Six English leaks on the booking detail, four of them from maps that already existed         | The payment line read «simulator · requires_action عبر visa» while `enums.paymentMethod` and `enums.paymentStatus` sat unused; the timeline read «booking payment expired» and «بواسطة system». Added `paymentProvider`, `actorType` and `timelineEvent` maps, and wired all six through `label()`. The timestamp was also reordered to «UTC 21:49:33 2026-08-05» without an `Ltr`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-08-06 | The cancellation reason was an English sentence stored in the database                       | Three cancellations the platform decides for itself wrote prose into `bookings.cancellation_reason`, so no amount of console discipline could translate them. They store a `system.*` CODE now and the reader's locale resolves it, falling back to the raw value so a reason a person TYPED is still shown as written.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-08-06 | …and every booking cancelled before that change still showed the English                     | Reported by Bashar an hour later, correctly: "no migration needed" was true of the CODE and false of the screen. The fallback that keeps a typed reason intact also kept every historical English row intact, forever, on an Arabic-only console. `post/0002_cancellation_reason_codes.sql` rewrites the three exact sentences the code used to write; it matches nothing on a second run, so it is safe in the idempotent post/ stage, and it cannot touch a typed reason unless someone typed one of the three verbatim.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-08-06 | The timeline printed `{"reason":"EC-001"}` at support agents                                 | Bashar asked what it meant, which is the finding. It was the event payload rendered with `JSON.stringify` — the reasoning being that a timeline which SUMMARISES loses the detail a dispute turns on. That argues for dropping no FIELD, not for showing braces: the payload is now label/value rows, with a `payloadKey` map for field names and a `payloadValue` map for values that are codes. `EC-001` — the SRS's abandoned-checkout case — now reads as what happened. An unknown key falls back to itself, so a new field stays visible rather than silently vanishing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-08-05 | Coming back from a row landed at the top of the page, not on the row                         | Bashar asked for the scroll, and it is now a standing rule in `.claude/CLAUDE.md`. The back link carries `#row-<reference>` — the detail screen's OWN reference, so no extra query parameter — and every row in every list carries the matching id from one `rowAnchor()`, because an id and a fragment written separately drift and the failure is silent. No JavaScript: the browser's fragment scrolling does it, `scroll-mt-24` keeps the row off the viewport edge and `:target` tints it. Two things only a browser could have caught: at 7% the tint was invisible, and `:target` does NOT re-evaluate on `next/link`'s `pushState`, so the row scrolled correctly and was left unmarked — `BackLink` is a plain `<a>` for that reason, asserted by a test so it cannot be swapped back silently.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-08-05 | The booking detail's status pill was a different colour from the table's                     | Bashar reported it. The detail screen built its own pill from a three-branch guess instead of the shared `StatusPill`: `checked_in` green where the table says sky, `completed` green where the table says faint, and anything unrecognised GOLD — which caught `pending_confirmation` and painted the purple that §14 makes an explicit rule as though a booking waiting on a partner were good news. It also drew a tinted fill the handoff does not use. Both screens now call one `bookingStatusTone`, which is shared precisely because a copied switch is what drifted. Pinned twice: a unit test on the full map, and a browser test that reads the SAME row's computed colour either side of the click.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2026-08-05 | The booking detail's stay line pointed «→», saying the stay ran backwards                    | Same defect as the الحجوزات table's dates column, one screen over: the two dates are digit runs, so an RTL line puts the check-in on the right and «→» then pointed from the check-out back at it. Corrected to «←» in the catalogue, where the arrow's side belongs — it is a fact about the reading direction, not about the component.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-08-05 | The Arabic console printed `accommodation` in the النوع column                               | The partners registry selected `partner_types.code` while the column beside it selected `cities.name_ar`; the Arabic name was in the database and simply not read. Found by measuring which cell forced `/partners` widest.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2026-08-05 | Vitest could not resolve either app's `@/…` alias                                            | The effect was not a red test but no test at all: any unit test of an app module that imports `@/` failed on module load, which is why `format.ts` had none and shipped the overflow. The alias now resolves per importing app — a single mapping would have silently resolved a future `apps/web` test against the console's module of the same name.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2026-08-04 | 12 of the 19 console sections did not exist                                                  | Built against the design handoff: bookings, customers, payments, wallet, gift cards, coupons, geography, reports and Emergency Mode from scratch; partner/property registries, staff and audit rebuilt. Backed by 12 new keyset-paginated endpoints, each behind its narrowest permission and verified live against the running database.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-08-04 | A client component was importing a server-only module                                        | `setting-row.tsx` reached the API client — session reading, access tokens — through a formatting helper in `lib/console.ts`. `next build` refused, correctly. Pure formatters moved to `lib/format.ts`, which imports nothing but strings and the locale constant. See the trap in §8.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2026-08-04 | The permission matrix filtered on a false belief                                             | It dropped "permissions no staff role holds", which can never happen: `SUPER_ADMIN` is `Object.values(PERMISSIONS)`. Dead code, found by a unit test written to confirm the filter and failing instead. Removed; the matrix now lists the full catalogue, which is also the more useful answer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2026-08-06 | The API could not boot, and `pnpm verify` was green                                          | `PayoutModule` was missing `AuditService` from its providers, so Nest refused to build the container and `node dist/main.js` exited — after format, lint, types, 888 tests and the audit had all passed. Nothing in the suite assembled the container: unit tests construct services with `new`, integration tests talk to the database directly. Closed by `apps/api/src/app.module.test.ts`, which compiles the real `AppModule` with only the two connections and the environment overridden, and was verified to fail with the exact production error when the provider is removed. It needed a second fix to be possible at all: vitest transforms with esbuild, which implements `experimentalDecorators` but not `emitDecoratorMetadata`, so every Nest constructor dependency without an explicit `@Inject()` resolved to `undefined`. `vitest.config.ts` now routes the API's own source through SWC, which emits it — the same two flags `apps/api/tsconfig.json` already sets, so the test build agrees with the production build instead of being a third one.                                                                                                                                               |
| 2026-08-06 | `db:testbed` could destroy a testbed and rebuild nothing                                     | It cleared the previous fixtures before writing the new ones, outside any transaction. A run that stopped partway — on the payout foreign key described in O-data-2 — left a console with no disputes and no message threads, and `e2e/admin-sections.spec.ts` then reported that absence as a product regression. The whole clear-and-seed is now one transaction, so a failed run leaves exactly what was there before.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-08-06 | `db:reset-dev` silently skipped tables nobody had listed                                     | `partner_payouts` and `partner_payout_items` shipped with the payout ledger and were never added to `CLEAR_TABLES`, so a "reset" database kept 66 payouts and 201 items — and the leftovers then blocked the seed from deleting the bookings they covered. A reset that quietly leaves a table populated is worse than one that fails, because the next seed builds on rows the developer believes are gone. The script now compares `information_schema` against both lists before it starts and refuses, naming the unlisted table.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-08-06 | The messages registry lost its pagination bar whenever it was empty                          | `/messages` rendered the empty notice INSTEAD of the list and the bar, unlike the ten `<table>` registries, where `AdminTable` returns the notice and the parent keeps the bar. An empty result is usually a filter that matched nothing or a page past the end, so hiding the pager there stranded the reader with no total, no size control and no way back to page one — the exact failure the "Tables and pagination" rule exists to prevent. Found by `e2e/pagination.spec.ts` once the testbed stopped leaving stale threads behind.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-08-12 | A staff reply to a support ticket reached nobody                                             | The first gap under **O-web-3**: an answer was discoverable only by returning to the page, which made الدعم somewhere people check rather than somewhere they are answered. `MessagingService.reply` now emails the asker via the `support.replied` template in their own language, with the ticket reference and a link and never the message text — bodies are stored redacted and the original is discarded, so repeating it in an inbox would put back exactly what the redaction removed. An internal note notifies nobody, which is the leak that would have mattered most and is tested for by name                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-08-12 | The public home page listed no cities, and had not for some time                             | **O-web-4.** `cities.categories` is an enum ARRAY, which node-postgres hands back as the literal string `'{historic}'` unless it is cast — while the `db.execute` generic declared `string[]`, an assertion nothing checks. The web app validates the response and falls back to an empty list, so the destinations grid and the city selector rendered empty rather than erroring, and `/ar/city/*` became unreachable from the site. Invisible until a rebuild replaced a long-running API process built from older code. `to_jsonb(c.categories)`, plus a test asserting the runtime shape                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-08-12 | Every human-readable reference broke at 999,999 rows                                         | **O-scale-1.** Twelve tables defaulted their reference to `lpad(nextval(…)::text, 6, '0')`, and `lpad` TRUNCATES past the width: the millionth row was handed the reference the hundred-thousandth already had, and ten consecutive counter values then collapsed onto one. The unique index made it a failed INSERT — an outage at exactly the volumes rule 2 targets (1M users) and a fifth of the load plan's bookings. Invisible to every test because no environment had ever held a million of anything; found by building the load-test data generator. Fixed with a `reference_number()` helper that pads without truncating, plus a test that reads every reference default out of `information_schema` and refuses `lpad`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-08-13 | Search returned HTTP 500 at the documented volumes                                           | **O-scale-2.** 144 seconds for one search over 50k properties / 200k units / 73M availability days, against a 200 ms budget and a 15 s statement timeout. Four behaviour-preserving changes: property filters moved INTO the pricing CTE so a city search stops pricing the whole country (and `properties_published_idx` becomes usable), the per-night price sum rewritten algebraically so it stops reading 365 rows to price 2 nights, a `ROW_NUMBER()` that every row discarded deleted, and two anti-joins over the same date range merged into one. City search 39.7 s → 213 ms, unfiltered 144 s → 3.9 s. Held by 25 tests written against the OLD query first; search had none before                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-08-13 | Search still took 3.9 s to browse without a destination                                      | The tail of **O-scale-2**, after the query rewrite. Three partial indexes on `availability_days` — each of search's three questions of that table looks for the exception, and the primary key could find the rows but not answer them, so every probe hit the heap — plus choosing the page's properties by rank BEFORE pricing them, which is exact for the two property-ranked sorts and disabled for the two price-ranked ones. 3.9 s → 0.59 s for the default. `price_asc` unfiltered remains at 2.75 s: its ranking key is the value being computed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-08-13 | The payment-webhook page alert could only ever be a false positive                           | **O-ops-2.** `safra_payment_events_unprocessed` counted every row with `processed_at IS NULL`, including webhooks rejected on arrival — which can never be processed and sit for the 30 days until retention prunes them. Alert 14 is severity PAGE at 15 minutes, so one malformed request armed an unclearable page; the dev database had been in that state 8.8 days with 219 events, all unsigned, meaning the alert had never had a true positive. Split into a backlog gauge (parseable, signed, awaiting) and a rejection RATE gauge, with a test asserting every unprocessed row is classified by exactly one of them                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-08-13 | Every notification was sent inside the request that caused it                                | **O-notify-2.** BullMQ phases 1–2: `notify` writes its row and enqueues, a separate worker process sends, failures retry with jittered backoff and land in a durable `dead_letter_jobs` table with the payload redacted. A boot-time guard refuses to start in production against a Redis configured as a cache, because `allkeys-lru` discards queued jobs silently. Two defects in the design document itself came out of building it: the specified job-id format `notification:<id>` is rejected by BullMQ outright, and the "re-drive from the database rows" recovery story cannot be implemented as written — a `notifications` row identifies a lost notice but deliberately holds nothing to reconstruct it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-08-13 | A support ticket could only be closed by staff                                               | The second gap under **O-web-3**. `POST /support/:reference/close` on both dashboards, clearing `unread_for_staff` as well as `closed_at` — the counter the console's inbox sorts by, so an abandoned request sat near the top ahead of people still waiting. Idempotent and final; no system message is written into the thread, because a body is stored once and the two apps read different languages                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-08-13 | The partner sign-in page looked nothing like the console's, and dropped where you were going | Rebuilt as a server page around a client form, matching the console: brand ornament, heading, subtitle, card. Two screens somebody lands on when something has gone wrong, and one that does not look like the product is indistinguishable from a phishing page. It also honoured `?next=` for the first time — middleware set it and said in its own comment that the login page re-validates it, and the form always navigated to `/`. Both consoles' document titles are now `سفرة \| …` with a pipe, never a dash (Bashar, 2026-08-13)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2026-08-13 | Nothing could raise a dispute; staff typed them from phone calls                             | The last **O-web-3** gap. `POST /disputes` and `/account/disputes` on the customer app, in three locales. Customer-only, because every `dispute_kind` is a complaint about the stay and inventing a partner-side reason is a product decision. The authorization is the design: opening one FREEZES the host's payout, so the booking is resolved by reference inside the caller's own profile in a single query, and the freeze is asserted through the function the payout run calls. 18 integration tests, of which five are the boundary, plus a browser round trip                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-08-13 | A browser fixture was eaten by the feature it tested                                         | Two e2e lessons worth keeping. A unique title suffixed with `Date.now()` was MASKED by the contact-detail redactor — thirteen consecutive digits is a phone number — so the assertion hunted a string that could not exist; anything unique going into a redacted field must be unlike a contact detail. And a spec that always raised the same reason on the same booking collided with its own previous run, since one live dispute is allowed per booking per reason; it now rotates on the count already on the page                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
