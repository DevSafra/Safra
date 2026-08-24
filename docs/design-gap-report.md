# Super Admin console — gap report against `design_handoff_safra`

**Date:** 2026-08-04 · **status: COMPLETE — all 19 sections implemented, no backend work outstanding**
**Handoff:** `~/Privat/design_handoff_safra/` — `README.md` is the specification, `SAFRA.dc.html`
is the prototype source read for per-section detail (columns, copy, filters, footnotes).
**Scope of this report:** the admin panel only (handoff §8, §9, §14). The public site (§5),
the user account area (§6) and the partner dashboard (§7) are out of scope for this pass and
are listed at the end so they are not mistaken for oversights.

The handoff defines **19 admin sections**. Its §8 table lists 18 navigation rows; the 19th,
**Emergency Mode**, is a section reached from the header button rather than the sidebar
(`adminSection: 'emergency'` in the prototype state). Both are counted here.

---

## Engineering-complete, 2026-08-08

Every gap this report was opened to track is closed. **No unblocked engineering item remains**, and
the design handoff has no section without a working screen behind it.

What is left is operational, and it is written down rather than discovered: see
`docs/launch-readiness.md` for the consolidated picture and the shortest path to launch. The two
things standing between this state and a defensible launch are **a tested restore** and **alerting
with somebody receiving it** — both of which follow the deployment decision (`M-1`).

A deliberate note on what "complete" claims: no known gap between the specification and the code,
verified by 1,094 unit and integration tests plus 191 browser tests. It does not claim _proven at
scale_ — the load test has never run, and `docs/load-testing.md` exists so that it can the day
infrastructure does.

## Testing posture, 2026-08-08

**191 browser tests and 1,088 unit/integration tests.** What each layer can and cannot see:

- The **unit/integration** suite runs against a real PostgreSQL, so every trigger, constraint and
  index is exercised. Eighteen of its twenty-two integration suites now roll back and leave nothing
  behind; four commit deliberately, because their subject — session-scoped advisory locks, concurrent
  wallet movements, webhook redelivery — cannot be expressed inside one transaction. See `O-data-2`.
- The **browser** suite is the only layer that can see a hydration failure, a CSP refusal, or a
  count formatted before it reaches a plural rule. Every one of those has actually happened here and
  every one was invisible to a green `pnpm verify`.

The rule this keeps proving: **a check that reads a status code cannot see what a person reads.**

## How each section was assessed

Three sources, in this order of authority:

1. `README.md` — tokens, typography, radii, spacing, copy, interaction rules, acceptance list.
2. `SAFRA.dc.html` — the exact table columns, filter options, button labels, footnote text and
   status vocabularies per section. The README summarises these; the prototype has them literally.
3. The running application at `localhost:3001`, read in a browser, plus the database schema
   (41 tables) and the API surface, to establish what is actually backed by data.

"Backed" below means a table with the columns the section needs actually exists — not that an
endpoint exists yet.

---

## 0. Outcome — all 19 sections implemented

**Second pass, 2026-08-04.** The first pass built 15 of 19 and listed 4 as blocked on schema. This
pass created that schema and implemented them, so **all 19 admin sections are now implemented and
verified against the running application**. Nothing renders a placeholder.

| Section                                                                                                                                                                                                  | State             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| لوحة الإدارة · الحجوزات · الشركاء · العقارات · العملاء · الموظفون · الدفع والفواتير · المحفظة · بطاقات الهدايا · الكوبونات · المدن والدول والعملات · التقارير · الإعدادات · سجل التدقيق · Emergency Mode | Built, pass 1     |
| **النزاعات · الرسائل · واتساب والبريد · الإعلانات**                                                                                                                                                      | **Built, pass 2** |
| **عقود الشراكة** (inside الشركاء §8.1)                                                                                                                                                                   | **Built, pass 2** |

### What pass 2 added

**Schema** — one forward-only additive migration (`0017`), no `DROP`, no type change:

| Table                           | Purpose                                                                                      |
| ------------------------------- | -------------------------------------------------------------------------------------------- |
| `disputes` + `dispute_evidence` | `DSP-NNNNNN`, EC-coded kinds, terminal states requiring a resolution, EC-007 customer photos |
| `conversations` + `messages`    | Three-party threads; messages append-only by trigger                                         |
| `notifications`                 | WhatsApp/email delivery log with attempts and failure reasons                                |
| `advertisers` + `ad_campaigns`  | `ADS-NNNNNN`, city-targeted, impression/click counters                                       |
| `partner_contracts`             | PDF ≤ 10MB, supersede-not-overwrite, one active per kind                                     |

Plus 6 enums, 2 reference sequences, and **13 constraints** in `migrations/post` — each one probed
against the live database to confirm it rejects the bad row rather than assumed to work.

**Permissions** — 3 new (`notification.read`, `partner_contract.read`, `partner_contract.manage`),
assigned per role. The staff permission matrix picks them up automatically because it is derived
from `ROLE_PERMISSIONS` rather than transcribed.

**API** — 13 endpoints on `CommsController`, all keyset-paginated and `.strict()` validated.

**Workflows, end to end and verified live:**

- **Close a dispute** → validates, writes the resolution, credits the customer's wallet in the same
  transaction (600.00 → 615.00 observed), writes the audit row, and **releases the payout freeze**
  (4 frozen bookings → 3). Closing twice returns 409.
- **Staff reply** → contact details stripped on the way in, staff not exempt.
- **Pause/resume a campaign** → audited; an expired campaign refuses rather than appearing to work.
- **Contract lifecycle** → upload (magic-byte PDF check) → supersede the previous → mark signed →
  `active`, with exactly one active per kind enforced by a partial unique index.
