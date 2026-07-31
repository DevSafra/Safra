# SAFRA — Implementation Roadmap

Every implementation step from zero, derived from `SAFRA_SRS_Company_File_Detailed_v1.0`.

- ✅ = done and verified
- ❌ = not done (or only partially done — the note says what exists)

Status as of **2026-08-01**. `pnpm verify` green: format, lint, typecheck, **304 tests
passing** against a real PostgreSQL, production dependencies clean.

**Scale of what remains:** the API foundation, catalogue, search, the public booking
funnel and most of the money layer are done. What is not: spending stored value
(split payment, gift cards, coupons), partner self-service, both staff dashboards, and
every outbound communication. No payment gateway is contracted, so nothing can take a
real card yet — that is a commercial blocker, not an engineering one (item 135).

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
10. ⚠️ Pre-commit hook — **format only.** `.githooks/pre-commit` blocks a commit whose
    staged files Prettier would reformat, which is the failure that actually happened
    (a formatting slip stopped CI at step one and masked every later step). Lint and
    typecheck are still not run at commit time; they need the workspace `dist` built
    first, so a naive hook would be slow enough that people disable it

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
    - ❌ **27a** Money columns are `numeric(14,2)` while `currencies.decimals` records 3 for
      JOD. A JOD amount is therefore rounded to two decimals wherever it is stored, and
      `currencies.decimals` is documentation rather than something the schema honours.
      Not fixed here deliberately: it is a change to ~20 columns and every money path,
      which does not belong behind a wallet feature. `MONEY_SCALE` in
      `apps/api/src/common/money.ts` now names the real constraint in one place so the
      rounding happens predictably rather than at whichever write lands first
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
47. ✅ Email verification — sent on registration and re-sendable, 24-hour single-use
    token stored as a digest. Not a precondition for signing in (§4 keeps the barrier to
    booking low) but it IS the precondition for claiming guest bookings, because that is
    a transfer of access to someone else's data
48. ✅ Password reset flow — request and confirm, with the properties that make it safe
    rather than merely present:
    - **Requesting reveals nothing.** Unknown address, suspended account, throttled and
      sent are all indistinguishable. A "no such account" reply would be an easier
      customer-list oracle than the login form, needing no password guess at all
    - **Tokens are credentials and are treated as such** — 256 bits, stored as a SHA-256
      digest, single-use via a conditional UPDATE so two concurrent clicks cannot both
      win, one hour to live, and issuing a new one supersedes any outstanding link
    - **Completing a reset revokes every session.** People reset because they think
      someone else has the password; leaving that person's refresh tokens alive hands
      the account straight back
    - **A per-ACCOUNT throttle sits behind the per-IP limit**, so an attacker cycling
      addresses cannot bury one victim's inbox and drown out a real security notice
    - **Links are built from `APP_URL`, never a request header** — a reset link
      assembled from a Host header is the classic host-header injection, where the
      victim's own click hands their token to the attacker's domain
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

### 0.7 Known defects, found and not yet fixed

Recorded here rather than left in a commit message, because each was found while
building something else and none is urgent enough to have widened that change.

- ❌ **65a — Booking list pagination truncates its cursor to milliseconds.**
  `BookingsService.list` builds the keyset bound from a driver-supplied `Date`, which
  holds milliseconds, while PostgreSQL `timestamptz` holds microseconds. Any two
  bookings sharing a millisecond at a page boundary make the next page come back
  empty and the client believe it has reached the end. Found while building the
  wallet statement, where rows written in one transaction share a timestamp _by
  construction_ and the bug fires every time. `encodeCursor`/`decodeCursor` now
  accept and return a full-precision sort key, so the fix for bookings is to select
  the raw timestamp instead of the `Date`; it is not applied there yet because two
  bookings in the same millisecond needs concurrency this system does not yet see

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
83. ✅ Partner self-registration — `POST /partner/register` creates the account and the
    partner row in ONE transaction, so a half-made application cannot leave a user with
    partner permissions and no partner to scope them to (`requirePartnerId` refuses
    that, locking the applicant out of what they were just told was created).
    An OPEN endpoint minting `partner`-role accounts is only acceptable because of what
    it does not grant: the applicant lands in `pending`, item 116 blocks publication
    while unverified, and ADR 0002 makes sanctions screening a hard precondition for
    verifying them. Anyone may apply; nothing they create reaches a customer until a
    human and a screening check have both passed — pinned by tests rather than assumed.
    No session is issued: partner sessions stay on the one login path that carries the
    lockout counter and the 2FA check
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
     nothing calls a screening service). **Now a legal obligation, not a precaution:** a German
     merchant entity is bound by EU sanctions law, and while Regulation (EU) 2025/1098 lifted
     the economic measures from 2025-05-29, asset freezes on persons and entities tied to the
     former al-Assad regime were renewed on 2026-05-18 until 2027-06-01. Screening partners
     against the EU consolidated list is therefore required before verification
