import { expect, test } from '@playwright/test';

/**
 * Auth throttling, against the running API (2026-08-07).
 *
 * ## Why this is here rather than in the integration suite
 *
 * The behaviour under test is produced by three things acting together: the named throttlers in
 * `app.module.ts`, the tracker in `account-tracker.ts`, and the Redis-backed storage shared across
 * replicas. A test that constructs the guard by hand exercises none of the wiring — and the wiring
 * is what changed. These go through the real HTTP stack to the real counters.
 *
 * `accountTracker` has unit tests for the KEY; this asserts the CONSEQUENCE.
 *
 * ## It cannot disturb the rest of the suite
 *
 * Every request carries a synthetic `x-forwarded-for` and a synthetic address, so both the per-IP
 * and the per-account buckets are its own. Nothing here touches a real fixture account, and no
 * account is ever locked: the passwords are wrong, but each address is used at most a handful of
 * times and none of these accounts exists.
 */
const API = process.env['API_URL'] ?? 'http://localhost:4000';

/** Fresh per run, so a re-run inside the same minute does not inherit spent counters. */
const RUN = Date.now().toString(36);

/**
 * The one account in this file that really exists, and the only test here that signs in.
 *
 * `db:testbed` owns `customer@safra.test` and sets its password on every run — see the note in
 * `customer-review.spec.ts` about why this is NOT `DEV_CUSTOMER_PASSWORD`.
 */
const TESTBED_EMAIL = 'customer@safra.test';
/* Defaulted rather than skipped-on-absent: `db:testbed` uses this same fallback. */
const TESTBED_PASSWORD = process.env['TESTBED_PASSWORD'] ?? 'a-testbed-password-1';

test.describe('auth throttling', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  /**
   * THE reason the change was made.
   *
   * Carrier-grade NAT puts thousands of Syrian subscribers behind one address. Keyed on IP alone,
   * one hotel's front desk retrying a typo consumed the budget for every other partner on that
   * carrier — and the symptom was «محاولات كثيرة» on somebody else's FIRST attempt.
   */
  test('one account exhausting its budget does not starve another on the same address', async ({
    request,
  }) => {
    const ip = `198.51.100.${(Date.now() % 200) + 20}`;
    const attempt = (email: string) =>
      request.post(`${API}/api/v1/auth/login`, {
        headers: { 'x-forwarded-for': ip },
        data: { email, password: 'definitely-not-the-password' },
        failOnStatusCode: false,
      });

    const statuses: number[] = [];

    for (let i = 0; i < 11; i += 1) {
      statuses.push(
        (await attempt(`nat-a-${RUN}@safra.test`).then((r) => r.status())) ?? 0,
      );
    }

    // Ten a minute per (person, network); the eleventh is refused.
    expect(statuses.slice(0, 10).every((status) => status === 401)).toBe(true);
    expect(statuses[10]).toBe(429);

    // A DIFFERENT account behind the SAME address is unaffected. This is the whole change.
    const neighbour = await attempt(`nat-b-${RUN}@safra.test`);

    expect(neighbour.status()).toBe(401);
  });

  /**
   * And the protection that must survive it.
   *
   * A stuffing run uses a different account every request, so every attempt lands in its own
   * account bucket and only the per-IP ceiling can stop it.
   *
   * **Three hundred a minute since 2026-08-20** (`O-sec-3`), up from forty, because the ceiling
   * stopped counting successful sign-ins on the same day and forty FAILURES a minute is 0.67 a
   * second — low enough that an attacker at one request a second denied sign-in to everybody
   * behind a carrier-grade NAT address. Measured: 0 of 30 in scenario 4 of the load test.
   *
   * Sent in batches so the wall time is seconds rather than a minute; the counter is atomic, and
   * every batch is awaited before the next, so the boundary is still exact.
   */
  test('still stops credential stuffing across many accounts from one address', async ({
    request,
  }) => {
    test.setTimeout(120_000);

    const ip = `203.0.113.${(Date.now() % 200) + 20}`;
    const attempt = (i: number) =>
      request.post(`${API}/api/v1/auth/login`, {
        headers: { 'x-forwarded-for': ip },
        data: { email: `stuff-${RUN}-${i}@safra.test`, password: 'x' },
        failOnStatusCode: false,
      });

    const statuses: number[] = [];

    for (let batch = 0; batch < 15; batch += 1) {
      const responses = await Promise.all(
        Array.from({ length: 20 }, (_, i) => attempt(batch * 20 + i)),
      );

      statuses.push(...responses.map((response) => response.status()));
    }

    // Three hundred wrong passwords are refused as wrong passwords, not as too many requests.
    expect(statuses).toHaveLength(300);
    expect(statuses.every((status) => status === 401)).toBe(true);

    // The three hundred and first is where the ceiling is.
    expect((await attempt(300)).status()).toBe(429);
  });

  /**
   * THE change of 2026-08-20 (`O-sec-3`), asserted through the HTTP stack.
   *
   * A legitimate customer signing in must not spend the budget shared by everybody behind their
   * address. `X-RateLimit-Remaining` is the per-IP counter made observable — the guard sets it
   * BEFORE the handler runs, so the refund's effect shows up on the NEXT request rather than on
   * the successful one.
   *
   * Three successes and not more: the same account is still bounded to ten a minute per (IP,
   * account), which is the limiter that must NOT be refunded and is what keeps the password checks
   * one address can force finite.
   */
  test('a successful sign-in does not spend the address’s budget', async ({
    request,
  }) => {
    const ip = `198.51.100.${(Date.now() % 100) + 120}`;
    const post = (data: Record<string, string>) =>
      request.post(`${API}/api/v1/auth/login`, {
        headers: { 'x-forwarded-for': ip },
        data,
        failOnStatusCode: false,
      });

    const wrong = () => post({ email: `budget-${RUN}@safra.test`, password: 'nope' });
    const right = () => post({ email: TESTBED_EMAIL, password: TESTBED_PASSWORD });

    const remaining = (response: { headers: () => Record<string, string> }) =>
      Number(response.headers()['x-ratelimit-remaining']);

    const first = await wrong();

    // Pins the ceiling itself: a change to the number fails here rather than silently.
    expect(Number(first.headers()['x-ratelimit-limit'])).toBe(300);
    expect(remaining(first)).toBe(299);

    for (let i = 0; i < 3; i += 1) {
      expect((await right()).status()).toBe(200);
    }

    /*
      The refund is detached from the response on purpose — a customer must never wait on a Redis
      round trip to give a counter back, nor have their sign-in fail because one went wrong.
    */
    await new Promise((resolve) => setTimeout(resolve, 250));

    /*
      Two requests have now been charged to this address, not five. Without the refund this would
      be 294.
    */
    expect(remaining(await wrong())).toBe(298);
  });
});