- **CSV export** → streams 2,823 rows with the on-screen filter applied, UTF-8 BOM, and CSV-formula
  injection neutralised.

### The payout freeze is derived, never stored

The handoff's rule — "فتح النزاع يجمّد استحقاق تحويل الشريك" — is a predicate over `disputes`, not a
`payout_frozen` flag on the booking. A flag has one failure mode and it is unacceptable here: the
flag and the disputes disagree, and money moves on the strength of the stale one.

### Defects this pass found

| Found                                                                                                                                                                                                                                     | How                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Contact-detail redaction leaked the local part of an email** — `ahmad@x.com` stored as `ahmad@⟨محجوب⟩`, because the URL pattern ate the domain before the email pattern saw it. The test passed: it asserted only that a mask appeared. | Probing the live endpoint. The test now asserts the original substring is **wholly absent** |
| **`bigint` reaches the driver as a string** — `impressions: "2860"` against a schema expecting a number, which failed the parse and blanked the whole ads screen                                                                          | Loading the page in a browser                                                               |
| **Replacing a contract did not supersede an unsigned one** — two pending base agreements for one partner, with nothing to say which was current                                                                                           | Testing the upload twice                                                                    |
| **`active` was unreachable** — every contract started `awaiting_partner_signature` and nothing could move it, so a whole branch of the status vocabulary was dead. Added the sign action                                                  | Testing the upload path                                                                     |
| **The dashboard said disputes were unavailable while `/disputes` showed six**                                                                                                                                                             | Cross-reading two screens; a test now asserts the two agree                                 |
| **A backtick inside a `sql\`\`` comment terminated the template** — twice, in two different files                                                                                                                                         | `tsc`                                                                                       |

### What pass 3 added (B-12, B-13)

**Staff scope, enforced server-side.** One additive migration (`0018`): two enums, two columns on
`users`, and a `staff_scope_cities` join with foreign keys. The scope travels in the access token,
narrowing revokes sessions immediately, and the predicate is applied to **every** scoped resource —
nine registries plus all eight dashboard counters, all four reports, the finance ledger and the CSV
export. Full rules in §4a; 26 unit tests in `apps/api/src/rbac/scope.test.ts`.

**Verified live, both modes, against a real scoped account** (Latakia + Tartus, with all seeded
bookings in Damascus):

|                                                                   | unscoped     | `none`                     | `read_only` |
| ----------------------------------------------------------------- | ------------ | -------------------------- | ----------- |
| bookings · partners · properties · disputes · conversations · ads | rows         | **0 rows**                 | rows        |
| dashboard counters                                                | 306 / 30 / 3 | **0 / 0 / 0**              | —           |
| write outside scope                                               | 200          | **404**                    | **403**     |
| **audit log**                                                     | 10 entries   | **10 entries — identical** | —           |

**Export audit.** The export moved into the API so it can record itself. Rules and the verified
audit payload in §4b.

### Defects pass 3 found

| Found                                                                                                                                                                                                                                                                                             | How                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| **The scope claim was never signed into the JWT.** `buildClaims` resolved it, `issue()` enumerates claims explicitly, and `scope` was not in the list — so enforcement passed every unit test and did **nothing** against a real token. The guard read `undefined` and defaulted to unrestricted. | Decoding a real token during live verification |
| **`= ANY(${array}::uuid[])` fails at runtime.** Drizzle serialises a JS array as JSON, so Postgres receives `["019f…"]` and answers `malformed array literal`. Every scoped query 500'd. Rewritten as individually-bound parameters in an `IN (…)` list.                                          | Probing the live endpoint                      |

Both were invisible to the unit suite by construction — one lives in JWT serialisation, the other in
driver serialisation. Neither could have been found without a real token and a real database.

### Verification

`pnpm verify` exit 0 — **632 tests**, format, lint, types, no vulnerabilities. `pnpm build` green.
`pnpm e2e` **58/58**. All 19 routes loaded in a real browser: no console errors, no horizontal
overflow, no untranslated UI copy, no `LOAD-FAILED`, no "not built" panel.

---

## 1. Already implemented and matching the handoff

| Section / element                                        | Notes                                                                                                                                                                                                                               |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Design tokens** (§9.1)                                 | All of dark-theme §9.1 now verbatim in `apps/admin/src/app/globals.css`, verified by reading computed styles in the browser rather than by eye.                                                                                     |
| **Typography face** (§4.1)                               | IBM Plex Sans Arabic for UI, Amiri for display headings.                                                                                                                                                                            |
| **RTL and `lang`** (§4.1)                                | `<html lang="ar" dir="rtl">`; logical properties (`ps-`/`pe-`/`ms-`/`me-`/`start-`/`end-`) throughout the console.                                                                                                                  |
| **Sidebar** (§8)                                         | All 18 rows in the handoff's order, 14px radius, 8px nav items, gold active state on `rgba(var(--goldA),.12)`, badge sky by default and red for `badgeWarn`.                                                                        |
| **Dashboard — lوحة الإدارة** (§8, prototype `adminDash`) | Header (Amiri 28px + date + role + Emergency button), 5 KPI cards on `auto-fit/minmax(160px,1fr)`, attention panel, latest-bookings table, week-revenue sparkline, pending-partner list, recent-activity panel. Rebuilt 2026-08-04. |
| **`--pend` purple for pending confirmation** (§14)       | Enforced in the booking status pill; asserted by an e2e test.                                                                                                                                                                       |
| **Staff accounts disable, never delete** (§14)           | Enforced server-side; `/staff` exposes suspend, not delete.                                                                                                                                                                         |
| **Partner verification queue** (§8.1 lower card)         | `/partners` renders the "بانتظار الموافقة — التحقق قبل النشر (P-002)" queue with screening state per row.                                                                                                                           |
| **Listing review queue**                                 | `/properties`.                                                                                                                                                                                                                      |
| **Booking detail**                                       | Reachable by reference, with money breakdown and append-only timeline.                                                                                                                                                              |

