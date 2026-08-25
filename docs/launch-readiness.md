# Launch readiness

The state of the platform on 2026-08-08, and everything that stands between it and a launch.

Written so that infrastructure, compliance and launch execution can begin without further
discovery. Where something is undecided, it says who decides it.

---

## 1. Completed components

| Component                                                                                     | State                             | Evidence                                                                                                    |
| --------------------------------------------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Customer app** — search, property, checkout, payment, account, wallet, reviews              | Complete                          | `e2e/`, 191 browser tests                                                                                   |
| **Staff console** — 19 sections, registries, finance, disputes, emergency mode, audit         | Complete                          | `e2e/navigation.spec.ts` sweeps all 19                                                                      |
| **Partner portal** — dashboard, listings, media, calendar, edit, units, payouts, reviews, 2FA | Complete                          | `e2e/partner*.spec.ts`                                                                                      |
| **Booking lifecycle**                                                                         | Complete                          | Exclusion constraint proven under contention                                                                |
| **Payments and ledger**                                                                       | Complete                          | Four-leg balanced groups; balance enforced by trigger                                                       |
| **Payouts**                                                                                   | Complete                          | Accrual → close → release → paid, immutable once paid                                                       |
| **Reviews (P-006)**                                                                           | Complete                          | Enforced by database trigger, not convention                                                                |
| **Media pipeline**                                                                            | Complete                          | EXIF stripped, variants, cover invariant by partial unique index                                            |
| **Notifications**                                                                             | Complete for 3 events, email only | `docs/notifications.md`                                                                                     |
| **Auth** — second factor, lockout, rotation, throttling                                       | Complete                          | `docs/auth-rate-limiting.md`. Staff prove TOTP; partners prove a code emailed at every sign-in (2026-08-20) |
| **i18n** — ar/en/de, ICU plurals, error codes                                                 | Complete                          | 1,088 tests incl. plural boundaries                                                                         |
| **RBAC and staff scope**                                                                      | Complete                          | Server-enforced, matrix derived from the guard                                                              |
| **Audit log**                                                                                 | Complete                          | Append-only by trigger, survives TRUNCATE                                                                   |
| **Scheduled jobs**                                                                            | Complete                          | Advisory-locked, telemetry in `scheduled_job_runs`                                                          |

**Also 2026-08-20 — the partner joining process was completable for the first time.** Accepting a
request emailed a link to `/invitation/{token}`, a page that had never been built, so every
accepted partner was stranded and every partner on the platform had come from the seed. The page
exists now and the journey was walked end to end in a browser. See `O-partner-8`, and `O-sec-9` for
the second factor that changed with it.

**No unblocked engineering item remains** on this list — all three are closed, the last on
2026-08-25. They stay recorded rather than folded away because every one came out of a security pass
rather than a test, which is the point the line beneath the table makes:

| Item      | What                                                                                | Severity     |
| --------- | ----------------------------------------------------------------------------------- | ------------ |
| `O-sec-7` | **Closed 2026-08-25** — one shared describer, every call site, FOUR columns not one | was **High** |
| `O-sec-6` | **Closed 2026-08-20** — swept nightly, ten sessions per account, both tested        | Low          |
| `O-api-2` | **Closed 2026-08-25** — five codes; two of the seven needed nothing at all          | was Low–Med  |

None of them blocks a launch and none needs anything external. They are listed here rather than
folded away because this line read "No unblocked engineering item remains" until they were found,
and that sentence is what a reader trusts.

---

## 2. Remaining operational risks

| #   | Risk                                                 | Severity | Status                                                                    |
| --- | ---------------------------------------------------- | -------- | ------------------------------------------------------------------------- |
| 1   | **No alerting.** A job that stops firing is silent   | **High** | Designed — `docs/alerting.md`. Needs `M-1` + ½ day for a metrics endpoint |
| 2   | **No backups, no tested restore**                    | **High** | `M-3`. Needs `M-1`                                                        |
| 3   | **Never load-tested.** No capacity number is claimed | **High** | Planned — `docs/load-testing.md`. Needs `M-1`                             |
| 4   | **No malware scanning** on identity documents        | Medium   | Recommended — `docs/malware-scanning.md`. ClamAV sidecar, 1–2 days        |
| 5   | **Media config drift** between API and apps          | Medium   | Reduced — `docs/media-integrity.md`. One deployment assertion closes it   |
| 6   | **Notifications send in-request**                    | Medium   | Designed away — `docs/background-jobs-design.md` phase 2                  |
| 7   | **No on-call rota**                                  | Medium   | Organisational. Alerting without a recipient is worse than none           |
| 8   | **Rate limiting fails open** when Redis is down      | Low      | Deliberate. Alert 11 covers it                                            |
| 9   | **`availability_days` unpartitioned**                | Low      | ~70M rows at target scale. Load test decides                              |

