# SAFRA — Implementation Roadmap

Every implementation step from zero, derived from `SAFRA_SRS_Company_File_Detailed_v1.0`.

- ✅ = done and verified
- ❌ = not done (or only partially done — the note says what exists)

Status as of **2026-07-30**. Lint clean, 99 tests passing, production dependencies clean.

**Scale of what remains:** roughly 25% of the MVP is built. The API foundation, catalogue
and search are done; booking, money, both dashboards and all communications are not.

---

## Phase 0 — Foundation

### 0.1 Repository and tooling

1. ✅ Monorepo scaffold — pnpm workspaces + Turborepo
2. ✅ Strict TypeScript base config (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
3. ✅ Prettier config and `format` / `format:check` scripts
4. ✅ `.gitignore` covering secrets, `dist`, `node_modules`, `.claude/`
5. ✅ `.env.example` with every required variable, placeholders only
6. ✅ Workspace packages emit `dist`, so compiled output runs under plain `node`
7. ✅ Build info parked inside `dist` so `rm -rf dist` truly resets an incremental build
8. ✅ ESLint flat config, type-aware — floating promises, unsafe `any`, `restrict-plus-operands`
   for money strings, no `ts-ignore`. Found 3 real defects on first run.
9. ✅ CI pipeline — build → lint → typecheck → migrate → seed → idempotency re-run → tests
   against a real PostgreSQL service, plus a production-only audit gate, a full-tree audit,
   and gitleaks. **Build must precede lint**: type-aware ESLint resolves workspace types
   through `dist`, and every run before 2026-07-30 failed at Lint for exactly that reason,
   masking every later step
10. ❌ Pre-commit hook (lint + format + typecheck before commit)

### 0.2 Database schema (28 tables)

11. ✅ Identity — `users`, `refresh_tokens`, `customer_profiles`
12. ✅ Geography — `countries`, `cities` (with IANA timezone), `currencies`, `fx_rates`
13. ✅ Partners — `partners`, `partner_types`, `partner_documents`, `partner_payout_accounts`,
    `partner_violations`
14. ✅ Inventory — `properties`, `property_types`, `property_images`, `units`, `unit_amenities`,
    `amenities`, `availability_days`, `cancellation_policies`
15. ✅ Bookings — `bookings`, `timeline_events`
16. ✅ Money — `payments`, `refunds`, `ledger_entries`, `idempotency_keys`
17. ✅ Wallet — `wallets`, `wallet_transactions`, `gift_cards`, `gift_card_transactions`,
    `coupons`, `coupon_redemptions`
18. ✅ Platform — `audit_log`, `settings`, `settings_history`, `emergency_modes`
19. ❌ Communications — `disputes`, `message_threads`, `messages`, `notifications` (Phase 5)
20. ❌ Advertising — `advertisements`, `ad_impressions` (Phase 6)
21. ❌ Reviews — `reviews` table. `properties.rating` exists but nothing writes it.
22. ❌ Mobility — Van / car rental tables (post-MVP; `partner_types` already allows the type)

### 0.3 Database guarantees (enforced in SQL, not application code)

23. ✅ **EC-005 double-booking is impossible** — `gist` EXCLUDE constraint on
    `(unit_id, daterange(check_in, check_out, '[)'))`
24. ✅ Soft delete columns on every important table (P-003)
25. ✅ Append-only triggers on `ledger_entries`, `audit_log`, `wallet_transactions`,
    `gift_card_transactions`, `timeline_events` — UPDATE and DELETE raise
26. ✅ Double-entry ledger balance enforced by a deferred constraint trigger
27. ✅ Money CHECK constraints — no negative wallet, no gift-card overspend, coupon percent bounded
28. ✅ 50% refund floor constraint on cancellation policies (§7.4)
29. ✅ Reference sequences — `CUS-`, `PAR-`, `PRO-`, `BKG-YYYY-`, `PAY-`, `GIF-` (§13.2)
30. ✅ `uuidv7()` SQL function as the database-level PK default
31. ✅ `updated_at` maintained by trigger on 24 tables
32. ✅ Trigram + partial indexes for search
33. ✅ Three-stage idempotent migration runner (`pre/` → tables → `post/`), verified over 3 runs
34. ❌ Table partitioning for `availability_days` / `bookings` by date range
35. ❌ Read replica routing
36. ❌ pgBouncer / PITR backups / restore drill

### 0.4 Authentication

37. ✅ Argon2id password hashing (19 MiB, t=2, p=1)
38. ✅ Timing-equalised login — identical response and CPU cost for unknown email vs wrong password
39. ✅ Access tokens — HS256 JWT, 15 min, algorithm pinned
40. ✅ Refresh tokens — opaque 256-bit, stored as HMAC-SHA256 digest, HttpOnly `SameSite=strict`
41. ✅ Refresh rotation with **replay detection** — reuse burns the whole token family
42. ✅ Per-account lockout after 5 failures, counter incremented in SQL
43. ✅ Per-route rate limiting (5/min on login and register)
44. ✅ Guest checkout supported — `customer_profiles.user_id` nullable (§4)
45. ✅ Field encryption service (AES-256-GCM) for TOTP seeds and payout details
46. ✅ Staff 2FA enrolment — two-step setup (secret then confirm, so a mis-scanned QR
    cannot lock anyone out), 8 recovery codes stored as Argon2id hashes, disable requires
    password + live code, all other sessions revoked on enable
47. ❌ Email verification flow
48. ❌ Password reset flow
49. ❌ Phone / WhatsApp OTP verification

### 0.5 Authorization

50. ✅ Permission model — `resource.action` strings composed into 6 roles in one file
51. ✅ SRS §4 negative requirements asserted in tests (support agents can't touch prices,
    finance can't read chats, partners can't see payment data, no role has `.delete`)
52. ✅ `JwtAuthGuard` registered globally — deny by default, opt out via `@Public()`
53. ✅ `PermissionsGuard` — requires ALL listed permissions
54. ✅ **Resource ownership layer** — `AccessScope` becomes part of the SQL WHERE clause
55. ✅ Fails closed — `read_own` without an owning id resolves to `none`, never `all`
56. ✅ Hidden resources return 404, not 403, so sequential references can't be enumerated
57. ✅ Owning ids carried in the token, so scoping costs no extra query
58. ❌ Per-city / per-market staff scoping (`read_all` is currently platform-wide)
59. ❌ Immediate access-token revocation (a suspended user's token works up to 15 min —
    documented and accepted, but not mitigated)

### 0.6 Auditing

60. ✅ `AuditService` writing inside the caller's transaction
61. ✅ IP, user agent, actor, action, before/after captured (§15)
62. ✅ Redaction helper for passwords, tokens, secrets, account numbers
63. ✅ Timeline events for booking/partner/property/customer histories
64. ✅ Audit interceptor — `@Audited` writes rows automatically, and any mutating route
    marked neither `@Audited` nor `@AuditExempt` logs a startup warning. It immediately
    caught one undeclared route (§15)
65. ❌ Audit log viewer endpoint (§9.3)

---

## Phase 1 — Catalogue and Search

### 1.1 Reference data

66. ✅ Currencies — SYP, USD, EUR, JOD (3 decimals), LBP
67. ✅ Countries — Syria, Jordan, Lebanon (§1.3)
68. ✅ 9 cities with real IANA timezones and the prototype's approved Arabic copy
69. ✅ 7 property types (§8.2), 12 amenities (§5.5), 3 cancellation policies
70. ✅ 4 partner types including `mobility`, seeded to prove §12 extensibility
71. ✅ 10 operational settings matching the approved Rules Engine screen exactly — customer fee
    mode + value, partner rate, confirmation window, same-day cutoff, **pending-payment timeout
    (EC-001)**, first-violation fine, **wallet compensation as a separate value**, refund floor,
    max nights
72. ✅ Seed is idempotent and never truncates; existing setting values are never overwritten
73. ✅ City hero images — staff upload via the same sharp pipeline, `geo.manage` gated,
    served from `cities/<slug>/…`, exposed on the public city endpoint
74. ❌ Tourist categories and city landmark content beyond the seeded tags

### 1.2 Partner inventory management

75. ✅ Create property — **status forced to `draft`**, no `status` field in any contract
76. ✅ Update property, restricted to pre-publication states
77. ✅ Submit for review — blocked unless at least one unit exists
78. ✅ Add and update units, with amenity sets replaced wholesale
79. ✅ Slug derivation with uniqueness fallback
80. ✅ Cross-partner isolation verified — partner B gets 404 on partner A's property and calendar
81. ✅ Property image upload — multipart, `sharp` re-encodes everything to AVIF+WebP at
    3 widths, **EXIF stripped** (verified: source GPS gone), storage abstracted over
    S3/local disk, polyglot + SVG + undersized uploads rejected, traversal blocked
82. ❌ Partner document upload (§8.1 requires ID, commercial register, ownership proof)
83. ❌ Partner self-registration flow (partners are currently created by SQL only)
84. ❌ Partner payout account management endpoints

### 1.3 Availability calendar (§8.4)

85. ✅ Read a date range — generates a row per day, absent = available at base price
86. ✅ Live bookings overlaid as `booked`
87. ✅ Range write as a single set-based upsert (closing a season is one statement)
88. ✅ Per-day price override and per-day minimum nights
89. ✅ `booked` is not partner-settable — it is derived from real bookings
90. ✅ Field-level upsert semantics: editing a price never resets a `closed` day
    _(regression-tested — this bug shipped once and would have caused overbookings)_
91. ❌ Stale-calendar reminders and escalation to suspension (§8.4)
92. ❌ iCal / channel-manager sync

### 1.4 Search (§5.2, §5.3, §5.5)

93. ✅ Mandatory arrival, departure and guest count; optional city (§5.2)
94. ✅ **17:00 same-day cutoff in the city's local time** — verified across DST boundaries
    (Beirut open while Damascus and Amman are closed at the same instant)
95. ✅ Availability anti-join — closed, booked and maintenance days all exclude a unit
96. ✅ Booking anti-join using the same `[)` bound as the exclusion constraint
97. ✅ Guest capacity, min/max nights, per-day min-nights override
98. ✅ Stay total sums actual per-night prices, honouring overrides
99. ✅ One row per property, carrying its cheapest bookable unit
100.  ✅ Only `published` inventory is searchable — verified a draft never surfaces (P-002)
101.  ✅ Filters — city, property type, price range, amenities, free cancellation
102.  ✅ Sort modes with `recommended` as the default, never cheapest (§5.5)
103.  ✅ Trip attributes filter — `properties.attributes` text[] with a GIN index, partner-taggable,
      AND semantics, verified over 9 cases _(was accepted and silently ignored)_
104.  ❌ Map-bounds search
105.  ❌ Full-text / fuzzy search using the trigram indexes that already exist
106.  ❌ Search result caching

### 1.5 Ranking (§5.5)

107. ✅ Recommendation score as one set-based UPDATE — rating, partner score, response speed,
     data completeness, cancellation and complaint penalties
108. ✅ Derived badges — `safra_verified`, `safra_recommends` (never partner-set)
109. ✅ Idempotent recompute
110. ✅ Nightly cron at 03:00 with a **PostgreSQL advisory lock** so only one replica runs it
111. ✅ Admin-triggered manual recompute
112. ❌ Weights moved into `settings` so they can be tuned without a deploy
113. ❌ Paid placement as clearly-labelled slots, separate from organic ranking (§5.5, §11.1)

### 1.6 Staff verification (§8.1, §9.2)

114. ✅ Pending-properties and pending-partners queues, oldest first
115. ✅ Approve / reject a listing, with notes mandatory on rejection
116. ✅ **A listing cannot publish while its partner is unverified**
117. ✅ **Sanctions screening is a hard precondition** for verifying a partner (ADR 0002)
118. ✅ Rejecting a partner suspends their published listings — verified search drops to 0
119. ✅ Attention counters for the §9.2 dashboard
120. ❌ Actual sanctions-screening provider integration (the endpoint records a result;
     nothing calls a screening service)
121. ❌ Document review workflow per document

### 1.7 Public web app (`apps/web`) — **not started**

122. ❌ Next.js 15 App Router scaffold
123. ❌ i18n — `ar` / `en` / `de` with RTL (§1.4)
124. ❌ Design system from the approved prototype (`--bg:#0C0A1C`, `--gold:#E8BC66`, Amiri)
125. ❌ Home page with search engine (§5.1)
126. ❌ City pages, server-rendered for SEO (§5.4)
127. ❌ Results page with filters and labelled ad slots (§5.5)
128. ✅ Property page — gallery, approximate location, 4-state calendar, policy, fees from
     settings, badges, "Book now" / "Ask SAFRA" and **no partner contact before
     confirmation** (P-001, verified)
129. ❌ Accessibility pass and Core Web Vitals budget (§14.1: home < 2 s)
129b. ✅ Checkout page and confirmation page — live server-quoted price with every night
     itemised, guest details without an account (§4), stable idempotency key per form so a
     double-click cannot duplicate a booking, and inline field errors from the shared Zod
     schema. Posts through a Next route handler so the API origin stays server-side and the
     real client IP reaches the audit trail

---

## Phase 2 — Booking and Money — **not started**

130. ✅ Booking creation — `pending_payment` **holds the inventory** via the exclusion
     constraint, so a conflict is rejected BEFORE money moves (§6.3)
131. ✅ Booking state machine — transitions declared as data with permitted actors; an
     invariant test parses the migration to prove `BLOCKING_STATUSES` matches the
     exclusion constraint
132. ✅ Commission calculation — integer minor units throughout (21 tests), flat fee once
     per booking, mode/value/rate all snapshotted onto the booking
133. ✅ Fee model resolved from the approved settings page: customer pays a **flat $1.99**,
     partner pays **7%**. Stored as `customer_fee_mode` + `customer_fee_value` snapshots, so an
     admin switching to a percentage never rewrites existing bookings.
134. ❌ Payment provider abstraction with per-country routing (ADR 0002)
135. ❌ First real gateway integration (Sham Cash, and cards via the chosen entity)
136. ✅ Idempotency — claim-first insert on the primary key, so a concurrent replay never
     runs the handler twice; same key + different body returns 422 (EC-003)
137. ❌ Webhook handling and reconciliation (EC-002)
138. ❌ Split payment — gift card + wallet + card in one transaction (§7.3)
139. ✅ Double-entry ledger — 4 legs per captured payment, posted in the SAME transaction as
     the status change; partner fines posted too. Trial balance endpoint verified balanced
     across multiple bookings, and the append-only + balance triggers verified to reject
     both an unbalanced group and an UPDATE
140. ✅ FX rate snapshotted onto each booking, exact bigint arithmetic at SYP magnitudes
141. ❌ Wallet credit/debit operations
142. ❌ Gift card purchase, redemption, partial balance (§11.2)
143. ❌ Coupon validation and redemption (§11.3)
144. ❌ Refunds — full and partial, routed back through the original provider (§7.4)
145. ✅ Confirmation SLA — advisory-locked sweep every minute, self-healing (a lost job
     would never fire; the next sweep still finds it). Also expires unpaid holds (EC-001)
146. ✅ Partner fines and wallet compensation — violation recorded with occurrence number,
     wallet created if absent and credited, partner score docked (§6.4, P-007)
147. ❌ Booking voucher + QR code PDF, Arabic-safe (§6.5)
148. ❌ Transactional outbox so `BookingConfirmed` side effects cannot be lost (§14)
149. ❌ PCI review — card data must never touch SAFRA servers

---

## Phase 3 — Partner Dashboard UI — **not started**

150. ❌ Partner authentication and onboarding wizard
151. ❌ Property and unit editors
152. ❌ Calendar UI with drag-select pricing and availability
153. ❌ Booking requests with the SLA countdown (§8.3)
154. ❌ Earnings, occupancy and response-rate stats
155. ❌ Violations and fines view
156. ❌ Real-time new-booking notifications

---

## Phase 4 — Admin Command Center — **not started**

157. ❌ `apps/admin` scaffold (separate app, off the public attack surface)
158. ❌ Dashboard home with the §9.2 panels
159. ❌ The 18 sections listed in §9.3
160. ❌ Booking detail with full timeline, messages and internal notes (§9.4)
161. ❌ Settings editor for commissions, SLA, fines, cutoff (P-005)
162. ❌ **Emergency Mode** activation per city/country (EC-009)
163. ❌ Audit log viewer
164. ❌ Staff user and permission management

---

## Phase 5 — Communications — **not started**

165. ❌ WhatsApp Business API provider selection and integration (§18)
166. ❌ WhatsApp delivery-state tracking per message (§10.2)
167. ❌ Email templates in 3 languages (§10.3)
168. ❌ Three-party chat: customer ↔ SAFRA ↔ partner (§10.1)
169. ❌ Contact-detail masking before booking confirmation (§10.1)
170. ❌ Support tickets and disputes (§13.1)
171. ❌ In-app notification centre
172. ❌ BullMQ + Redis queue, and migrating the nightly ranking job onto it (§14)
173. ❌ Event engine wiring `BookingConfirmed` → WhatsApp + email + voucher + QR + timeline

---

## Phase 6 — Ads, Reports, Hardening — **not started**

174. ❌ City-targeted advertising for restaurants and activities (§11.1)
175. ❌ Ad impression and click tracking
176. ❌ Reviews and ratings — submission, moderation, aggregation into `properties.rating`
177. ❌ Financial and operational reports (§9.3)
178. ❌ Partner payout batches across SY / JO / LB (§18, unresolved)
179. ❌ Load test against a 1M-user profile
180. ❌ Penetration test
181. ❌ Observability — OpenTelemetry, Sentry, structured logs, dashboards
182. ❌ UAT and admin training (§17)

---

## Cross-cutting infrastructure — **not started**

183. ❌ Dockerfiles and `docker-compose` for local development
184. ❌ Staging and production environments
185. ❌ Cloudflare in front (WAF, CDN, DDoS)
186. ❌ Secret management (not `.env` in production)
187. ❌ Automated backups with a tested restore
188. ❌ Zero-downtime deploy and migration strategy

---

## Decisions needed from the business

These block engineering work and are not ours to make.

189. ❌ **Merchant entity jurisdiction** — Jordan/UAE vs Syria. Blocks Phase 2.
     Recommendation and reasoning in `.claude/memory/0002-payments-entity-and-sanctions.md`.
190. ✅ Customer fee model — **flat $1.99**, confirmed by the approved settings screen
     ("رسوم ثابتة تضاف على كل حجز"). Partner side is 7%.
191. ❌ WhatsApp BSP selection
192. ❌ Hosting provider and region
193. ❌ Partner payout mechanism per country
194. ❌ Maps provider billing account (MapLibre + MapTiler recommended)
195. ❌ Legal review of terms, privacy policy and the partner contract

---

## Immediate next steps

1. `apps/web` — items 122–129 _(next up)_
2. Property image upload — item 81. The ranking score already rewards photo count, so
   completeness scoring measures something partners cannot yet supply.
3. Staff 2FA enrolment — item 46. Login verifies a TOTP code but nobody can turn it on.
4. Audit interceptor — item 64. Every call site currently writes explicitly, so a new
   endpoint can ship with no audit trail.