---

## 2. Implemented but visually or functionally different — RESOLVED

> **Historical.** Every row below was closed during the two implementation passes. Kept because the
> reasoning is the record of why each screen looks the way it does. Current deviations are §6; what
> remains is §4.

Each row states the deviation and what closing it requires.

| Section                                          | Deviation from the handoff                                                                                                                                                                                                                                                 | To close                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **الحجوزات (bookings)**                          | No table at all. Only a lookup-by-reference form; the handoff specifies a 7-column table (رقم الحجز · العقار · العميل · التواريخ · المبلغ · الحالة · إجراء), a status `<select>` with 7 options, a search input, a live count line, and a **تصدير CSV** button.            | New `/bookings` index + `GET /admin/bookings`. Backed by `bookings`.                                                                                                                                                                                                                                                           |
| **الشركاء (partners)**                           | Only the pending queue. The handoff's main card is an 8-column table (المعرف · الشريك · النوع · المدينة · **Score** · **التصنيف** · الحالة · إجراء) with the score-colour ladder (≥80 ok, ≥60 warn, else bad) and tier colours, plus the P-003 footnote.                   | Extend `/partners` with the table. Backed — `partners.score`, `.tier` exist.                                                                                                                                                                                                                                                   |
| **العقارات (properties)**                        | Only the pending queue. The handoff specifies a 7-column table including a **الشريك** column and a **★ rating** column.                                                                                                                                                    | Extend `/properties`. Backed by `properties` + `partners`.                                                                                                                                                                                                                                                                     |
| **الموظفون (staff)**                             | Screen is English; missing the 4 KPI cards, the **مصفوفة الصلاحيات** permission matrix (11 permissions × 5 roles with ✓ / ○ / —), the **آخر نشاط الموظفين** feed, the **النطاق** (scope) column, and the design's dashed-gold invite form.                                 | Rebuild. Matrix comes from `ROLE_PERMISSIONS` in `@safra/contracts`, which satisfies §14's "enforced server-side, not just rendered". **Scope is not backed** — see §4.                                                                                                                                                        |
| **سجل التدقيق (audit)**                          | Screen is English; missing the **غير قابل للحذف** badge, the **IP** column, and the design's 5-column layout (الوقت · الموظف · العملية · الكيان · IP).                                                                                                                     | Rebuild. Fully backed — `audit_log` has `ip_address`, `actor_role`, `subject_type`, `subject_id`.                                                                                                                                                                                                                              |
| **الإعدادات (settings)**                         | Screen is English and is a generic key/value editor. The handoff specifies the **Rules Engine** with 8 named fields, each with a unit suffix and a hint line, plus حفظ / استعادة الافتراضي buttons and the "requires finance permission, logged with IP/device/time" note. | Rebuild against the existing settings API. Backed.                                                                                                                                                                                                                                                                             |
| **Every admin table has a working search** (§14) | Only the dashboard's bookings panel has one.                                                                                                                                                                                                                               | Shared search component; applied per section.                                                                                                                                                                                                                                                                                  |
| **Table markup**                                 | The handoff draws tables as CSS grids with `display: contents` row wrappers.                                                                                                                                                                                               | **Deliberate deviation, documented:** implemented as semantic `<table>` styled to identical metrics. A grid of `div`s destroys the row/column relationships a screen reader needs, and the handoff's §3 explicitly says to use the codebase's own primitives restyled to its tokens. Visually identical; structurally correct. |

---

## 3. Completely missing — RESOLVED

> **Historical.** All fourteen items below were built: nine in pass 1, five in pass 2 (النزاعات ·
> الرسائل · واتساب والبريد · الإعلانات · عقود الشراكة).