121. ❌ Document review workflow per document

### 1.7 Public web app (`apps/web`)

_Statuses corrected 2026-08-01: 122–127 were still marked "not started" while the pages
had in fact shipped. Verified against the files, not against memory._

122. ✅ Next.js 15 App Router scaffold
123. ✅ i18n — `ar` / `en` / `de`, with `dir` resolved per locale on `<html>` (§1.4)
124. ✅ Design system from the approved prototype (`--bg:#0C0A1C`, `--gold:#E8BC66`, Amiri
     for display, Cairo for text)
125. ✅ Home page with search engine (§5.1)
126. ✅ City pages, server-rendered for SEO (§5.4)
127. ⚠️ Results page — filters and the four sort modes are live, **ad slots are not**.
     Advertising is Phase 6 (items 174–175), so there is nothing to label yet
128. ✅ Property page — gallery, approximate location, 4-state calendar, policy, fees from
     settings, badges, "Book now" / "Ask SAFRA" and **no partner contact before
     confirmation** (P-001, verified)
129. ❌ Accessibility pass and Core Web Vitals budget (§14.1: home < 2 s)
     - ✅ **129c** **Customer authentication in `apps/web`.** Sign in, register, sign out,
       a protected `/account` page showing bookings and the wallet with its statement,
       and signed-in state in the header — all three locales. The API already had login,
       rotation and revocation (items 39–41); what was missing was every part of the web
       app that could reach them.
       - **One HttpOnly cookie on the WEB origin**, not the API's. The browser never
         talks to the API directly (that is what the route-handler proxies are for), so
         a cookie scoped to the API's path is one the browser can neither see nor send.
         The handlers capture the API's `Set-Cookie` and re-issue it here.
       - **`SameSite=Strict`**, matching the API and rule 1. Known cost, accepted: a link
         from an email lands anonymous on the first navigation.
       - **Rotation happens in MIDDLEWARE**, because a server component cannot set a
         cookie and the access token lasts 15 minutes. It writes the REQUEST jar as well
         as the response — without that, the very render which triggered the refresh is
         the one that still sees the expired token.
       - **A failed refresh is not always a logout.** 401/403 clears the session; a 502
         does not, because treating an API restart as a logout would empty every browser
         at once.
       - Verified against a running stack, not just a green build: register → protected
         page → expired token silently rotating mid-request → replayed refresh token
         revoking the session → sign-out. A **real bug** surfaced there and was fixed —
         the protected-route redirect returned early, so a revoked session kept its dead
         cookie and retried the doomed refresh on every request.
     - ✅ **129d** Password reset and email-confirmation screens, in all three locales.
       Verified live end to end against a real SMTP server: register → reset email
       delivered → old password rejected → new one accepted → link refuses reuse
     - ✅ **129e** Guest bookings attach to an account **once the address is verified** —
       not at registration. Registration alone would let anyone type a stranger's email
       and take their guest bookings, which carry travel dates, phone numbers and
       amounts paid. Proving control of the inbox is the minimum bar for a transfer of
       access. The claim also carries any **wallet balance** across: §6.4 credits SLA
       compensation to whichever profile made the booking, including a guest one, so
       moving the bookings without the money would strand real compensation on a profile
       the customer can no longer reach
     - ✅ **129b** Checkout page and confirmation page — live server-quoted price with every night
       itemised, guest details without an account (§4), stable idempotency key per form so a
       double-click cannot duplicate a booking, and inline field errors from the shared Zod
       schema. Posts through a Next route handler so the API origin stays server-side and the
       real client IP reaches the audit trail

---

## Phase 2 — Booking and Money

