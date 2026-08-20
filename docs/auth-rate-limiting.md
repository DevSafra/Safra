# Authentication rate limiting

The final design, and why each part is the way it is. Changed 2026-08-07 on Bashar's approval,
from IP-only throttling to IP + account.

---

## The three controls, and what each one is for

They are often confused because all three produce "you cannot try again". They defend against
different attacks and they fail in different ways.

| Control              | Keyed on            | Budget                                                                                    | Stops                                                 | Where                                                          |
| -------------------- | ------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------- |
| **Account throttle** | IP + SHA-256(email) | 10 / minute                                                                               | One person brute-forcing one account from one network | `app.module.ts`, `account-tracker.ts`                          |
| **IP ceiling**       | IP                  | 300 **failed sign-ins** / minute on `/auth/login`; 40 or tighter on the other auth routes | Credential stuffing: many accounts, one host          | `@Throttle` on each auth route, plus `SignInRefundInterceptor` |
| **Sign-in code**     | the user row        | 5 codes / 5 min, 5 guesses each, 10-minute life                                           | Signing in on a stolen PASSWORD alone — partners only | `login-code.service.ts`                                        |
| **Account lockout**  | the user row        | 5 failures → 15 minutes                                                                   | A **distributed** attack on one account               | `AuthService.registerFailedAttempt`                            |

The lockout is the one that does the heavy lifting against a targeted attack. It lives in the
database rather than in Redis, so it does not care how many addresses the attempts came from — a
botnet still hits it on the fifth guess per account. The two throttles bound REQUEST RATE; the
lockout bounds GUESSES.

**On `/auth/login` the IP ceiling bounds FAILURE rate, not request rate** — see "The IP ceiling
counts failures" below. That is the 2026-08-20 change, and it is the only place the three controls
above are not simply "requests per window".

---

## Why the key is IP **and** account

**The problem with IP alone.** Carrier-grade NAT puts thousands of Syrian subscribers behind one
address. At ten a minute per IP, one hotel's front desk retrying a typo consumed the budget for
every other SAFRA partner on that carrier — and the symptom on somebody else's _first_ attempt was
«محاولات كثيرة», which reads as the product being broken. This project's own test suite hit it
repeatedly and worked around it with a sixty-second wait.

**The problem with account alone.** It fixes the above and introduces something worse: anybody who
knows an email address could spend that account's budget from anywhere and keep the real owner
locked out. A targeted denial of service against one person's ability to sign in, available to a
stranger who knows nothing but their address.

**IP + account** gives each (person, network) pair its own budget. One NAT user cannot starve
another; a stranger cannot starve anybody.

**The email is hashed into the key.** Redis keys appear in `MONITOR` output, in slow-log entries
and in whatever a hosting provider captures. An address is personal data (§14, GDPR) and the
counter has no use for a readable one — a truncated SHA-256 distinguishes accounts just as well.

**Normalised first.** `Bob@x.com` and `bob@x.com` share a bucket, or an attacker varies the case
and gets a fresh budget per spelling.

---

## Why the IP ceiling went UP, and why that is safe

From 10/min to 40/min on auth routes. Forty is loose enough that a NAT'd office of partners signing
in at the start of a shift is unaffected, and tight enough that cycling accounts from one host is
bounded — which is the shape of a stuffing run.

It is safe because the account dimension now carries the per-person limit that the IP number used
to carry alone. Before the change, one number did both jobs and did neither well.

---

## Account enumeration: what changed, and what was fixed

**This is the part that needed work rather than assertion.**

Raising the IP ceiling made an existing oracle roughly four times faster from a single host:

1. Five wrong guesses lock a **real** account. An address that was never registered never locks —
   `registerFailedAttempt` is only reached when a user row exists.
2. A locked account used to answer `auth.locked`, while an unregistered address answered the
   generic `auth.credentials_invalid`.
3. So six requests confirmed anybody's registration, at the cost of denying them service. At 10
   requests/minute/IP that was ~1.6 accounts a minute from one host; at 40 it would have been ~6,
   and at today's 300 it would be ~50.

**Fixed by checking the password BEFORE the lock.** `auth.locked` is still returned — a person who
cannot get in has to be told to wait rather than left retyping — but only to a caller who has
proved they know the password, which is exactly the legitimate user. Somebody guessing sees the
generic message whether the account is locked, unregistered or suspended.

Verified against the running API: a locked real account and an address that was never registered
both answer `401 auth.credentials_invalid`, indistinguishably.

**Net position:** enumeration risk is **lower** than before the change, not merely unchanged.

### And the registration oracle, closed 2026-08-08

`POST /auth/register` answered `409 auth.email_taken` for an address that was already registered.
That was the cheaper of the two oracles: one request, no side effects, a definitive answer — where
the lockout one cost five requests and denied somebody service.

It now answers `202 { ok: true }` for every address. The difference moves into the inbox, which is
reachable only by the owner: a new address gets a verification link, a taken one gets "you already
have an account, here is how to sign in or reset". Nothing about the existing account changes, so a
stranger triggering it is harmless.

**The cost, accepted deliberately:** registration no longer signs the customer in. It could not —
an identical response for a taken address would mean issuing a session for an account the caller
may not own. Both paths end at "check your email".

**Verified over real HTTP**, three samples of each, interleaved:

| Channel      | Taken address | New address   |
| ------------ | ------------- | ------------- |
| Status       | `202`         | `202`         |
| Body         | `{"ok":true}` | `{"ok":true}` |
| `Set-Cookie` | none          | none          |
| Median time  | 35 ms         | 52 ms         |