| Section                                    | Handoff content                                                                                                                                                                                                                     | Backed?                                                                                                       |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **العملاء (customers)**                    | 7-column table (المعرف · الاسم · النوع registered/guest · حجوزات · رصيد المحفظة · آخر نشاط · إجراء), guest-vs-registered colour, footnote on guest upgrade and support not seeing payment data.                                     | **Yes** — `customer_profiles`, `wallets`, `bookings`.                                                         |
| **الدفع والفواتير (payments)**             | 4 KPI cards + 6-column table (المعرف · مرتبط بـ · الوسيلة · النوع · المبلغ · الحالة) covering payments, refunds, partner transfers and fines in one ledger view; immutability + idempotency + PCI footnote.                         | **Yes** — `payments`, `refunds`, `partner_violations`, `ledger_entries`.                                      |
| **المحفظة (wallet)**                       | 6-column table (العملية · العميل · النوع · المبلغ · السبب · التاريخ) with in/out colouring and the P-007 footnote.                                                                                                                  | **Yes** — `wallet_transactions` (10,330 rows).                                                                |
| **بطاقات الهدايا (giftcards)**             | 6-column table + **+ إنشاء بطاقة هدية** + EC-012 footnote.                                                                                                                                                                          | **Yes** — `gift_cards` (0 rows).                                                                              |
| **الكوبونات (coupons)**                    | 7-column table + **+ كوبون جديد**; five coupon types; "entirely separate from gift cards".                                                                                                                                          | **Yes** — `coupons` (0 rows).                                                                                 |
| **المدن والدول والعملات (geo)**            | Two side-by-side cards (دول الإطلاق, العملات with the accounting-currency badge and rates) + a 5-column cities table, all with add buttons; P-005 footnote.                                                                         | **Yes** — `countries`, `cities`, `currencies`, `fx_rates`.                                                    |
| **التقارير (reports)**                     | 4 report cards, each with a value, a coloured trend line, an 8-bar sparkline (last two gold) and a **تصدير CSV** button.                                                                                                            | **Yes** — derivable from `bookings`, `ledger_entries`, `partner_violations`, `partners.avg_response_minutes`. |
| **Emergency Mode**                         | Its own section: scope select (city/country), target select, 4 checkboxes (stop bookings · waive fines · broadcast · suspend the 2-hour SLA), activate/deactivate, plus a page-level active banner. Super Admin only, audit-logged. | **Yes** — `emergency_modes` (scope, scope_id, flags, messages, activated/deactivated by+at).                  |
| **النزاعات (disputes)**                    | Card list per dispute: id, EC tag, title, meta, status pill, age, **فتح النزاع** button; "opening a dispute freezes the partner payout for that booking".                                                                           | **No table.** Permissions `dispute.read` / `dispute.manage` exist.                                            |
| **الرسائل (messages)**                     | Conversation list: Amiri glyph avatar, three-party thread label, linked reference, last message, time, unread pill; contact-detail blocking rule.                                                                                   | **No table.** `message.read` / `message.send` exist.                                                          |
| **واتساب والبريد (comms)**                 | Template chip row (6 templates × 3 languages) + 5-column delivery log (القناة · القالب · مرتبط بـ · الوقت · الحالة) with sent/failed/pending.                                                                                       | **No table.**                                                                                                 |
| **الإعلانات (ads)**                        | 8-column table (المعرف · المعلن · النوع · المدينة · المدة · مشاهدات · نقرات · الحالة) + the "always labelled إعلان شريك, never mixed into organic ranking" rule.                                                                    | **No table.** `ad.read` / `ad.manage` exist.                                                                  |
| **عقود الشراكة (partner contracts, §8.1)** | Upload card (partner select · contract kind · expiry · file, PDF ≤ 10MB) + contract list rows with PDF tile, meta line, status pill and عرض / استبدال.                                                                              | **No table.** `partners.contract_signed_at` exists but holds one date, not documents.                         |

---

## 4. Final gap analysis — the four answers

Third pass, 2026-08-04. B-12 and B-13 are implemented. **No backend work remains for parity.**

### 1. Which sections are fully implemented and verified

**All 19.** Each renders real data from its own table, was loaded in a browser, and is covered by a
browser test asserting it neither fails to load nor shows a placeholder. See §0.

### 2. Which sections differ from the handoff, and why

**Nineteen documented deviations**, §6. Every one is a deliberate decision with a stated reason.
There are no undocumented differences.

### 3. What is still blocked, and by what

Two items, **both externally blocked**, neither of them console work:

| Item                           | Blocked by                                              | What exists                                                                                                                                                                                                    |
| ------------------------------ | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sending** on واتساب والبريد  | WhatsApp BSP undecided (roadmap item 192). Email works. | The delivery log, the template inventory, per-channel state and the failure/attempt record are all built. The ad template is inert until the one-message-maximum can be enforced. The screen states the block. |
| **Executing** a partner payout | Payment rails deferred by decision, 2026-08-01          | الدفع والفواتير shows what is owed and states that transfers are not shown. `GET /admin/disputes/frozen-payouts` is built and ready for the payout path to consult.                                            |

### 4. Backend work still required for complete parity

**None.**

B-12 (staff scope) and B-13 (export audit) were the last two, and both are implemented, enforced and
tested. The remaining entries below are cosmetic or dev-data only, and none of them affects parity
with the handoff:

| #    | Gap                                                              | Effect                                                                                                                                             |
| ---- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-7  | `gift_cards` and `coupons` have zero rows in dev                 | The screens render correctly and show an empty state. Worth seeding a handful to see the layout against data.                                      |
| B-8  | `properties` has one row, `cities` nine                          | Thin dev data; not a code gap.                                                                                                                     |
| B-10 | `refunds` has no human reference (the design shows `RFD-000342`) | Refund rows are keyed by the payment they reverse. A `reference` column needs a sequence plus a backfill for 591 rows — additive, small, cosmetic. |

---

## 4a. Staff scope — the enforcement rules (B-12)

Bashar's decision, 2026-08-04: scope is an **enforced server-side permission model**, not a UI
indicator. These are the exact rules, and `apps/api/src/rbac/scope.test.ts` asserts every cell.

### The modes

| Mode                       | Read inside | Read outside | Write inside | Write outside |
| -------------------------- | ----------- | ------------ | ------------ | ------------- |
| `all_cities` (default)     | ✅          | ✅           | ✅           | ✅            |
| `cities` + **`none`**      | ✅          | ❌ **404**   | ✅           | ❌ **404**    |
| `cities` + **`read_only`** | ✅          | ✅           | ✅           | ❌ **403**    |

- **Writes are refused outside scope in BOTH modes.** `read_only` widens READ only. There is no
  configuration in which a Latakia-scoped agent edits a Damascus record.
- **`none` answers 404, never 403.** A 403 confirms the row exists, which is itself information the
  member is not scoped to have. 404 is the only answer that leaks nothing.
- **`read_only` answers 403**, because the member can already see the row and pretending it is
  absent would make the console look broken rather than restricted.
- **A row with no city is always in scope.** Scope narrows by geography; it cannot narrow what has
  no geography.
- **A `cities` scope with an empty list restricts nothing.** A member switched to `cities` before any
  city is assigned would otherwise see nothing, which reads as a broken console rather than a
  half-finished configuration.

### What is scoped

