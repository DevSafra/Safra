# Super Admin console — gap report against `design_handoff_safra`

**Date:** 2026-08-04 · **status: sections 1–3 implemented, step 4 outstanding**
**Handoff:** `~/Privat/design_handoff_safra/` — `README.md` is the specification, `SAFRA.dc.html`
is the prototype source read for per-section detail (columns, copy, filters, footnotes).
**Scope of this report:** the admin panel only (handoff §8, §9, §14). The public site (§5),
the user account area (§6) and the partner dashboard (§7) are out of scope for this pass and
are listed at the end so they are not mistaken for oversights.

The handoff defines **19 admin sections**. Its §8 table lists 18 navigation rows; the 19th,
**Emergency Mode**, is a section reached from the header button rather than the sidebar
(`adminSection: 'emergency'` in the prototype state). Both are counted here.

---

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

### Verification

`pnpm verify` exit 0 — **604 tests**, format, lint, types, no vulnerabilities. `pnpm build` green.
`pnpm e2e` **56/56**. All 19 routes loaded in a real browser: no console errors, no horizontal
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

## 4. Backend work still required — the four answers

The four questions asked of this pass, answered.

### 1. Which sections are fully implemented and verified

**All 19.** Each renders real data from its own table, was loaded in a browser, and is covered by a
browser test asserting it neither fails to load nor shows a placeholder. See §0.

### 2. Which sections differ from the handoff, and why

Twelve documented deviations in §6, plus three added by this pass (13–15). Every one is a
deliberate decision with a stated reason. There are no undocumented differences.

### 3. What is still blocked, and by what

| Item                           | Blocked by                                                     | Effect                                                                                                                                                           |
| ------------------------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sending** on واتساب والبريد  | **External** — WhatsApp BSP undecided (item 192). Email works. | The log, the template inventory and the per-channel state are built. The ad template is inert until the one-message-maximum can be enforced. The screen says so. |
| **Executing** a partner payout | **External** — payment rails deferred by decision 2026-08-01   | الدفع والفواتير shows what is owed and states that transfers are not shown. `disputes/frozen-payouts` is built and ready for the payout path to consult.         |
| **النطاق (staff scope)**       | **A product decision** — see below                             | The column and the invite-form select are absent rather than faked.                                                                                              |

### 4. Backend work still required for complete parity

Two items, and only two.

| #        | Item                                               | Why it is not done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Proposed schema / plan                                                                                                                                                                                                                                                                                                         |
| -------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **B-12** | **Staff scope** (النطاق column, نطاق العمل select) | Needs a decision, not code. A scope that is DISPLAYED but not ENFORCED is the exact failure this console avoids everywhere else — an operator would read "كرم عبّود · اللاذقية · طرطوس" and believe Karam cannot see a Damascus booking. Enforcing it is a security-relevant change to who sees what, and the semantics are a product call. **The question for Bashar:** does a Latakia-scoped operations manager see a Damascus booking at all, or see it read-only? And is the audit log scoped (it should not be — a scoped audit trail is not an audit trail)? | `users.scope_kind` enum (`all_cities` \| `cities` \| `outside_syria`) plus a `staff_scope_cities` join to `cities`. Enforcement is one extra predicate on the three city-bearing registries (bookings, partners, properties); finance, settings and audit stay global by nature. Roughly a day once the semantics are decided. |
| **B-13** | **Audit entry for a CSV export**                   | The export streams from the BFF, which cannot write an audit row inside the API's transaction. An export removes data from the console's access controls and should be recorded.                                                                                                                                                                                                                                                                                                                                                                                   | Move the export behind `GET /admin/bookings/export` in the API, streaming from there and writing one `booking.exported` audit row with the filter and the row count. Half a day.                                                                                                                                               |

Everything else previously listed here (B-1…B-6) was built in this pass. The data-shape gaps that
remain are cosmetic or dev-only:

| #    | Gap                                                              | Effect                                                                                                                                                          |
| ---- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-7  | `gift_cards` and `coupons` have zero rows                        | The screens render correctly and show an empty state. Worth seeding a handful in dev to see the layout against data.                                            |
| B-8  | `properties` has one row, `cities` nine                          | Thin dev data; not a code gap.                                                                                                                                  |
| B-10 | `refunds` has no human reference (the design shows `RFD-000342`) | Refund rows are keyed by the payment they reverse. A `reference` column needs a sequence plus a backfill for 591 rows — additive and small, cosmetic in effect. |

---

## 5. Blocked by external decisions

Unchanged from the future-work register; none of these block building the screens above.

| Item                                      | Owner                           | Effect on this work                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WhatsApp BSP choice (item 192)            | Bashar                          | Cannot actually SEND from واتساب والبريد. The log and template inventory can still be built.                                                                                                                                                                                                                                                                          |
| Payment rails and payouts (items 84, 135) | Deferred by decision 2026-08-01 | الدفع والفواتير can show recorded payments, refunds, fines and scheduled transfers; it cannot execute a payout.                                                                                                                                                                                                                                                       |
| Maps billing (item 195)                   | Bashar                          | Only affects the public city/property pages, not the admin console.                                                                                                                                                                                                                                                                                                   |
| Sanctions feed registration               | Compliance                      | Already surfaced in the partner queue; unchanged.                                                                                                                                                                                                                                                                                                                     |
| Hosting (item 193)                        | Bashar                          | Unrelated to this work.                                                                                                                                                                                                                                                                                                                                               |
| Light theme (§9.2)                        | —                               | Deliberately not implemented in the console: staff-only, always dark, and the public app owns the toggle. Documented as an accepted deviation.                                                                                                                                                                                                                        |
| Shell header (§4.2)                       | —                               | The design's admin panel sits inside the public shell (logo, primary nav, currency, language, theme, account). A staff console needs none of that nav. Consequence: the sidebar sticks at 24px rather than the design's 84px offset, because there is no 64px header above it. Documented as an accepted deviation; revisit if staff want a language or theme toggle. |

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
3. **No light theme in the console** (§9.2) — see above.
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

---

## 7. Out of scope for this pass

Listed so they are not read as gaps in the admin console: the public site (§5 — home, results,
city, property, booking/payment, confirmation), the user account area (§6 — 8 sections including
the two-card wallet panel), and the partner dashboard (§7 — لوحة التحكم / عقاراتي / التقييمات).
The customer app also still uses Cairo rather than IBM Plex Sans Arabic and is missing about half
the §9.1 tokens; both are recorded in the future-work register §8a.

---

## 8. Execution order — complete

| Step | Work                                                                                      | State                                  |
| ---- | ----------------------------------------------------------------------------------------- | -------------------------------------- |
| 1    | Shared primitives: `AdminTable`, `TableToolbar`, `Kpi`, `StatusPill`, `Pager`, `FootNote` | ✅ pass 1                              |
| 2    | 11 sections backed by existing tables                                                     | ✅ pass 1                              |
| 3    | Rebuild staff · audit · settings to the design                                            | ✅ pass 1                              |
| 4    | New domains: contracts → disputes → notification log → ads → conversations                | ✅ pass 2                              |
| 5    | CSV export                                                                                | ✅ pass 2                              |
| 6    | Staff scope (B-12)                                                                        | ⏸ awaiting a product decision — see §4 |
| 7    | Export audit entry (B-13)                                                                 | 📋 half a day, no blocker              |

**No remaining implementation work can be completed within the current project scope** except B-13,
which is a small relocation of the export into the API, and B-12, which needs Bashar to answer two
questions about what scope means before any code is the right code.