_Header corrected 2026-08-01: this said "not started" while most of the phase had
shipped._

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
134. ✅ Payment provider abstraction — a `PaymentProvider` port plus a registry that routes
     per country from the `payment.provider_routing` setting (P-005, so a new acquirer is a
     settings row, not a deploy). Shaped around the hardest rail (PSD2/SCA card, async
     webhook capture) so simpler rails fit inside it. Two adapters ship: `manual_transfer`
     (SEPA, finance-confirmed) and a `simulator` for development/CI
135. ❌ First real gateway integration — **blocked commercially, not technically.** The
     approved customer-facing methods are **Visa, Mastercard, Klarna, Sham Cash**
     (Bashar, 2026-07-30). PayPal and Apple Pay were removed; Stripe is excluded as a
     gateway. Each remaining method needs a different agreement first: the card schemes
     an acquirer, Klarna a direct merchant agreement, Sham Cash a Syrian collecting
     party. **Klarna is the most tractable** — a licensed EU bank, contracted directly
     with no acquirer needed, native to the German market the GmbH sits in, and it
     carries the customer's credit risk. Until one is signed `GET /payments/methods`
     returns an empty list and checkout says so, rather than showing four unusable
     logos. See ADR 0002
     - ✅ **135a** Approved method set enforced end to end — `payment_method` narrowed by
       migration, with a guard that refuses to run while legacy `paypal`/`apple_pay` rows
       exist (a historic payment needs a deliberate target, which a migration must not
       pick for itself); a `CUSTOMER_FACING_METHODS` whitelist that the request schema and
       the offered-methods endpoint both derive from; and a checkout selector rendering
       only methods a routed provider can actually serve
136. ✅ Idempotency — claim-first insert on the primary key, so a concurrent replay never
     runs the handler twice; same key + different body returns 422 (EC-003)
137. ✅ Webhook handling (EC-002) — HMAC-SHA256 over the RAW body with a 5-minute replay
     window (rejecting future-dated timestamps too), multi-secret acceptance for zero-downtime
     rotation, and exactly-once delivery via a `(provider, provider_event_id)` unique index
     rather than check-then-act, which two concurrent retries would race. Every delivery is
     persisted including forged ones — a rejected webhook is the only evidence of probing —
     and the payload is immutable by trigger while processing state stays writable. An unknown
     provider reference is DEFERRED for retry, not rejected, because a webhook can outrun the
     response that created the payment row
     - ❌ **137a** Reconciliation report against a provider settlement file (needs a real PSP)
138. ⚠️ Split payment (§7.3) — **wallet + card is done end to end in the API; gift cards
     and coupons are not** (items 142–143), and the checkout UI is blocked (138b).
     `applyWallet` is a BOOLEAN on the start-payment contract, never an amount: how much
     is derived server-side, because a client-supplied figure is a client-supplied price
     under another name. What the gateway is asked for drops to `total − wallet`; the
     capture group splits its DEBIT side into `customer_payment` + `wallet_debit` while
     the credit side is untouched, so `total = fee + commission + payable` still holds.
     Four decisions worth keeping:
     - **The hold is taken AFTER the gateway accepts the intent, never before.** Reversed,
       every provider blip strands a customer's balance — debited, no payment to show for
       it, nothing to release it until the booking expires. Pinned by a test that fails
       when the two are swapped (verified: 50.00 vanishes).
     - **A balance covering the whole total skips the provider entirely.** No redirect, no
       webhook, no acquirer asked to authorise 0.00 — but capture still routes through
       `markPaid`, so the ledger keeps one entry point.
     - **Abandoning checkout returns the balance.** The EC-001 sweep and a customer-side
       cancellation both credit the hold back. Without it, closing the tab after applying
       a balance simply makes the customer poorer.
     - **Refunds return stored value first**, then the remainder through the originating
       provider. A wallet-only booking refunds with no provider call at all — it carries
       `provider = 'internal'`, which is not in the registry and never will be, so
       requiring one would have made exactly those refunds impossible.
     - ❌ **138a** Gift card and coupon composition at the same seam (items 142–143)
     - ✅ **138b** Checkout UI — unblocked by 129c and shipped with it. A signed-in
       customer sees their applicable balance and the reduced amount due, behind an
       opt-IN checkbox: stored value is the customer's own money, and a balance quietly
       consumed by a booking they were half-committed to is a support ticket. Guests are
       shown an invitation to sign in rather than a blocked control, because §4 keeps
       guest checkout open and it must not read as a requirement
     - ❌ **138c** Cross-currency application. A balance is offered only when it is held in
       the booking's own currency. `WalletService` can convert, but doing it at checkout
       would quote a figure that moves with the FX rate between page load and payment;
       that needs a quoted, held rate