`bookings` · `partners` · `properties` · `disputes` (through the booking's city) · `conversations`
(through the booking's or partner's city) · `ad_campaigns` · **the dashboard** (all eight counters,
the revenue series, recent bookings, open disputes) · **all four reports** · **the finance ledger**
(per union branch) · **the CSV export**.

### What is NOT scoped, and why

| Resource                                 | Why                                                                                                                                                                                                                           |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`audit_log`**                          | Bashar, 2026-08-04: "a scoped audit log is not a trustworthy audit log." Verified live: a scoped finance officer and an unscoped super admin see byte-identical entries. A test asserts it stays on the unscoped list.        |
| `settings`, `staff`, `geo`, `currencies` | Platform configuration. Not geographic.                                                                                                                                                                                       |
| `customers`                              | A customer belongs to no city — they book in Latakia in July and Damascus in August.                                                                                                                                          |
| `wallet`, `gift_cards`, `coupons`        | Customer- or platform-owned value instruments. Scoping a wallet by the booking a transaction happens to reference would show a partial balance history, which is worse than none because somebody would reconcile against it. |

### Mechanics

- Scope travels in the **access token**, the same trade ADR 0003 made for permissions: authorization
  stays off the hot path.
- **Narrowing revokes sessions immediately.** Any change to `kind`, any change to `outside`, and any
  city leaving the list all count as narrowing — detected conservatively, because a false positive
  costs one re-login and a false negative leaves somebody operating under a revoked scope.
- **A super admin is never scoped.** Refused by the API. Scoping the only role that can un-scope an
  account is a lockout whose remedy requires the person locked out.
- **Nobody scopes themselves.** Refused.
- `PUT /admin/staff/:userId/scope` is audited as `staff.scope_changed` with before and after.

---

## 4b. Booking export audit (B-13)

`GET /api/v1/admin/bookings/export` — the export now lives in the API rather than the web tier,
which is what lets it write its own audit row. Every export records:

| Field                | Value                                                        |
| -------------------- | ------------------------------------------------------------ |
| **who**              | `actor_user_id` and `actor_role`                             |
| **when**             | the audit row's own `created_at`                             |
| **what filters**     | `after.filters` — the search term and the status, verbatim   |
| **how many records** | `after.rowCount`, plus `matchedCount` and `truncated`        |
| (also)               | `scoped` — whether the exporter's own scope narrowed the set |

The row is written **before the bytes leave**, so a client that disconnects mid-download still
leaves a record. It is `booking.exported` in `audit_log`, which is append-only by trigger — verified
live: an `UPDATE` against it raises `append-only; UPDATE is not permitted`. It appears in سجل التدقيق
like any other entry.

Also verified live: 2,870 rows with the on-screen filter applied, a UTF-8 BOM so Excel does not
mangle Arabic, and CSV-formula injection neutralised.

---

## 5. Blocked by external decisions

Unchanged from the future-work register; none of these block building the screens above.

| Item                                      | Owner                           | Effect on this work                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| WhatsApp BSP choice (item 192)            | Bashar                          | Cannot actually SEND from واتساب والبريد. The log and template inventory can still be built.                                                                                                                                                                                                                                                                                                                       |
| Payment rails and payouts (items 84, 135) | Deferred by decision 2026-08-01 | الدفع والفواتير can show recorded payments, refunds, fines and scheduled transfers; it cannot execute a payout.                                                                                                                                                                                                                                                                                                    |
| Maps billing (item 195)                   | Bashar                          | Only affects the public city/property pages, not the admin console.                                                                                                                                                                                                                                                                                                                                                |
| Sanctions feed registration               | Compliance                      | Already surfaced in the partner queue; unchanged.                                                                                                                                                                                                                                                                                                                                                                  |
| Hosting (item 193)                        | Bashar                          | Unrelated to this work.                                                                                                                                                                                                                                                                                                                                                                                            |
| Shell header (§4.2)                       | —                               | The design's admin panel sits inside the public shell (logo, primary nav, currency, language, theme, account). A staff console needs none of that nav. Consequence: the sidebar sticks at 24px rather than the design's 84px offset, because there is no 64px header above it. Documented as an accepted deviation. The theme toggle staff DID want now lives in the console's own header rather than a shell one. |

---

## 6. Explicitly accepted deviations

Every deviation in the finished console should be one of these. Anything else is a defect.

1. **Semantic `<table>` instead of a CSS grid with `display: contents`.** Same metrics, same
   borders, same type scale; correct row/column semantics for assistive technology. §3 sanctions
   using the codebase's primitives restyled to the tokens.
2. **Server-side search, not a client substring match.** The handoff describes filtering as "a
   case-insensitive substring match across all string fields of a row", which works on a
   hard-coded array of six. These tables have thousands of rows and are paginated, so a
   client-side filter would silently search only the current page — worse than no search. The
   input and its metrics match the handoff; the filtering happens in SQL.
3. ~~**No light theme in the console** (§9.2)~~ — **RESOLVED 2026-08-04.** Bashar asked for the
   toggle. §9.2's palette is implemented verbatim, including the `*A` alpha triples, and the
   control sits in both the dashboard header and `ConsoleShell`. One deliberate difference from
   the customer app: the console does NOT follow `prefers-color-scheme`. It is designed dark and
   was dark-only, so reacting to the OS would relight the console for every staff member on a
   light-mode laptop the moment it shipped. Light is opt-in. Seven browser tests in
   `e2e/admin-theme.spec.ts`, including one that runs under a light OS preference and asserts the
   console stays dark.
4. **No shell header in the console** (§4.2) — see above.
5. **Unbuilt sections are links to a page that explains the gap**, not dimmed rows and not empty
   tables. This changed during the pass: while eleven sections had no route, `aria-disabled` was the
   honest treatment; now every route exists, and a page that says "النزاعات needs a DSP table with
   customer evidence and a payout freeze" carries the reason a dimmed row cannot. The rule that did
   not change is that an unbuilt section must never render an empty table, because "no results"
   reads as "there are none". Individual unavailable ACTIONS — + إنشاء بطاقة هدية, + إضافة مدينة,
   عقود الشراكة — are still `aria-disabled` with a tooltip.
6. **Where a figure has no data source, the UI says so** rather than showing a plausible number.
   The dashboard's disputes KPI is the live example: a dash and "ميزة النزاعات غير متوفرة بعد",
   never a zero.
7. **Western digits, not Arabic-Indic**, matching the handoff's own usage throughout (§9.4 examples,
   "عمولة الشريك 7٪", "الأربعاء 23 تموز 2026"). Arabic-Indic zero (`٠`) renders as a stray dot and
   every figure here reconciles against an external record.
