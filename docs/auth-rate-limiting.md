# Authentication rate limiting

The final design, and why each part is the way it is. Changed 2026-08-07 on Bashar's approval,
from IP-only throttling to IP + account.

---

## The three controls, and what each one is for

They are often confused because all three produce "you cannot try again". They defend against
different attacks and they fail in different ways.

| Control              | Keyed on            | Budget                     | Stops                                                 | Where                                 |
| -------------------- | ------------------- | -------------------------- | ----------------------------------------------------- | ------------------------------------- |
| **Account throttle** | IP + SHA-256(email) | 10 / minute                | One person brute-forcing one account from one network | `app.module.ts`, `account-tracker.ts` |
| **IP ceiling**       | IP                  | 40 / minute on auth routes | Credential stuffing: many accounts, one host          | `@Throttle` on each auth route        |
| **Account lockout**  | the user row        | 5 failures → 15 minutes    | A **distributed** attack on one account               | `AuthService.registerFailedAttempt`   |

The lockout is the one that does the heavy lifting against a targeted attack. It lives in the
database rather than in Redis, so it does not care how many addresses the attempts came from — a
botnet still hits it on the fifth guess per account. The two throttles bound REQUEST RATE; the
lockout bounds GUESSES.

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
   requests/minute/IP that was ~1.6 accounts a minute from one host; at 40 it would have been ~6.

**Fixed by checking the password BEFORE the lock.** `auth.locked` is still returned — a person who
cannot get in has to be told to wait rather than left retyping — but only to a caller who has
proved they know the password, which is exactly the legitimate user. Somebody guessing sees the
generic message whether the account is locked, unregistered or suspended.

Verified against the running API: a locked real account and an address that was never registered
both answer `401 auth.credentials_invalid`, indistinguishably.

**Net position:** enumeration risk is **lower** than before the change, not merely unchanged.

---

## Confirmations

- **Lockout intact.** Five failures still lock for fifteen minutes; a locked account still refuses
  the correct password; a success still clears the counter. Seven integration tests in
  `account-lockout.integration.test.ts`, which is new — the behaviour had none.
- **Enumeration risk reduced.** The lockout oracle is closed, asserted as an equality between a
  locked real account and an unregistered address rather than as "returns X".
- **Shared networks no longer penalised.** Asserted end to end in `auth-throttle.spec.ts`: account
  A is refused at its eleventh attempt while account B **on the same address** is still served.
- **Stuffing still bounded.** Same file: 45 different accounts from one address stop at 40.

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

Redis being unavailable **fails closed to the request**, not open: the guard throws and the request
is refused. That is the correct direction for an auth endpoint, and it means a Redis outage stops
sign-ins. Worth an alert once **S-1** lands.
