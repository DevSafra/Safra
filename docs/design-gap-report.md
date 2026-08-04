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

## 0. Outcome of this pass

Written as a gap report, then executed. **15 of the 19 sections are now implemented and verified
against the running application**; the remaining 4 need a schema change first and are listed in §4.

|                                   | Sections                                                                                                                                                                                                 |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Built and backed by real data** | لوحة الإدارة · الحجوزات · الشركاء · العقارات · العملاء · الموظفون · الدفع والفواتير · المحفظة · بطاقات الهدايا · الكوبونات · المدن والدول والعملات · التقارير · الإعدادات · سجل التدقيق · Emergency Mode |
| **Route exists, states the gap**  | الإعلانات · النزاعات · الرسائل · واتساب والبريد                                                                                                                                                          |

New API surface: 12 endpoints on `RegistriesController`, every one keyset-paginated, `.strict()`
validated, and guarded by the narrowest permission that fits. Verified live: all 12 return 200 with
real rows, pagination advances without repeating, unknown query parameters 400, a malformed cursor
400s rather than silently restarting at page 1, and an unauthenticated call 401s.

Verification at the end of the pass: `pnpm verify` green (566 tests), `pnpm build` green,
`pnpm e2e` green at **51 browser tests** (up from 22), and all 19 routes loaded in a real browser
with no console errors, no horizontal page overflow and no untranslated UI copy.

### Defects this pass found in existing code

| Found                                                                                                                                                                                                                                                                                                             | Where                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| A **client component importing a `server-only` module** — `setting-row.tsx` pulled the API client (session reading, access tokens) toward the browser bundle via a formatting helper. Next refused the build, which is exactly what `server-only` is for. Pure formatters now live in `lib/format.ts`.            | `apps/admin/src/lib/console.ts` |
| **Dead code asserting a false belief**: the permission matrix filtered out "permissions no staff role holds". `SUPER_ADMIN` is `Object.values(PERMISSIONS)`, so the filter could never fire. A unit test written to confirm the filter failed instead, which is how it was found.                                 | `staff-overview.service.ts`     |
| **Two redundant `as unknown as string` casts** on already-typed columns.                                                                                                                                                                                                                                          | `finance.service.ts`            |
| **`ISO code` after an amount reorders under RTL** — `3,000.00 USD` rendered as `USD 3,000.00`, reading as a label rather than a figure. Amounts now carry a symbol in the position the handoff uses.                                                                                                              | payments KPI cards              |
| **No FX rate is configured for any currency** — surfaced in red by the new geo screen. Not a bug: the seed refuses to invent one and prints ACTION REQUIRED, because a wrong rate is worse than an absent one. The screen now makes that visible to an operator rather than only to whoever read the seed output. | `fx_rates`                      |

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

## 2. Implemented but visually or functionally different

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

## 3. Completely missing

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

## 4. Blocked by backend / API functionality

These need a schema change before any screen can be honest. They are **not externally
blocked** — they are mine to build — but each is a domain, not a page, and shipping a screen
against no data would be a fabricated UI, which is the one thing this console must not do.

| #   | What is missing       | Shape needed                                                                                                                                                                                                                     | Sections it unblocks                                                                    |
| --- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| B-1 | **Disputes**          | `disputes` (reference `DSP-NNNNNN`, booking_id, kind/EC code, title, status open/reviewing/closed, opened_by, closed_by, resolution, compensation_amount) + `dispute_evidence` (EC-007 customer photos) + the payout-freeze rule | النزاعات; the dashboard's open-disputes KPI, which currently and correctly shows a dash |
| B-2 | **Conversations**     | `conversations` (booking_id or partner_id, three-party) + `messages` (sender_kind, body, redaction flags) + the contact-detail blocking rule                                                                                     | الرسائل                                                                                 |
| B-3 | **Notification log**  | `notifications` (channel whatsapp/email, template key, locale, subject ref, status sent/failed/pending, provider_ref, attempts) — the send path itself is externally blocked (WhatsApp BSP, item 192), but the LOG is not        | واتساب والبريد                                                                          |
| B-4 | **Advertisers**       | `advertisers` + `ad_campaigns` (city_id, period, impressions, clicks, status)                                                                                                                                                    | الإعلانات                                                                               |
| B-5 | **Partner contracts** | `partner_contracts` (partner_id, kind, file ref via the existing storage abstraction, uploaded_by, uploaded_at, expires_at, status)                                                                                              | عقود الشراكة inside الشركاء                                                             |
| B-6 | **Staff scope**       | `users.scope` or a `staff_scopes` join to cities/countries — the design's النطاق column and the invite form's نطاق العمل select                                                                                                  | الموظفون                                                                                |