---

## 3. Remaining external dependencies

| Dependency                        | Owner               | Blocks                                                      |
| --------------------------------- | ------------------- | ----------------------------------------------------------- |
| **Deployment target and region**  | Bashar              | Risks 1, 2, 3, 6 — **the single highest-leverage decision** |
| Object storage + CDN provisioning | Infrastructure      | Media in production                                         |
| SMTP provider                     | Vendor              | All email                                                   |
| Payment gateway contract          | Vendor + legal      | Real money                                                  |
| WhatsApp BSP                      | Vendor              | Second notification channel                                 |
| Sanctions data feed               | Vendor + compliance | Screening against current lists                             |
| Malware scanning decision         | Bashar              | Risk 4                                                      |
| Penetration test                  | External            | Security sign-off                                           |
| Retention and erasure policy      | Legal               | GDPR posture                                                |
| Fine-deduction business rule      | Bashar              | Payout arithmetic (`D-fine-1`)                              |

---

## 4. Launch blockers

**The authoritative list, agreed with Bashar on 2026-08-08.** Ten items. Nothing is added to this
list without his agreement, and nothing leaves it without evidence.

| #   | Blocker                                                | Owner               | Depends on | Where it is specified             |
| --- | ------------------------------------------------------ | ------------------- | ---------- | --------------------------------- |
| 1   | **Deployment target selection**                        | Bashar              | —          | `M-1`                             |
| 2   | **Backup implementation and a verified restore drill** | Infrastructure      | 1          | §6 below, `M-3`                   |
| 3   | **Sanctions feed activation**                          | Compliance + vendor | —          | `M-2`                             |
| 4   | **Malware scanning for identity documents**            | Bashar (decision)   | 1          | `docs/malware-scanning.md`        |
| 5   | **External penetration test**                          | Bashar (vendor)     | 1          | `S-9`                             |
| 6   | **Retention / erasure policy reconciliation**          | Legal               | —          | §10 below, `S-4`                  |
| 7   | **WhatsApp provider selection**                        | Bashar (vendor)     | —          | roadmap 192                       |
| 8   | **Fine-deduction policy decision**                     | Bashar              | —          | `D-fine-1`                        |
| 9   | **Monitoring deployment and on-call ownership**        | Infrastructure      | 1          | `docs/alerting.md` — **contract** |
| 10  | **Load-testing execution and validation**              | Engineering         | 1 ¹        | `docs/load-testing.md`            |

**Item 1 gates five others** (2, 4, 5, 9, 10). It is the single highest-leverage decision available
and everything downstream of it is already specified.

**Items 3, 6, 7 and 8 do not depend on hosting** and can proceed in parallel today.

**¹ Item 10 is partly discharged, 2026-08-20.** The capacity run still needs the deployment target and
**no capacity figure has been produced or should be quoted**. What was executed is the half
`docs/load-testing.md` says is honest without infrastructure — query plans and business invariants —
for scenarios 2 (booking contention), 3 (deep pagination) and 4 (authentication under attack), against
`safra_load` at the documented volumes.

**Fifteen defects, twelve fixed.** Full record: **`docs/load-test-results-2026-08-20.md`**. The three
that change the launch picture:

|                                       |                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Confirmed sound**                   | The `daterange` exclusion constraint held under 10,550 contended attempts on 20 units — zero double bookings. The five-attempt account lockout fires and holds under a distributed attack. Every auth refusal is generic, so the endpoint is not an enumeration oracle under load. Zero 5xx across 2.4M auth requests                                                                                                                                       |
| **New, needs a decision from Bashar** | `O-sec-3` — a legitimate customer on an attacked egress address signed in **0 times out of 30**. The per-IP ceiling of 40/min on `/auth/login` is shared by everyone behind one address, and 40/min is 0.67/s: an attacker at one request per second denies sign-in to that address about a third of the time. For a market behind carrier-grade NAT that is live availability risk. Recommended fix: count only FAILED sign-ins against the per-IP ceiling |
| **New, engineering**                  | `O-api-1` — pool exhaustion answers 500 rather than a coded 503, so a capacity condition will page whoever owns the 5xx signal in `docs/alerting.md`. The body is generic, verified: no SQL, no parameters, no PII                                                                                                                                                                                                                                          |

### Both resolved, 2026-08-20 — and one number is still open

Bashar approved both changes the same day. What shipped:

