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
   * A stuffing run uses a different address every request, so every attempt lands in its own
   * account bucket and only the per-IP ceiling can stop it. Forty a minute: loose enough for a
   * NAT'd office signing in at the start of a shift, tight enough that this is bounded.
   */
  test('still stops credential stuffing across many accounts from one address', async ({
    request,
  }) => {
    const ip = `203.0.113.${(Date.now() % 200) + 20}`;
    const statuses: number[] = [];

    for (let i = 0; i < 45; i += 1) {
      const response = await request.post(`${API}/api/v1/auth/login`, {
        headers: { 'x-forwarded-for': ip },
        data: { email: `stuff-${RUN}-${i}@safra.test`, password: 'x' },
        failOnStatusCode: false,
      });

      statuses.push(response.status());
    }

    const blocked = statuses.indexOf(429);

    expect(blocked).toBeGreaterThan(0);
    expect(blocked).toBeLessThanOrEqual(40);
  });
});