**The residual: timing, at a ratio of ~1.5.** The new path does four inserts the taken path does
not. This is a far weaker signal than the old status code — extracting it needs many samples and
a stable network path, where the old one needed a single request — but it is not zero, and it is
worth naming rather than claiming perfection.

What bounds it: the rate limits (ten a minute per IP+account, forty per IP) make sample collection
expensive, and every attempt against a taken address writes an `auth.register_existing_email` audit
row, so a campaign is visible to whoever reads the log even though it was invisible to whoever ran
it. Real-world network jitter is comparable to the 17 ms difference.

What would close it fully: constant-time responses — performing equivalent writes on both paths, or
deferring account creation to a queued job so the endpoint's work is identical either way. Both add
latency and complexity to a path that is otherwise simple, and neither is worth it until there is
evidence anybody is measuring. Recorded here so the trade is visible rather than forgotten.

The password is hashed on BOTH paths, always — Argon2id dominates the endpoint, and hashing only
when creating would have made the ratio roughly ten rather than 1.5. That is asserted directly by a
spy as well as by the clock, because a stopwatch test alone would pass on a fast machine if
somebody later moved the hash back inside the create branch.

---

## Confirmations

- **Lockout intact.** Five failures still lock for fifteen minutes; a locked account still refuses
  the correct password; a success still clears the counter. Seven integration tests in
  `account-lockout.integration.test.ts`, which is new — the behaviour had none.
- **Enumeration risk reduced.** The lockout oracle is closed, asserted as an equality between a
  locked real account and an unregistered address rather than as "returns X".
- **Shared networks no longer penalised.** Asserted end to end in `auth-throttle.spec.ts`: account
  A is refused at its eleventh attempt while account B **on the same address** is still served.
- **Stuffing still bounded.** Same file: 300 different accounts from one address are all refused as
  wrong passwords, and the 301st is refused as too many requests.
- **A success costs the address nothing.** Same file, and asserted through `X-RateLimit-Remaining`
  so it is the real counter being read: one failure, three successful sign-ins, and the address has
  been charged twice rather than five times.

---

## The IP ceiling counts failures (2026-08-20, `O-sec-3`)

**What was measured.** Scenario 4 of the load test put a legitimate customer with correct
credentials on the same egress address as a credential-stuffing run, pacing themselves well inside
their own per-account allowance. They signed in **0 times out of 30**. The per-IP ceiling is shared
by everybody behind one address, and carrier-grade NAT puts thousands of Syrian subscribers behind
one.

**Two changes, and neither works without the other.**

1. **A successful sign-in no longer spends the ceiling.** `SignInRefundInterceptor` gives the
   per-IP hit back when the sign-in succeeds — or when the password was right and only the second
   factor is outstanding, which is half of every staff sign-in. So the ceiling stopped being a
   request limit and became a budget for FAILED sign-ins, and legitimate traffic no longer touches
   it at all. That alone fixes the case that moved this limit from 10 to 40 in the first place: a
   NAT'd office signing in at the start of a shift.
2. **The budget went from 40 to 300** (Bashar, 2026-08-20). Counting only failures does not on its
   own help the customer in that measurement, because an attacker's traffic IS failures. Forty a
   minute is 0.67 a second, so an attacker at one request a second — unremarkable in any log —
   exhausted it. At 300 they must sustain **five failed sign-ins a second** from one address.

**What it cost, stated rather than glossed.** A single address can now drive sixty accounts to
lockout a minute instead of eight. That is real. It is bounded by the fact that a DISTRIBUTED
attacker bypasses the per-IP ceiling entirely — measured: 40 of 40 accounts locked, zero 429s — so
this only slows the single-source case, which is also the one an edge rule blocks most easily.

**The refund cannot be used to mint budget.** It never creates a counter, never goes below zero,
never resets a TTL, never lifts a block, and never touches the `account` throttler. Held by 20
tests, five of which run the real guard and the real Redis storage together — a key that drifted by
one character would refund nothing and report success.

**The residual, and where it belongs.** A limiter keyed on an address that strangers share cannot
be both low enough to bound guessing and high enough to protect a bystander. An attacker willing to
be loud can still starve an address. The answer to that is rate limiting at the EDGE — a WAF or CDN
rule on `POST /auth/login` — which is hosting work under `M-1`, not application work.

---

## What this does NOT protect against

Stated so nobody assumes otherwise:

- **A distributed attack under the per-account budget.** Ten a minute per network × many networks
  is a lot of guesses. The account lockout is what stops it, on the fifth guess, and that is the
  control to reason about — not the throttle.
- **A stolen valid credential.** Rate limiting is irrelevant; 2FA is the control (mandatory for
  staff and partners).
- **Anything once the request is authenticated.** These limits are on the auth routes only; the
  global 120/minute floor applies elsewhere.

## Operational notes

Counters live in Redis (`RedisThrottlerStorage`) and are shared across replicas — with the default
in-memory store the effective limit was N × the configured one and every counter reset on deploy.

Redis being unavailable **fails OPEN** — the request is allowed and an error is logged. This
paragraph said the opposite until 2026-08-20 and was wrong: `RedisThrottlerStorage.increment`
catches, logs `Rate limiting is DEGRADED`, and returns `isBlocked: false`, so a Redis outage
removes the throttling rather than stopping sign-ins. That is a deliberate
availability-over-enforcement trade, argued in the class note, and it is why signal 11 in
`docs/alerting.md` treats `redis: degraded` as a security control being off. Worth an alert once
**S-1** lands.

The REFUND fails the other way — closed. If Redis is unreachable the hit simply stays counted,
because failing open there would hand back budget that was never spent.