139. ✅ Double-entry ledger — 4 legs per captured payment, posted in the SAME transaction as
     the status change; partner fines posted too. Trial balance endpoint verified balanced
     across multiple bookings, and the append-only + balance triggers verified to reject
     both an unbalanced group and an UPDATE
140. ✅ FX rate snapshotted onto each booking, exact bigint arithmetic at SYP magnitudes
141. ✅ Wallet credit/debit operations — closes a hole that had been open since the SLA
     sweep shipped: §6.4 compensation was being credited into wallets that no customer
     could see and no code could spend. `WalletService` is the single primitive —
     exact bigint arithmetic, one currency per wallet, `FOR UPDATE` row lock, balance
     cache and append-only transaction written together. `GET /wallet` and
     `GET /wallet/transactions` for the customer; `GET`/`POST /admin/wallets/:id/…`
     for staff, with adjustments gated on `WALLET_ADJUST`, audited transactionally and
     balanced against a new `wallet_adjustment` ledger account. Three defects fixed on
     the way in, each verified by a test that fails without the fix:
     - **Float arithmetic on money.** The SLA sweep advanced the balance with
       `Number(balance) + compensation` and a hardcoded `toFixed(2)` — the same class
       of defect as the FX fallback (150b), in the one codebase that computes every
       booking total in integer minor units precisely to avoid it.
     - **Mixed currencies in one balance.** A customer compensated on a USD booking and
       then a JOD one had both numbers added into a single scalar. Amounts now convert
       through SYP, and a wallet's currency never changes after creation.
     - **Lost updates.** There was no row lock, and the service is called from paths
       that do not own a transaction. Five concurrent credits of 3.33 produced 6.66
       instead of 16.65 — three silently discarded. The movement now opens its own
       transaction (a SAVEPOINT when nested), so the lock holds regardless of caller.
     - ✅ **141a** Spending the balance — done in the same session as item 138 below.
     - ❌ **141b** Reconciliation job comparing `wallets.balance` against
       `SUM(wallet_transactions)` on a schedule. The comparison exists
       (`sumTransactions`, surfaced on the admin balance endpoint) but nothing runs it
       periodically or alerts on drift — that belongs with the queue in §14.
142. ❌ Gift card purchase, redemption, partial balance (§11.2)
143. ❌ Coupon validation and redemption (§11.3)
144. ✅ Refunds (§7.4) — tiers read from the booking's policy SNAPSHOT, never the live
     policy, so a partner tightening terms cannot shrink a refund already owed; the §7.4 floor
     applies even when no tier matches. Refundable base excludes SAFRA's service fee, already
     refunded amounts are subtracted so a second call cannot pay out twice, and the refund
     routes back through the originating provider. Two balanced ledger legs posted in the same
     transaction as the refund row
145. ✅ Confirmation SLA — advisory-locked sweep every minute, self-healing (a lost job
     would never fire; the next sweep still finds it). Also expires unpaid holds (EC-001)
146. ✅ Partner fines and wallet compensation — violation recorded with occurrence number,
     wallet created if absent and credited, partner score docked (§6.4, P-007)