8. **The permission matrix is two-state, not three.** The handoff's ○ means "بموافقة مدير". There is
   no approval tier in the model — a permission is granted or it is not — so drawing ○ would claim a
   workflow exists. The legend says so instead, and the matrix is derived from `ROLE_PERMISSIONS`,
   which is what §14's "enforced server-side, not just rendered" actually requires.
9. **Settings save per field, not with one "حفظ الإعدادات" button.** Every change writes an audited
   history row naming the value it replaced; one bulk submit would either collapse several distinct
   decisions into one audit entry or write entries for fields nobody touched.
10. **Emergency Mode adds a confirmation step** the design does not show. It halts commerce in a
    region and may broadcast to every customer with an upcoming booking there — and the broadcast
    cannot be unsent. The confirmation restates the operator's own selections rather than asking "are
    you sure?", because a generic prompt trains people to click through it. A written reason of at
    least ten characters is also required, and stored.
11. **The Emergency Mode banner is on its own section, not above all nineteen.** A console-wide
    banner costs a query for active declarations on every page load, and the state is already
    visible where it is acted on.
12. **`تصدير CSV` is implemented on الحجوزات only.** It streams with the on-screen filter applied,
    a UTF-8 BOM so Excel does not mangle Arabic, and CSV-formula injection neutralised (a property
    name beginning with `=` would otherwise execute on open). Truncation past 5,000 rows appends a
    visible marker rather than ending silently. The report cards do NOT have one: each would export a
    different shape, and the four sparklines are eight numbers each — a screenshot serves better than
    a file. Recorded as B-13 that the export should write an audit row.
13. **The permission matrix drops the design's ○ tier**, and the operations-manager contract
    permission is granted outright. The handoff marks "رفع وتعديل عقود الشراكة" as ○ — allowed with
    manager approval. There is no approval workflow in the model, so the binary decision was made
    deliberately: an operations manager who has just verified a partner is the person who files the
    signed contract, and routing that through a super admin makes the queue depend on one person.
    Every upload is audit-logged with who did it, which is the accountability ○ was reaching for.
14. **عرض on a contract row is disabled.** Serving the file needs a per-request authorization check
    and a short-lived signed URL. A button that downloaded nothing would be worse than a disabled
    one; a button that downloaded _without_ the check would be much worse than either.
15. **The Emergency Mode broadcast records the choice and sends nothing.** The WhatsApp channel is
    blocked on the provider decision, and the form says so when the box is ticked — rather than
    accepting the instruction and silently dropping it.
16. **نطاق العمل is read-only in the console.** The column is rendered and the enforcement is real,
    but setting a scope is `PUT /admin/staff/:id/scope` rather than an inline control. Narrowing a
    scope revokes the member's sessions, and a mis-click in a table would log a colleague out
    mid-shift; that belongs behind a confirmation on their own record.
17. **`خارج سوريا` is not a scope KIND.** The design lists it beside كل المدن and the individual
    cities. It is modelled as a city list containing the non-Syrian cities instead, because a third
    kind would be a second code path to keep in step with the first for a distinction the data
    already expresses.
18. **The الحجوزات stay column collapses to numeric dates, not the handoff's month names.** The
    handoff draws `25 ← 28 تموز 2026` — one month and one year for the pair. This renders
    `04 ← 08-09-2026`: the same collapsing, which is the part that matters, but keeping the
    console's numeric `DD-MM-YYYY`. Every other date in the console is numeric, and one screen in a
    different format is a worse inconsistency than a shorter one. Arabic month names are also not
    reliably narrower — `كانون الأول` is longer than `-12-` — so they would not have fixed the
    overflow this change existed to fix.
19. **Four tables declare a wider `minWidth` than the handoff's layout implies**, so they scroll
    inside their own box sooner. The floor is a measurement, not a preference: the table is
    `table-fixed`, so a cell wider than its column paints over its neighbour rather than widening
    it. الحجوزات printed `201.99 USD` over a booking's dates at 1024px. `e2e/table-overflow.spec.ts`
    holds every table to it at three widths.

---

## 8. لوحة الشريك — Partner Portal gap analysis (2026-08-06)

`apps/partner`, port 3002. Assessed against handoff §7 the same way §1–§6 assessed the console:
by opening each screen against real data, not by reading the code.

### 8.1 Which partner pages are fully implemented