Five further items are data-shape gaps rather than missing tables:

| #    | Gap                                                                                                 | Effect                                                                                                                                                                                                                                                                                                         |
| ---- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-7  | `gift_cards` and `coupons` have **zero rows**                                                       | The screens will render correctly and show an empty state. That is honest, but it means the layout has not been seen against real data. Worth seeding a handful in dev.                                                                                                                                        |
| B-8  | `properties` has **one row**, `cities` nine                                                         | The properties table and the geo city counts are thin in dev; not a code gap.                                                                                                                                                                                                                                  |
| B-9  | **No payouts table** — `partner_payout_accounts` records where to send money, not that any was sent | الدفع والفواتير cannot show the design's تحويل شريك (`TRF-…`) row type. Deriving one from `bookings.partner_payable_amount` would present an obligation as a transfer that occurred, so the screen shows what is OWED and states that transfers are absent. Also gated by the deferred payment-rails decision. |
| B-10 | **`refunds` has no human reference** — the design shows `RFD-000342`                                | Refund rows are keyed by the payment they reverse. Adding a `reference` column needs a sequence plus a backfill for 591 existing rows: small and additive, but out of scope for a pass that changed no schema.                                                                                                 |
| B-11 | **No `users.scope`**                                                                                | The design's النطاق column and the invite form's نطاق العمل select are absent from الموظفون rather than filled with a placeholder. Same underlying item as B-6.                                                                                                                                                |

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
12. **`تصدير CSV` is not implemented.** The design puts an export button on الحجوزات and on each
    report card. Deferred rather than faked: an export must carry the current filters (or it exports
    the wrong set and somebody reconciles against it), must stream rather than buffer 3,000 rows, and
    should be audit-logged because it removes data from the console's access controls. That is its own
    piece of work, and a button that downloaded the first page only would be worse than none.

---

## 7. Out of scope for this pass

Listed so they are not read as gaps in the admin console: the public site (§5 — home, results,
city, property, booking/payment, confirmation), the user account area (§6 — 8 sections including
the two-card wallet panel), and the partner dashboard (§7 — لوحة التحكم / عقاراتي / التقييمات).
The customer app also still uses Cairo rather than IBM Plex Sans Arabic and is missing about half
the §9.1 tokens; both are recorded in the future-work register §8a.

---

## 8. Execution order

Sequenced so each step is verifiable on its own, and so the shared primitives land before the
sections that depend on them.

| Step | Work                                                                                                                                                                            | Depends on |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1    | Shared primitives: `AdminTable`, `SearchField`, `Kpi`, `StatusPill`, `Panel`, `FootNote`, CSV export                                                                            | —          |
| 2    | Sections backed by existing tables: bookings · partners table + score/tier · properties table · customers · payments · wallet · giftcards · coupons · geo · reports · emergency | Step 1     |
| 3    | Rebuild to the design: staff (KPIs, permission matrix, activity) · audit (IP, badge) · settings (Rules Engine)                                                                  | Step 1     |
| 4    | New domains, schema first: B-5 contracts → B-1 disputes → B-3 notification log → B-4 ads → B-2 conversations → B-6 staff scope                                                  | Step 2–3   |

Steps 1–3 are 15 of the 19 sections and need no schema change. Step 4 is the remaining 4
sections plus partner contracts and the staff scope column.