147. ❌ Booking voucher + QR code PDF, Arabic-safe (§6.5)
148. ❌ Transactional outbox so `BookingConfirmed` side effects cannot be lost (§14)
149. ❌ PCI review — card data must never touch SAFRA servers
     - ✅ **150a** Guest payment authorization — a 256-bit per-booking access token, returned once at
       creation and stored only as a SHA-256 digest. Required because §13.2 makes references a
       year-scoped sequence: without it anyone could pay for, and read the total of, a guessed
       booking. Constant-time comparison, a dummy compare when the booking is absent so timing
       cannot confirm which references exist, 404-not-403 throughout, and revoked on capture
     - ✅ **150b** **FX defect fixed (found and fixed 2026-07-30).** Pricing previously fell
       back to a rate of `'1'` when `fx_rates` had no row — the state of every fresh
       install — so a $220 booking recorded `total_syp = 220` instead of ~2,860,000.
       Nothing failed and nothing warned. Pricing now **refuses**: a missing rate raises
       503 with a generic client message and an actionable server log, because a platform
       that cannot convert to its own accounting currency cannot honestly price a stay.
       Consequences, all deliberate: a fresh deployment cannot take bookings until an
       admin sets a rate; no rate is seeded, since a hardcoded one goes stale and a wrong
       rate is worse than a missing one because it looks plausible; and `pnpm db:seed`
       prints an ACTION REQUIRED block when none is configured, so the requirement is
       visible where an operator will see it
     - ❌ **150c** PSP fee ledger leg — the fee is recorded on `payments.provider_fee_amount` and the
       `payment_provider_fee` account exists, but no leg is posted. Deferred deliberately:
       most PSPs only report the fee at settlement, not capture, so whether it belongs in the
       capture group or a later settlement group depends on the provider chosen in item 135
     - ❌ **150d** Bank-transfer instructions display — the return page renders the remittance reference
       and next steps, but not the GmbH's IBAN/beneficiary. Those are business data belonging in
       settings alongside the payout configuration (items 84, 193), so the page has nowhere to
       read them from yet
     - ✅ **150e** FX rate administration — `GET`/`POST /admin/fx-rates` gated on
       `FX_RATE_MANAGE`, shipped in the SAME change as the refusal because refusing with
       no remedy would have bricked pricing. Rates are decimal STRINGS (a JSON number is
       an IEEE-754 double, which is the class of bug being fixed); setting one is an
       INSERT so history is never rewritten and a booking's snapshot stays reproducible;
       the cache is invalidated on write so an admin sees pricing recover immediately; and
       the audit row records the old and new rate, written inside the insert transaction
       because the route interceptor resolves its subject from a route param and captured
       neither
     - ❌ **150f** Grant `FX_RATE_MANAGE` to `finance_officer` — a policy call, not an
       engineering one. Today only `super_admin` holds it, so finance cannot see or set
       the rate their books depend on

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

189. ✅ **Merchant entity** — `Safra Technologies GmbH` (Germany), decided by Bashar
     2026-07-30. This superseded the earlier Jordan/UAE recommendation and, in doing so,
     exposed that the recommendation's premise was wrong: entity jurisdiction was never what
     gated Stripe/PayPal. Both bar services _originating from_ Syria regardless of where the
     merchant sits. The GmbH's real advantage is that it moves the Syria exposure off the
     card-network leg and onto the partner payout leg, which is batchable and auditable and
     does not sit in a customer's checkout. Reasoning in
     `.claude/memory/0002-payments-entity-and-sanctions.md`. **A PSP willing to underwrite
     the exposure is now the critical path (item 135).**
190. ✅ Customer fee model — **flat $1.99**, confirmed by the approved settings screen
     ("رسوم ثابتة تضاف على كل حجز"). Partner side is 7%.
191. ❌ **Which currency the Rules Engine money settings are denominated in.** Surfaced by
     item 141 and not answerable from the code. `wallet.sla_compensation` and
     `partner.first_violation_fine` are bare numbers (10), and the approved screen shows
     them with a `$`. Today the sweep treats them as the BOOKING's currency, so a partner
     who misses the window on a 10 JOD booking is fined "10" JOD (~$14) while one who
     misses a USD booking is fined $10 — the same offence, different penalties. Treating
     them as USD instead is a one-line change to the sweep, but it changes what partners
     owe and what customers receive, so it is Bashar's call and not an engineering
     default. The wallet's own conversion is already correct either way
192. ❌ WhatsApp BSP selection
193. ❌ Hosting provider and region
194. ❌ Partner payout mechanism per country
195. ❌ Maps provider billing account (MapLibre + MapTiler recommended)
196. ❌ Legal review of terms, privacy policy and the partner contract

---

## Immediate next steps

1. **Partner document upload and payout accounts — items 82, 84.** Partners can now apply
   (item 83), but §8.1 requires ID, commercial register and ownership proof before anyone
   can be verified — so the queue still cannot be worked to completion. Documents need a
   PDF-aware upload path (the existing pipeline re-encodes images through `sharp`, which
   a PDF must not go through), and payout accounts need the field-encryption service that
   already exists.
2. **Gift cards and coupons — items 142–143.** They compose at the seam split payment
   established, so the second and third stored-value instruments are far cheaper now
   than they would have been before it.
3. **Grant `FX_RATE_MANAGE` to `finance_officer` — item 150f.** One line, blocked only on
   a policy nod: finance currently cannot see or set the rate their books depend on.