| Screen            | Handoff                                                         | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in           | — (not drawn)                                                   | **Complete.** Email + password, partner role enforced server-side, own cookie (`safra_partner_session`), own CSP with a per-request nonce, `next=` path re-validated. `PasswordField` per the project rule.                                                                                                                                                                                                                                                                                           |
| Shell §7          | 220px sidebar, sticky, three items, badge pills, support footer | **Complete.** Sidebar, active state, the partner's business name, the footer, sign-out at the FOOT — and the count badges, now that both are real: `عقاراتي` is their listing count and `التقييمات ★` the trigger-maintained average over published reviews.                                                                                                                                                                                                                                          |
| عقاراتي §7.2      | header, add form, listing cards                                 | **Complete.** Cards, the add form with the shared صفات الرحلة chips and the P-002 note, a media manager on الصور (upload, reorder, set cover, alt text in ar/en/de, archive), a تعديل form that explains the refusal for a published listing rather than showing a form whose submit is refused, and a تقويم with a range editor that never offers «محجوز». The add form's three image slots remain absent by design — an image uploads against a property that already exists, and the form says so. |
| المصادقة الثنائية | — (not drawn in §7)                                             | **Complete.** Two-step sign-in, forced enrolment, setup key, recovery codes shown once, and a sign-out so the gated screen is not a dead end. Mandatory since 2026-08-07.                                                                                                                                                                                                                                                                                                                             |
| التقييمات §7.3    | reviews list, رد, إبلاغ                                         | **Complete.** Guest name, property as listed, unit, ★ score, date at the far side, body, and الرد / إبلاغ. P-006 printed above the list and TRUE underneath it — no delete control exists and the table refuses `DELETE`. Hidden reviews stay visible to the partner, marked, and out of the average.                                                                                                                                                                                                 |
| لوحة التحكم §7.1  | KPIs, calendar, activity, payout line                           | **Complete.** Four KPI cards, the pending-request queue with its two-hour SLA badge and قبول/رفض, a month calendar for one unit with the §7.1 legend and reminder, and the alerts panel carrying the payout line. Absent data renders «—», never «٠» — a partner with no units has not achieved zero occupancy. Responsive at 390/768/1024/1440.                                                                                                                                                      |
| المستحقات         | — (not drawn in §7)                                             | **Complete, read-only.** `/payouts` list and `/payouts/[reference]` with the covered bookings. A partner cannot release their own transfer and the screen says so — `PAYOUT_EXECUTE` is staff-only and the partner controller exposes no write.                                                                                                                                                                                                                                                       |

### 8.1b Enforcement, as the PARTNER meets it (2026-08-24)

Driven in a browser on 2026-08-24, and it is worth recording separately because the browser pass
found the whole partner-facing half of the suspension policy to be inert.

| Surface                     | State                                                                                                                                                                                                                                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Suspension notice           | **Complete, and was NOT.** `Shell` renders it from `profile.suspension`, and `GET /partner/me` did not select `suspended_at` or `suspended_reason` — so the object never arrived and the portal schema's `.default(null)` read that silence as "not suspended". It could not appear anywhere. |
| المحفظة «التحويلات موقوفة»  | **Complete, and was NOT** — computed from the same field, unreachable for the same reason.                                                                                                                                                                                                    |
| Refusal on a blocked write  | **Complete.** A draft edit is refused with «حساب الشراكة معلّق مؤقتاً…», not «تعذّر الحفظ», and the value is not stored.                                                                                                                                                                      |
| Sign-in while suspended     | **Complete.** A COLD sign-in — password plus the emailed code — reaches the portal and lands on the notice. This is the half that is easiest to break by accident: suspension once stripped `partnerId` from the token, so the portal rendered as though the business did not exist.          |
| Listings leaving search     | **Complete.** The partner's three Damascus listings vanish from `/ar/search` while suspended and return when it is lifted, with two other partners' listings on the page throughout as the control.                                                                                           |
| المخالفات stage and warning | **Complete, and was NOT.** `GET /partner/violations` selected neither `stage` nor `warning_note`, both defaulted in the portal schema — so every violation read «سُجّلت» whatever had happened to it, and the warning written FOR the partner reached nobody.                                 |
| المخالفات notification      | **New.** A card in the §7.1 row showing the OPEN count and the furthest rung reached, linking to المخالفات. The alerts panel is `LIMIT 5` and said nothing about a sixth violation.                                                                                                           |

**One enforcement gap remains and it is not a portal one.** Only the suspension notice and the fine
waiver actually notify the partner. A warning, a fine and a lifted suspension send nothing, while the
console tells the operator «وأُبلغ الشريك» for all three — see `O-staff-5`. The portal is ready for
them: the warning note now reaches المخالفات and the card points at it.

**The pattern all three defects share, and it is the reason to write this down:** a zod
`.default()` on a field the API never sent. Every one parsed cleanly, rendered plausibly, passed the
type checker and passed every test. `O-staff-4` recorded these surfaces as "compile-verified" in
good faith — compilation was exactly what they satisfied. All three defaults are gone; the fields
are required-but-nullable, so an API that stops sending one fails the parse where the mistake is.

`e2e/partner-suspension.spec.ts` holds the whole journey — suspend, read, be refused, sign in cold,
disappear from search, lift, recover — and lifts the suspension in an unconditional `afterAll` so
the window cannot outlive the spec.

### 8.2 Which workflows are complete

- **Sign in → see only your own listings → sign out.** Complete and browser-tested, including that
  the listings shown are the signed-in partner's _by name_, not merely three of something.
- **Partner data isolation.** Enforced server-side: `listOwn` and `profile` both derive `partnerId`
  from the VERIFIED token via `requirePartnerId`, never from a parameter. There is no endpoint that
  accepts a partner id.
- Everything else in §7 is a read that does not exist yet or a write that has no screen.

### 8.3 Backend and API gaps that remain

