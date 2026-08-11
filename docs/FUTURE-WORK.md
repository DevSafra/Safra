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

## 1a. Launch blockers — the authoritative list

**Agreed with Bashar, 2026-08-08.** SAFRA is engineering-complete; these ten are what stand between
that and a launch. **Engineering-complete does not mean launch-ready**, and this list is the
difference.

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
| 10  | Load-testing execution and validation              | Engineering         | yes        |

Full detail, ownership and specification pointers in **`docs/launch-readiness.md` §4**. Items 3, 6,
7 and 8 need no infrastructure and can start today.

## 1b. Where the remaining work is written down

**Engineering is complete. Everything below this line is operational, and every item now has a
document that makes it executable without further discovery.**

| Document                         | What it settles                                                                                                            |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `docs/launch-readiness.md`       | The whole picture: components, risks, blockers, security, DR, monitoring, infrastructure, vendors, legal. **Start here.**  |
| `docs/alerting.md`               | 16 signals with thresholds and severities; the 4 integration points; the one endpoint still to build                       |
| `docs/load-testing.md`           | 6 scenarios, success criteria, production-shaped data volumes, k6, what to do when it fails                                |
| `docs/malware-scanning.md`       | Four options weighed; ClamAV sidecar recommended for identity documents only, with the reasoning for excluding photographs |
| `docs/media-integrity.md`        | What is closed, and the one invariant only a deployment can enforce                                                        |
| `docs/background-jobs-design.md` | BullMQ: 5 queues, retries, dead letters, scheduler migration, backup implications, 6-phase rollout, ~14 days               |
| `docs/notifications.md`          | What is sent, to whom, and how to prove it                                                                                 |
| `docs/runbook-scheduled-jobs.md` | On-call procedure for the two cron jobs                                                                                    |
| `docs/auth-rate-limiting.md`     | The throttling design and its honest residual                                                                              |

## 2. Standing decisions that constrain all future work

These are not open questions. They are settled, and changing one is a decision for
Bashar, not an implementation detail.

| Decision                                                          | Date           | Detail                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work directly on `main`; never branch                             | 2026-07-29     | No feature branches, no PR flow, never force-push                                                                                                                                                                                                                                                                                                                           |
| Commit messages are exactly one line, typed prefix                | 2026-07-29     | No body, no `Co-Authored-By`, no tool footers                                                                                                                                                                                                                                                                                                                               |
| Ask before every commit and every push                            | standing       | No batching of approval                                                                                                                                                                                                                                                                                                                                                     |
| Merchant of record: Safra Technologies GmbH (Germany)             | 2026-07-29     | ADR 0002                                                                                                                                                                                                                                                                                                                                                                    |
| Payment rails and payouts deferred to end of project              | 2026-08-01     | Items 84, 135                                                                                                                                                                                                                                                                                                                                                               |
| Money settings carry a currency, plus `money.always_usd`          | 2026-08-01     | Toggle ON by default; ADR 0006                                                                                                                                                                                                                                                                                                                                              |
| ID documents: store, restrict access, defer retention policy      | 2026-08-01     | Retention is now item **S-4** below                                                                                                                                                                                                                                                                                                                                         |
| FX management: `super_admin` only, with a toggle for finance      | 2026-08-01     | `rbac.finance_can_manage_fx`                                                                                                                                                                                                                                                                                                                                                |
| **No new product scope until must-haves M-1…M-6 have a plan**     | **2026-08-02** | Bashar, explicit                                                                                                                                                                                                                                                                                                                                                            |
| **No user-facing text is hardcoded**                              | **2026-08-04** | Every word a person reads comes from `@safra/i18n`; enforced by `safra/no-hardcoded-text` in `pnpm lint`. See `docs/i18n.md`                                                                                                                                                                                                                                                |
| **Every UI is responsive on every device**                        | **2026-08-05** | No page scrolls sideways at 390 / 768 / 1024 / 1440 px. Enforced by `e2e/responsive.spec.ts` and a zero-specificity `min-width: 0` rule in both apps' `globals.css`                                                                                                                                                                                                         |
| **The console sidebar collapses at every size**                   | **2026-08-05** | Hamburger always available, choice persisted, content reclaims the space, nav still reachable. `e2e/sidebar.spec.ts`                                                                                                                                                                                                                                                        |
| **Every table carries a numbered pagination bar**                 | **2026-08-05** | `TablePagination`: prev/next, a page-number input, the page count, a rows-per-page select, the total found — under the table. Console registries use `OFFSET` with a count capped at 10,000; everything customer-facing keeps keyset. Exception: geography's bounded reference tables, held by `geo-bounds.integration.test.ts`. `e2e/pagination.spec.ts`                   |
| The API answers with an error CODE, not a sentence                | **2026-08-04** | 154 codes in `@safra/contracts`. `message` is English for logs only and must never be displayed                                                                                                                                                                                                                                                                             |
| Staff scope is ENFORCED server-side, two modes                    | **2026-08-04** | `none` \| `read_only` outside scope; writes refused in both. See gap report §4a                                                                                                                                                                                                                                                                                             |
| **The audit log is never scoped**                                 | **2026-08-04** | Bashar: "a scoped audit log is not a trustworthy audit log"                                                                                                                                                                                                                                                                                                                 |
| **Violation fines are RECORDED, never deducted — pending a rule** | **2026-08-07** | Bashar, explicit. `partner_violations` records the fine; `partner_payouts.fine_amount` stays zero and nothing subtracts it. The subtraction already exists in the accrual (`net = gross − fine`) and is deliberately left unwired until the business rule is defined. The partner dashboard says «غرامة ١٠$ مسجَّلة», NOT the handoff's «خُصمت من المستحقات» — see D-fine-1 |
| **Auth throttling is keyed on IP + account, not IP alone**        | **2026-08-07** | Bashar, approved. One person behind carrier-grade NAT could lock out everyone sharing their egress address — a real problem for Syrian partners. Two limits now: ten a minute per (IP, account) and forty per IP on auth routes. The five-attempt account lockout is unchanged and is what bounds a distributed attack. See `account-tracker.ts`                            |
| Every booking export writes an audit row                          | **2026-08-04** | who · when · filters · row count; immutable                                                                                                                                                                                                                                                                                                                                 |

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
| **Staff scope enforced server-side** (B-12) in both modes, across 9 registries, the dashboard, all reports, the finance ledger and the export                                                                                                                                                                                                                                               | 2026-08-04    |
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