- **`O-api-1` is closed.** `AppExceptionFilter` answers a pool-acquisition timeout with a coded
  **503 and a jittered `Retry-After`**, and gives every other unhandled error the translatable
  `request.unknown` instead of a bare 500. The 503 set is deliberately narrow — only conditions
  where no statement ever reached the database, so a retry cannot duplicate a non-idempotent write.
  **This changes an alerting rule that is not yet armed:** signal 12 must exclude
  `request.capacity` or it will page for load, and new signals 12b/12c count capacity separately.
  See `docs/alerting.md`, "Capacity refusals".
- **`O-sec-3` is closed**, in two parts, because the first does not work without the second. A
  successful sign-in no longer spends the per-IP ceiling, so legitimate traffic cannot exhaust an
  address's budget — but that alone would not have helped the customer in the measurement, since an
  attacker's traffic IS failures. So the ceiling also moved from **40 to 300 failed sign-ins a
  minute** (Bashar). An attacker must now sustain five failed sign-ins a second from one address to
  starve it, against 0.67 before. The accepted cost: one address can drive 60 accounts to lockout a
  minute rather than 8. The account lockout and the per-(IP, account) budget are untouched.
- **`O-page-1` is closed.** The `page` ceiling is **1,000**, down from 100,000 — a 30× reduction in
  the worst-case cost of a single request, from 2.5 million rows read to return 25 down to 25,000.
- **Two items came out of the work, neither a blocker:** `O-api-2` — seven refusals still answer a
  hand-written English sentence with no error code, two of which a customer or a partner can reach.
  And `O-sec-5` — the residual of `O-sec-3` is a shared-IP problem no in-application limiter can
  solve, so an edge rate-limit rule on `POST /auth/login` is now a **required deliverable of
  `M-1`** rather than a suggestion.

**None of these is a launch blocker.** The alerting-rule edit is, however, a **prerequisite of
arming alerting at all** — it belongs with `S-1`, not after it. And `M-1` has gained one line of
scope it did not have this morning: `O-sec-5`.

Two security defects were found and **fixed**: the per-account rate limiter could be bypassed _and
aimed_ with a forged `X-Forwarded-For` (16 of 16 attempts got through), and a failed idempotency
release left a booking claim held for 24 hours while masking the real error. Neither was reachable at
fixture volumes.

**Scenarios 5 (media/CDN) and 6 (12-hour soak) remain deferred** — both need infrastructure rather
than a decision.

### What is NOT on this list, and why

- **The notification queue (BullMQ).** Designed and ready (`docs/background-jobs-design.md`), and
  deferred deliberately. The platform launches without it; the accepted cost is that an unreachable
  mail server adds its timeout to the request that triggered it.
- **Console plural coverage beyond what shipped**, bulk unit creation, and the remaining
  test-suite debris. All cosmetic or internal.

## 5. Security posture

**Implemented and verified:**

- Argon2id passwords; short-lived access tokens with rotating, revocable refresh; `HttpOnly`
  `Secure` `SameSite=Strict` cookies.
- Mandatory 2FA for staff **and** partners, enforced server-side, with a staff-operated recovery path.
- Per-request, per-resource authorization. Deny by default. Staff scope enforced in the API.
- Rate limiting on IP **and** account, with lockout — and **no account-enumeration oracle** in login
  or registration (a residual timing difference is documented honestly in
  `docs/auth-rate-limiting.md`, not claimed away).
- Every external input validated by schema at the boundary; unknown fields rejected.
- Parameterised queries throughout.
- CSP with a per-request nonce; `img-src` names its origins rather than allowing `https:`.
- Field-level encryption for TOTP secrets, with tested key rotation.
- Append-only audit log, enforced by trigger, surviving `TRUNCATE`.
- Errors to clients are codes; detail stays in server logs. **No PII in logs**, including
  notification failure reasons.
- Dependencies pinned and audited in `pnpm verify`. Currently zero known vulnerabilities.

**Known gaps:** no penetration test; no malware scanning; no WAF or DDoS protection (hosting-level);
no automated dependency-update pipeline.

**Honest statement, unchanged from rule 1:** no system can be proven unbreachable. What is claimed
is defence in depth, least privilege, no known vulnerability class shipped, and a blast radius that
is contained and detectable — with the caveat that _detectable_ currently depends on alerting that
does not exist yet.

---

## 6. Disaster recovery posture

**Currently: none.** This is the most serious gap in the document.

- No backups configured. No restore ever attempted. **RPO and RTO are both undefined**, which means
  unbounded.
- The database is the system of record for money. There is no second copy.

**Required, and specified:**