| Gap                                                                                                      | Blocks                                                             | Note                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~No `reviews` table, API or aggregate~~ — **shipped 2026-08-07/08**                                     | Nothing                                                            | Schema, API, partner UI, staff moderation, the customer write flow AND public display on `/property/[slug]`. `properties.rating` is a trigger-maintained aggregate over published reviews — the seed no longer declares one, so a listing with no reviews shows no score. Hidden reviews are excluded by the API's WHERE clause. See `O-partner-1`.                                                                                                                                    |
| ~~No payouts model~~ — **shipped `a84a67d`**                                                             | Nothing. The §7.1 payout line can now be rendered from a real row. | `partner_payouts` + items, the full lifecycle, ledger posting on payment, and eight database-level guarantees. What remains is that nothing READS it: no partner screen, no staff screen, no dashboard line, and accrual is invoked by hand. See `O-partner-2`.                                                                                                                                                                                                                        |
| ~~No partner payout UI~~ — **shipped 2026-08-07**                                                        | Nothing.                                                           | Console `/payouts` registry and detail with the release/hold/pay/cancel controls, the audit trail and the ledger movement; portal list and detail, read-only. Verified end to end against the running API: accrue → close → release → paid, producing a balanced ledger movement and a three-entry audit trail.                                                                                                                                                                        |
| No partner bookings/calendar endpoint                                                                    | §7.1's calendar and activity panels                                | `GET /bookings` is role-scoped and returns a partner's own, but there is no per-unit calendar read shaped for a month grid. `availability_days` exists.                                                                                                                                                                                                                                                                                                                                |
| ~~No image serving story confirmed end to end~~ — **shipped 2026-08-07, proven in a browser 2026-08-08** | Nothing                                                            | Upload, list, reorder, cover, alt text and archive, exercised against the running API with a real JPEG and then through the real UI with `setInputFiles`. EXIF including GPS is stripped by re-encoding, verified directly. A partial unique index guarantees one cover per property. The browser test found that no app's CSP named the media host — every photograph on the platform was blocked by our own policy, in production too — plus three further defects. See `O-media-1`. |
| `listOwn` returns no unit detail                                                                         | تعديل and التقويم screens                                          | The card needs only a "from" price; editing needs the units themselves.                                                                                                                                                                                                                                                                                                                                                                                                                |

### 8.4 Externally blocked

- **Nothing in the partner portal is blocked on a third party.** The payout line is blocked on an
  internal decision (see `O-partner-2`), not on an external dependency. This is unlike the
  console, whose WhatsApp and sanctions-feed items wait on accounts SAFRA does not yet hold.

### 8.5 Deviations, and why

| Deviation                                                                     | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~No 2FA gate, unlike the console~~ — **shipped 2026-08-07**                  | Partner 2FA is now MANDATORY (Bashar). `TwoFactorGuard` refuses every partner request until enrolment; the portal routes an unenrolled partner to `/enrol-2fa` and nowhere else; sign-in is two-step; staff can reset a lost authenticator behind `partner.two_factor_reset`. Verified against the running API — an unenrolled partner's token is refused 403 on every partner endpoint. See `O-partner-4`.                                                                                                                                                       |
| تعديل and التقويم render disabled with a title                                | The screens do not exist. The console makes the same call for its unbuilt sections; a control that navigates nowhere is worse than one that admits it.                                                                                                                                                                                                                                                                                                                                                                                                            |
| The card's photo falls back to «لا صورة بعد»                                  | No seeded listing has an image. A stock photograph would be a picture of somewhere the guest is not going.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Property status pills use a filled background, unlike the console's outline   | The pill sits over a photograph. The COLOUR still comes from the shared `statusTone`, so «منشور» is the same green everywhere.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ~~The sidebar has no count badges~~ — **shipped 2026-08-07**                  | Both are real now. `عقاراتي` counts listings; `التقييمات ★ 4.5` is the average over published reviews, maintained by trigger. Absent rather than «0» when there is nothing to show.                                                                                                                                                                                                                                                                                                                                                                               |
| A التقييمات review row is `card`, not §7.3's `field` — **Bashar, 2026-08-17** | He asked for white. In the light theme `card` IS `#ffffff`; `field` is `#f1f3f8` against a `#f5f6fa` page, four hundredths apart, so the row read as a grey slab rather than a card. Written as `bg-card` and NOT `bg-white`: a literal white would stay white in the dark theme — a glaring panel on `#0c0a1c` — and the toggle Bashar asked for on 2026-08-04 would be what broke. `card` is `#17142f` there, a raised surface, which is what the row is in both themes. It is also the truer token — `field` is the input surface everywhere else in this app. |

## 7. Out of scope for this pass

Listed so they are not read as gaps in the admin console: the public site (§5 — home, results,
city, property, booking/payment, confirmation), the user account area (§6 — 8 sections including
the two-card wallet panel), and the partner dashboard (§7 — لوحة التحكم / عقاراتي / التقييمات).
The customer app also still uses Cairo rather than IBM Plex Sans Arabic and is missing about half
the §9.1 tokens; both are recorded in the future-work register §8a.

---

## 8. Execution order — complete

| Step | Work                                                                                      | State     |
| ---- | ----------------------------------------------------------------------------------------- | --------- |
| 1    | Shared primitives: `AdminTable`, `TableToolbar`, `Kpi`, `StatusPill`, `Pager`, `FootNote` | ✅ pass 1 |
| 2    | 11 sections backed by existing tables                                                     | ✅ pass 1 |
| 3    | Rebuild staff · audit · settings to the design                                            | ✅ pass 1 |
| 4    | New domains: contracts → disputes → notification log → ads → conversations                | ✅ pass 2 |
| 5    | CSV export                                                                                | ✅ pass 2 |
| 6    | **Staff scope (B-12) — enforced server-side, both modes, 26 tests**                       | ✅ pass 3 |
| 7    | **Export audit (B-13) — who, when, filters, row count, immutable**                        | ✅ pass 3 |

**No remaining implementation work can be completed within the current project scope.** The two
outstanding items are externally blocked and neither is console work: WhatsApp _sending_ (roadmap
item 192) and payout _execution_ (deferred by decision, 2026-08-01). Both have their console side
built, and both screens state the block rather than implying it works.