### O-notify-1 — Notifications exist for three events, and are sent in the request

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

**Owner:** engineering.

### O-partner-4 — Partner 2FA is mandatory and enforced; what remains is operational

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

**Owner:** whoever next reports a slow registry. Not blocking; recorded so the decision is visible.

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

**Summary of changes:** two deviations became launch blockers (9, 11), three became tasks or
requirements (1, 7, 10), and six stand as accepted.

## 8. Known risks and traps

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

| Date       | Item                                                                                    | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-02 | Staff 2FA enforced in the console but not the API                                       | `AuthService.login` demanded a TOTP code only if the account already had one enabled, so never enrolling was a way to opt out entirely — verified live: a `support_agent` with `totp_enabled_at IS NULL` read booking detail on a password alone. Closed by `StaffTwoFactorGuard`, with narrow exemptions for enrolment, `/auth/me` and public routes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-08-02 | Production could store ID documents on local disk                                       | `StorageModule` fell back to `LocalDiskStorage` with only a warning. Now a boot-time refusal, matching the `SMTP_URL` guard.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-08-02 | `settings_history` was mutable                                                          | Its siblings were append-only by trigger; it was not. Same trigger applied, with a regression test verified to fail when the trigger is dropped.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-08-02 | Booking timestamps rendered in the server's timezone                                    | `column::text` formats in the session timezone; correct only because the container is `Etc/UTC`. Now explicit `AT TIME ZONE 'UTC'`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-08-02 | Audit log unreadable without SQL access                                                 | `/audit` console screen plus a filtered, keyset-paginated endpoint.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-08-02 | Settings editable only by hand (P-005)                                                  | Rules Engine screen with per-schema validation, history and audit in one transaction.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-08-02 | Booking detail and timeline (§9.4)                                                      | Built. Payments section present only for `PAYMENT_READ` holders — absent, not redacted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-08-02 | Auth token table and mail delivery                                                      | Shipped earlier; tracker entry closed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-08-02 | Password reset, email verification, guest-booking claiming                              | Shipped earlier with 24 integration tests; tracker entries closed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-08-04 | The listing review queue had NEVER loaded                                               | `pendingPropertySchema` required a `status` field that `GET /admin/properties/pending` does not select, so `staffFetch` returned `'failed'` on every response and the queue showed "could not load this list" permanently. Silent — no log, no error. Fixed and covered by `apps/admin/src/lib/api.test.ts`, which asserts against a captured response and was verified to fail when `status` is reintroduced. See the trap in §8.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-08-04 | The dashboard did not resemble the approved design                                      | Rebuilt from `SAFRA - موقع سفرة 29.07.html`: 220px sidebar with all eighteen §9.3 sections, KPI row, attention panel, latest bookings, revenue sparkline, partner queue, recent activity. Backed by a new `DashboardService` that answers the whole screen in one round trip. Unbuilt sections and Emergency Mode render disabled rather than as dead links.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-08-04 | The console showed raw English identifiers in Arabic                                    | Booking statuses, staff roles and audit actions were rendered as `pending_confirmation`, `super_admin`, `auth.login_succeeded`. All three now map through `apps/admin/src/lib/strings.ts`, falling back to the raw key rather than blank.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-08-04 | Seeded partner named after a sanctioned individual                                      | `PAR-000002` renamed to `Sham Hospitality Farms` / `مزارع الشام للضيافة` by `UPDATE` — 3,148 bookings reference it, so deletion was not an option. The sanctions test fixtures keep the real designation deliberately: per ADR 0002 the residual EU Syria designations ARE those figures, and the name-folding rule exists to match them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-08-04 | The console palette was eyeballed, and wrong                                            | Every colour in `apps/admin/src/app/globals.css` had been sampled from a screenshot before the handoff arrived: `--card` was `#15132a` against the specified `#17142F`, `--field` two shades too light, `--text` a neutral grey where the design uses a warm cream, and `--ok` / `--bad` / `--warn` / `--sky` were Tailwind defaults rather than SAFRA's. Individually invisible; together a different product. Replaced verbatim from handoff §9.1 and verified by reading computed styles in the browser rather than by looking at it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2026-08-04 | The console used the wrong UI font                                                      | Cairo, chosen as a guess before the handoff. §4.1 specifies IBM Plex Sans Arabic, which every spacing value in the handoff was measured against. Swapped for the console; the customer app has NOT been — see §8a.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-08-04 | `text-good` / `bg-good` matched no token anywhere                                       | The colour token is `ok` in both the handoff and the customer app, but twelve console files and two customer files used `good`. Tailwind generates nothing for an undefined token, so those elements silently kept their inherited colour — including two success banners in the customer app. Renamed throughout.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-08-04 | `pending_confirmation` was rendered in gold                                             | The handoff makes it an explicit rule: pending confirmation is purple (`--pend`), never gold. Gold is SAFRA's affirmative accent, and a paid booking still waiting on a partner is not good news.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2026-08-04 | The last 4 console sections had no tables                                               | `disputes` + `dispute_evidence`, `conversations` + `messages`, `notifications`, `advertisers` + `ad_campaigns` and `partner_contracts` created in one forward-only additive migration, with 6 enums, 2 sequences, 13 constraints and 3 permissions. Every constraint was probed against the live database to confirm it rejects the bad row. All 19 sections now render real data.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-08-04 | Contact-detail redaction leaked the local part of an email                              | `ahmad@x.com` stored as `ahmad@⟨محجوب⟩`: the URL pattern matched the bare domain before the email pattern saw it. The test passed because it asserted only that a mask appeared and the count rose. Reordered email-before-URL; the test now asserts the original substring is wholly absent. Found by probing the live endpoint.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2026-08-04 | The ads screen could never load                                                         | `impressions` is `bigint`, which the driver returns as a string, against a `z.number()` schema. Same silent-parse-failure shape as the listing queue in the morning. Cast to text and coerced with `Number()`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-08-04 | A partner contract could never become active                                            | Every upload starts `awaiting_partner_signature` and nothing could move it, so `active` was unreachable and a whole branch of the status vocabulary was dead. Added the mark-signed action; replacing now supersedes an unsigned contract too, which it previously did not.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-08-04 | The dashboard and the disputes section disagreed                                        | The dashboard KPI still said "the disputes feature does not exist" while `/disputes` showed six. Wired to the real count; a browser test now asserts the two screens agree, because two screens disagreeing is worse than either being wrong alone.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-08-04 | Staff scope existed only as a design column (B-12)                                      | Implemented as an enforced server-side model on Bashar's decision: two modes (`none` / `read_only` outside scope), writes refused outside scope in both, 404 rather than 403 under `none` so absence leaks nothing, and the audit log explicitly exempt and verified byte-identical for a scoped member. Applied to 9 registries, all 8 dashboard counters, all 4 reports, the finance ledger and the export. 26 unit tests plus live two-mode verification. Rules in the gap report §4a.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-08-04 | Scope enforcement was silently inert (found during B-12)                                | `issue()` enumerates the claims it signs and `scope` was missing, so a real token carried none and every guard defaulted to unrestricted — while 26 unit tests passed. Found by decoding a live token. See the trap in §8.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-08-04 | Every scoped query returned 500 (found during B-12)                                     | `= ANY(${array}::uuid[])` — Drizzle sends a JS array as JSON and Postgres rejects it as a malformed array literal. Rewritten as individually-bound parameters. Invisible to unit tests by construction.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-08-04 | Booking exports left no trace (B-13)                                                    | The export generated CSV in the web tier, which cannot write inside the API's transaction. Moved to `GET /admin/bookings/export`, which records `booking.exported` with the actor, the filters, the row count and whether scope narrowed the set — before the bytes leave, so an abandoned download still leaves a record. Immutable by the append-only trigger; verified by attempting an UPDATE.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-08-04 | Arabic and German customers were shown ENGLISH API errors                               | `auth-form.tsx` and `checkout-form.tsx` wrote the API's `message` straight into the field error under the input, so the screens where wording matters most ignored the locale. The API now answers with a stable `code` the client resolves against the reader's locale. Three browser tests assert the Arabic and German wording renders and that the English does not leak into either.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-08-04 | Eleven staff-console screens were written entirely in English                           | The booking, property and partner detail pages plus eight components had no catalogue import at all — invisible to a scan for Arabic literals precisely because they contained no Arabic. Found by the `no-hardcoded-text` lint rule, which is why it exists. ~118 strings translated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-08-04 | The password show/hide toggle was English on four of five fields                        | `PasswordField` defaulted its labels; they are now required. See the trap in §8.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-08-04 | The customer app had no `amenities` catalogue at all                                    | `getTranslations('amenities')` named a namespace that does not exist — the catalogue calls the city-attribute list `attributes` — so all twelve amenity codes rendered raw (`air_conditioning`) in all three languages. Found by the next-intl `Messages` type augmentation, which had never been wired up.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-08-04 | Upstream field errors never reached a customer's inputs                                 | `callAuth` returns a field→code map and the route forwarded it unchanged, but the form checks `Array.isArray(errors)`. Every API-side field error was silently dropped and the form fell back to a status-based message.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2026-08-04 | The staff console had no light theme                                                    | Recorded in the gap report as an accepted deviation; Bashar asked for the toggle. §9.2 implemented verbatim including the `*A` alpha triples — overriding only the `--color-*` set would have left every gold tint reading as the dark theme's over a white card. Seven browser tests, one of which runs under a light OS preference to prove the console stays dark until somebody presses the button.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-08-05 | The console was not responsive, and the title row had drifted                           | Bashar reported the date/role line sitting too far from the title on الشركاء and العقارات: the shell put it after the whole title block, which is as wide as its widest child, so a long subtitle pushed it across the header. The dashboard and the shell had each written their own header — they now share `ConsoleHeader`, so it cannot drift again. Measuring for the new responsive rule then found 7 of 19 sections scrolling sideways at 390px, caused by grid items defaulting to `min-width: auto`; one zero-specificity CSS rule per app fixed the whole class.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-08-05 | The console assumed the sidebar was always visible, and controls were too small to tap  | Audited first (see O-resp-2): 39 routes × 7 breakpoints found 13 distinct controls between 17px and 39px and the customer nav hidden below `sm`. The sidebar now collapses at any width with the choice persisted; the touch floor is CSS below `lg` rather than a convention. Re-audited to 0 findings. 25 new browser tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-08-05 | `/admin/staff` returned every row, and no table let the operator choose a page size     | The staff endpoint is now paginated like every other registry; `staff` is kept as an alias for `items` so existing readers keep working. All 14 paged registries gained a size control that survives search and paging and is clamped server-side. Geography's three reference tables are the documented exception, guarded by a bound test rather than a comment. (The keyset cursor this shipped with was replaced by numbered pages the same day — see the row below.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-08-05 | The console's tables offered only a forward-only "next page" — no page number, no total | Bashar asked for the bar in his screenshot: `صفحة › [١] ‹ من ١٠٢ · اعرض [٢٥] صفًا · ٢٥٣١ نتيجة`, under the table. A cursor cannot address page 40, so all 15 console list methods moved to `OFFSET` + a count, 4 controllers and 14 pages moved from `cursor` to `page`, and `TablePagination` replaced `Pager` and the standalone size form. The count is capped at `COUNT_CAP` (10,000) over a LIMIT-ed subquery so it stays bounded work; past it the bar prints "أكثر من". Totals verified against SQL on the live database — bookings 4,298, partners 3,959, customers 6,868, payments 6,238 (a three-way UNION), audit 13,327 → capped. 21 browser tests, 15 unit tests.                                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-08-05 | The الحجوزات stay column printed over المبلغ, and the arrow pointed the wrong way       | Bashar reported the overlap. Three causes: the cell rendered two FULL dates (159px in a 133px `table-fixed` column, which spills rather than widening), `Ltr` forced the run left-to-right so «←» led away from the check-out, and the table's `minWidth` floor was below what its own content needed. Now `dateRange()` collapses the shared month and year (`04 ← 08-09-2026`), the cell is left to the RTL context, and four tables' floors were re-derived by measurement. A sweep of all 15 sections at three widths found the same defect class in `/partners`, `/properties` and `/comms` — all fixed, and `e2e/table-overflow.spec.ts` now holds every table to it.                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-08-05 | «القوائم» was unstyled text, linked to the dashboard, and lost the reader's place       | Bashar reported both. The control is now «رجوع» with the arrow on its right, styled like the console's other secondary controls, and returns to the exact page, size and filter: each registry row carries its list position into the detail link, and the detail screen rebuilds the list URL from a LITERAL base path — never from the URL, so a crafted link cannot redirect off the console. Unified across all four detail screens, which each had their own copy. Reached without a list (bookmark, dashboard, reference lookup) it falls back to the plain registry. `e2e/detail-return.spec.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-08-05 | The back control's arrow drifted to the left edge, and naming the section overshot      | Two corrections to the above, same day. «→» is bidi-NEUTRAL, so `'← {section}'` as a single string let the bidi algorithm choose the side and it chose the left; the arrow is now its own flex item, placed by `flex-direction: row` under `dir="rtl"`, which puts the first item on the right unconditionally — only the GLYPH is now a translation decision. And the visible label became the action, «رجوع», because naming the destination repeated the section the reader had just clicked out of; the destination survives as the `aria-label`, so four identical-looking controls are still distinguishable to a screen reader. Asserted on painted geometry, not DOM order.                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-08-05 | The booking detail printed `confirmed`, `Unit`, `damascus` and `Booked as a guest`      | Bashar's screenshot. Only the last was copy written into a component; the other three were the API selecting the wrong COLUMN — `u.name_en`, `ci.slug`, and a `name_en ?? name_ar` that made the same booking read Arabic in the الحجوزات registry and English on its own detail screen. All three now coalesce Arabic first, like every other admin service. The status pill goes through `bookingStatus()`, the same lookup the registry's pill uses, so the two cannot disagree. Regression test asserts the pill against the catalogue and the city line against the slug shape.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-08-06 | لوحة الشريك did not exist — partners could only be driven by curl                       | A fourth app, `apps/partner` on 3002, for the reason ADR 0001 gives for the console being the third: a partner sees their own listings, guests and money and nothing of the other two surfaces. Own cookie, own CSP, own catalogue. Sign-in, the §7 shell, عقاراتي and an honest empty التقييمات. No 2FA gate, deliberately: the API asks partners for no second factor, so a gate would lock every partner out of an app they cannot enter.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-08-06 | The partner card showed a name and nothing else; the sidebar showed an email            | `listOwn` now returns cover image, trip traits, "from" price, unit count, city, type, rating and badges in ONE query with two lateral joins — per-listing fetches would be the N+1 rule 2 forbids. The price is the CHEAPEST unit: a property with a $45 single and a $140 suite has no single nightly price and an average matches nothing bookable. Traits come from `TRIP_ATTRIBUTES`, the shared vocabulary the checklist says not to fork. The name comes from a new `GET /partner/me` rather than a JWT claim — tokens are cached 15 minutes and are sent on every request — and it takes no id, so ownership cannot be forgotten.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2026-08-06 | The partner image proxy pointed at an endpoint that does not exist                      | Found by the gap analysis, not by a test: no listing has a photo yet, so the route never fired. It was wrong twice — there is no GET to serve an image, and a listing photo is PUBLIC content already on safra.com, which is the line `StorageService` draws between `publicUrl` and an authenticated read. Replaced with the customer site's established `imageUrl` pattern, picking from `variantWidths` because the pipeline never upscales.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-08-06 | The database held 12,297 users and nothing anybody could test against                   | Bashar asked for the test data cleared and three شريك accounts added. `db:reset-dev` (guarded, transactional, refuses without `--yes` and outside localhost) removed 12,296 accounts and cleared 27 tables, keeping `ops@safra.test`, reference data and the append-only triggers. `db:testbed` then built three approved partners with six published properties, 88 bookings in every status, 28 payments, 16 guests, 12 staff, a dispute and a three-party thread. Both are idempotent. Amounts are computed the way `PricingService` computes them so the console's figures reconcile by hand.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2026-08-06 | Property title links on the customer search page were 21px tall                         | Under the 40px touch floor the responsive rule requires, and `responsive.spec.ts` had been GREEN — because the search page had no results to render. The clean testbed gave it six published properties and the violation appeared immediately. An anchor is inline, so the global floor in `globals.css` cannot reach it; it needs `inline-flex min-h-10 … lg:min-h-0`, and it is not exempt as an "inline" link because it is the card's main action.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-08-06 | Three fixture bugs the database refused, correctly                                      | Writing the testbed hit three guarantees in a row: the `EXCLUDE USING gist` double-booking constraint (the generator reused units with overlapping dates), `conversations_exactly_one_subject` (a thread attached to both a booking and a partner would appear in two inboxes), and the append-only trigger on `messages` — a SEVENTH immutable table the reset script's own check had missed. Each was the schema doing its job; the fixture was wrong every time.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-08-06 | Tables opened at 25 rows and forgot a change the moment you left                        | Bashar asked for ten everywhere, remembered against the ACCOUNT. Stored per table in a new `users.table_page_sizes` jsonb column, because ten bookings is a queue you scan and a hundred audit rows is a log you search. The section is an allow-list of fourteen literals — it becomes a KEY in a column read on every authenticated request — and the endpoint takes no user id at all, so ownership is not a check that can be forgotten. The bar became a POST that redirects: it was a GET form, and a GET that writes would let a prefetch or a pasted link change somebody's saved preference.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-08-06 | Saving a preference made the e2e suite stateful, and it failed a LATER run              | Found by the change itself. `pagination.spec.ts` submits the size bar, which now writes to the shared staff account, so `navigation.spec.ts`'s "every table starts at ten rows" failed on the next run — a failure with no relationship to the code that caused it. The submitting spec now restores what it changed and the asserting one resets first, and the rule is written down: any spec that submits the bar puts the size back.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2026-08-06 | One status was three different colours depending on the screen                          | Bashar's instruction. Eleven tone functions and four hand-rolled pills across two apps: `expired` was red in الدفع, grey in الإعلانات, amber in بطاقات الهدايا; `approved` was sky for a property and green for a partner; a cancelled booking was red to staff and grey to the customer. One `statusTone()` in `@safra/ui` now keys every vocabulary by the status VALUE, and one `StatusPill` draws them. Three conflicts had to be settled — `expired`→warn, `approved`→ok, `completed`→ok — each recorded with its reasoning. A browser sweep over all 19 sections fails if one status text is painted two colours.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-08-06 | Six statuses reached an Arabic screen as raw English enums                              | Found by the same sweep. The partner detail printed «approved», the property detail «pending review», document review named all five document kinds in English, and the partner type read «accommodation» while `partner_types.name_ar` sat unread — the same column-selection defect the الشركاء registry had fixed. All now go through the catalogue, and the sweep fails on any pill whose text is lower_snake_case Latin.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2026-08-06 | `statusTone('constructor')` returned the Object constructor                             | Caught by its own new test. A plain object literal inherits `Object.prototype`, so a bare `MAP[status]` lookup returned a FUNCTION for `constructor`, `toString` and `hasOwnProperty` — a non-Tone escaping a return type that promised one, then indexing the class map to `undefined`. `Object.hasOwn` now guards it, the same guard `resolveOrigin` uses. The input is a database enum string with no compiler between it and the lookup, which is why it is tested.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-08-06 | Opening the الشريك or العقار card from a booking lost the booking                       | Bashar reported it. A detail screen only knew its own registry, so «رجوع» from the partner went to الشركاء — a list the reader had never been in. Cross-links now carry `?from=`, and the trip COMPOSES: partner → the booking → the right page of the filtered الحجوزات. The same defect was found and fixed on three more links the report did not mention — the العقارات partner column, the النزاعات booking link, and the property detail's partner link — plus the two dashboard queues. `e2e/navigation.spec.ts` now crawls every link on all 19 sections.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2026-08-06 | `?from=` is a redirect surface, so it is an allow-list and not a path                   | A URL picks a KEY from a six-entry literal map and may add a reference matching `^[A-Z]{3}-[A-Za-z0-9-]{1,48}$`; it never supplies a path, host or scheme. A screen with no rows refuses a reference outright, because `dashboard` has path `/` and appending a segment would build `//PAR-000002` — protocol-relative, and a real open redirect. 22 refusal cases are pinned, including `//evil.test`, `javascript:`, `..%2F..`, `__proto__` and `constructor`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-08-06 | A typo'd `?status=` showed «تعذّر تحميل القائمة» instead of a table                     | Found while auditing navigation, and older than the navigation work. The registries forwarded whatever the URL said to the API, whose `.strict()` enum answers 400, which the console renders as a screen with no table. A status is something a person types or keeps in a bookmark, so `oneOf()` now drops an unrecognised one to "no filter" — the same reasoning that makes `pageNumber` and `pageSize` clamp. Disputes and bookings have different vocabularies, and the disputes filter now reads its options from the same list it validates against.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-08-06 | `+963900000001` rendered as `963900000001+`                                             | `+` is bidi-NEUTRAL, so a neutral leading a digit run on an Arabic line is pushed to the far end. The DOM was always correct, which is why only a browser could see it — a test reading `textContent` would have passed. Every phone is now inside an explicit `Ltr` run, on the booking detail and the partner detail, and the check asserts `dir="ltr"` INSIDE the paragraph rather than walking up to `<html dir="rtl">`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-08-06 | The booking detail printed `2625870.00` and `13000.00000000`                            | Both columns reached the screen raw. `money()` groups the SYP total; a new `rate()` drops the `numeric(18,8)` padding but deliberately does NOT round — the rate is printed beside the total it produced so the pair can be multiplied out by hand months later, and `12,999.88` would not reproduce it. The money rows had the same defect plus a trailing ISO code the bidi algorithm moved to the front (`USD 201.99`); they now go through `amount()` + `Ltr` like the rest of the console.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-08-06 | Six English leaks on the booking detail, four of them from maps that already existed    | The payment line read «simulator · requires_action عبر visa» while `enums.paymentMethod` and `enums.paymentStatus` sat unused; the timeline read «booking payment expired» and «بواسطة system». Added `paymentProvider`, `actorType` and `timelineEvent` maps, and wired all six through `label()`. The timestamp was also reordered to «UTC 21:49:33 2026-08-05» without an `Ltr`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-08-06 | The cancellation reason was an English sentence stored in the database                  | Three cancellations the platform decides for itself wrote prose into `bookings.cancellation_reason`, so no amount of console discipline could translate them. They store a `system.*` CODE now and the reader's locale resolves it, falling back to the raw value so a reason a person TYPED is still shown as written.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-08-06 | …and every booking cancelled before that change still showed the English                | Reported by Bashar an hour later, correctly: "no migration needed" was true of the CODE and false of the screen. The fallback that keeps a typed reason intact also kept every historical English row intact, forever, on an Arabic-only console. `post/0002_cancellation_reason_codes.sql` rewrites the three exact sentences the code used to write; it matches nothing on a second run, so it is safe in the idempotent post/ stage, and it cannot touch a typed reason unless someone typed one of the three verbatim.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-08-06 | The timeline printed `{"reason":"EC-001"}` at support agents                            | Bashar asked what it meant, which is the finding. It was the event payload rendered with `JSON.stringify` — the reasoning being that a timeline which SUMMARISES loses the detail a dispute turns on. That argues for dropping no FIELD, not for showing braces: the payload is now label/value rows, with a `payloadKey` map for field names and a `payloadValue` map for values that are codes. `EC-001` — the SRS's abandoned-checkout case — now reads as what happened. An unknown key falls back to itself, so a new field stays visible rather than silently vanishing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-08-05 | Coming back from a row landed at the top of the page, not on the row                    | Bashar asked for the scroll, and it is now a standing rule in `.claude/CLAUDE.md`. The back link carries `#row-<reference>` — the detail screen's OWN reference, so no extra query parameter — and every row in every list carries the matching id from one `rowAnchor()`, because an id and a fragment written separately drift and the failure is silent. No JavaScript: the browser's fragment scrolling does it, `scroll-mt-24` keeps the row off the viewport edge and `:target` tints it. Two things only a browser could have caught: at 7% the tint was invisible, and `:target` does NOT re-evaluate on `next/link`'s `pushState`, so the row scrolled correctly and was left unmarked — `BackLink` is a plain `<a>` for that reason, asserted by a test so it cannot be swapped back silently.                                                                                                                                                                                                                                                                   |
| 2026-08-05 | The booking detail's status pill was a different colour from the table's                | Bashar reported it. The detail screen built its own pill from a three-branch guess instead of the shared `StatusPill`: `checked_in` green where the table says sky, `completed` green where the table says faint, and anything unrecognised GOLD — which caught `pending_confirmation` and painted the purple that §14 makes an explicit rule as though a booking waiting on a partner were good news. It also drew a tinted fill the handoff does not use. Both screens now call one `bookingStatusTone`, which is shared precisely because a copied switch is what drifted. Pinned twice: a unit test on the full map, and a browser test that reads the SAME row's computed colour either side of the click.                                                                                                                                                                                                                                                                                                                                                            |
| 2026-08-05 | The booking detail's stay line pointed «→», saying the stay ran backwards               | Same defect as the الحجوزات table's dates column, one screen over: the two dates are digit runs, so an RTL line puts the check-in on the right and «→» then pointed from the check-out back at it. Corrected to «←» in the catalogue, where the arrow's side belongs — it is a fact about the reading direction, not about the component.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-08-05 | The Arabic console printed `accommodation` in the النوع column                          | The partners registry selected `partner_types.code` while the column beside it selected `cities.name_ar`; the Arabic name was in the database and simply not read. Found by measuring which cell forced `/partners` widest.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-08-05 | Vitest could not resolve either app's `@/…` alias                                       | The effect was not a red test but no test at all: any unit test of an app module that imports `@/` failed on module load, which is why `format.ts` had none and shipped the overflow. The alias now resolves per importing app — a single mapping would have silently resolved a future `apps/web` test against the console's module of the same name.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-08-04 | 12 of the 19 console sections did not exist                                             | Built against the design handoff: bookings, customers, payments, wallet, gift cards, coupons, geography, reports and Emergency Mode from scratch; partner/property registries, staff and audit rebuilt. Backed by 12 new keyset-paginated endpoints, each behind its narrowest permission and verified live against the running database.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-08-04 | A client component was importing a server-only module                                   | `setting-row.tsx` reached the API client — session reading, access tokens — through a formatting helper in `lib/console.ts`. `next build` refused, correctly. Pure formatters moved to `lib/format.ts`, which imports nothing but strings and the locale constant. See the trap in §8.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-08-04 | The permission matrix filtered on a false belief                                        | It dropped "permissions no staff role holds", which can never happen: `SUPER_ADMIN` is `Object.values(PERMISSIONS)`. Dead code, found by a unit test written to confirm the filter and failing instead. Removed; the matrix now lists the full catalogue, which is also the more useful answer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-08-06 | The API could not boot, and `pnpm verify` was green                                     | `PayoutModule` was missing `AuditService` from its providers, so Nest refused to build the container and `node dist/main.js` exited — after format, lint, types, 888 tests and the audit had all passed. Nothing in the suite assembled the container: unit tests construct services with `new`, integration tests talk to the database directly. Closed by `apps/api/src/app.module.test.ts`, which compiles the real `AppModule` with only the two connections and the environment overridden, and was verified to fail with the exact production error when the provider is removed. It needed a second fix to be possible at all: vitest transforms with esbuild, which implements `experimentalDecorators` but not `emitDecoratorMetadata`, so every Nest constructor dependency without an explicit `@Inject()` resolved to `undefined`. `vitest.config.ts` now routes the API's own source through SWC, which emits it — the same two flags `apps/api/tsconfig.json` already sets, so the test build agrees with the production build instead of being a third one. |
| 2026-08-06 | `db:testbed` could destroy a testbed and rebuild nothing                                | It cleared the previous fixtures before writing the new ones, outside any transaction. A run that stopped partway — on the payout foreign key described in O-data-2 — left a console with no disputes and no message threads, and `e2e/admin-sections.spec.ts` then reported that absence as a product regression. The whole clear-and-seed is now one transaction, so a failed run leaves exactly what was there before.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-08-06 | `db:reset-dev` silently skipped tables nobody had listed                                | `partner_payouts` and `partner_payout_items` shipped with the payout ledger and were never added to `CLEAR_TABLES`, so a "reset" database kept 66 payouts and 201 items — and the leftovers then blocked the seed from deleting the bookings they covered. A reset that quietly leaves a table populated is worse than one that fails, because the next seed builds on rows the developer believes are gone. The script now compares `information_schema` against both lists before it starts and refuses, naming the unlisted table.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-08-06 | The messages registry lost its pagination bar whenever it was empty                     | `/messages` rendered the empty notice INSTEAD of the list and the bar, unlike the ten `<table>` registries, where `AdminTable` returns the notice and the parent keeps the bar. An empty result is usually a filter that matched nothing or a page past the end, so hiding the pager there stranded the reader with no total, no size control and no way back to page one — the exact failure the "Tables and pagination" rule exists to prevent. Found by `e2e/pagination.spec.ts` once the testbed stopped leaving stale threads behind.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