| Item                   | Target                                                     |
| ---------------------- | ---------------------------------------------------------- |
| Automated backups      | Every 6 h, 30-day retention                                |
| Point-in-time recovery | 7 days minimum                                             |
| **Restore drill**      | Quarterly, timed, into a scratch environment               |
| RPO                    | ≤ 15 min                                                   |
| RTO                    | ≤ 4 h                                                      |
| Off-region copy        | Required                                                   |
| Object storage         | Versioning + lifecycle rules                               |
| Redis                  | Only becomes a DR concern after BullMQ — see that document |

**A backup nobody has restored is a hypothesis, not a backup.** The drill is the deliverable.

---

## 7. Monitoring posture

**Produced today:** structured JSON logs with correlation ids; an access log; liveness and readiness
endpoints reporting database, Redis and media; job telemetry in `scheduled_job_runs`; notification
delivery in `notifications`.

**Built 2026-08-08:** `GET /internal/metrics` — every table-derived signal as a Prometheus gauge,
behind a bearer token that 404s when absent or wrong. 20 ms to collect, cached 10 s.

**Missing, and all of it outside this repository:** log shipping and search; a scraper; dashboards;
paging; external uptime checks. The rule file is written and ready to paste.

Full specification with thresholds in `docs/alerting.md`. **Sixteen signals, six of them paging.**

---

## 8. Infrastructure requirements

| Component          | Requirement                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| App servers        | ≥2 replicas per app behind a load balancer; **stateless already**                                |
| PostgreSQL         | 16+, connection pooling (pgBouncer, transaction mode), read replica planned                      |
| Redis              | Persistence off is acceptable _today_; **AOF + `noeviction` required before BullMQ**             |
| Object storage     | S3-compatible, `properties/` public-read, `identity/` private, versioned                         |
| CDN                | In front of media; `NEXT_PUBLIC_MEDIA_URL` must name it, and must equal `S3_PUBLIC_URL`'s origin |
| TLS                | Managed certificates, HSTS with preload                                                          |
| Secrets            | A secret manager. **No `.env` in any deployed image**                                            |
| Container registry | Images exist for all three apps                                                                  |
| Migrations         | Forward-only, run as a deploy step (`docs`, `S-7`)                                               |
| Env vars           | `.env.example` is the complete list. `MEDIA_REQUIRE_PUBLIC=true` in production                   |

---

## 9. Vendor requirements

| Vendor                                | Needed for      | Decision owner |
| ------------------------------------- | --------------- | -------------- |
| Cloud host                            | Everything      | Bashar         |
| SMTP (Postmark/SES/Resend)            | All email       | Bashar         |
| Payment gateway                       | Real payments   | Bashar + legal |
| Sanctions data                        | Legal screening | Compliance     |
| WhatsApp BSP                          | Second channel  | Bashar         |
| Error tracking (Sentry or equivalent) | Alerting        | Bashar         |
| Paging (PagerDuty/Opsgenie)           | On-call         | Bashar         |
| Penetration testing firm              | Sign-off        | Bashar         |

---

## 10. Legal and compliance dependencies

| Item                                            | Status                                                                                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sanctions screening against a live feed         | **Blocked** — vendor + compliance                                                                                                                |
| Data retention policy                           | **Missing.** Nothing is ever deleted; the audit log is append-only by design, which conflicts with erasure and needs a documented reconciliation |
| GDPR erasure procedure                          | **Missing**, and depends on the above                                                                                                            |
| Privacy policy, terms, cancellation policy copy | Legal                                                                                                                                            |
| PCI scope                                       | Depends on the gateway. Card data never touches our servers today, which should keep scope to SAQ-A — **confirm with the gateway**               |
| Syrian regulatory requirements                  | Unassessed                                                                                                                                       |
| Cross-border data transfer                      | Depends on region — a decision that follows `M-1`                                                                                                |

---

## 11. The shortest path to launch

1. **Choose the deployment target.** Unblocks risks 1, 2, 3 and 6.
2. Provision, deploy, verify TLS/HSTS/CSP.
3. Backups **and a restore drill**.
4. Point a scraper at `/internal/metrics`, load the rule file, arm an on-call rota.
5. ~~Write the data generator~~ (done 2026-08-12); ~~run the scenarios that do not need
   infrastructure~~ (done 2026-08-20, 12 of 15 defects fixed); **run the capacity test on the
   provisioned environment and fix what it finds.**
6. Activate the sanctions feed.
7. Payment gateway with a reconciled test transaction.
8. Penetration test.
9. Retention policy and erasure procedure.
10. Malware scanning; BullMQ phases 1–2.

Steps 1–8 are the launch. 9 and 10 can follow, with the risk stated in writing.
