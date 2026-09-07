import { afterEach, describe, expect, it, vi } from 'vitest';

import { SettingsRevalidationService } from './settings-revalidation.service.js';
import type { Env } from '../config/env.js';

/**
 * The fan-out that makes a saved setting visible at once (Bashar, 2026-09-08).
 *
 * *"I would like configuration changes to become visible immediately after a settings update…
 * without requiring users to wait several minutes for caches to expire."*
 *
 * What is checked here is the shape of the request and, more importantly, the FAILURE behaviour:
 * this runs after a write that has already committed, so anything it does other than log must not
 * reach the caller. A fan-out that could throw would turn an unreachable front end into a failed
 * settings save — a worse outcome than the staleness it exists to remove.
 */
const SECRET = 'x'.repeat(40);

const env = (secret?: string) =>
  ({
    APP_URL: 'https://customer.test',
    ADMIN_URL: 'https://console.test',
    PARTNER_URL: 'https://partner.test',
    ...(secret ? { REVALIDATE_SECRET: secret } : {}),
  }) as unknown as Env;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('telling the front ends a setting changed', () => {
  it('posts to the customer app and the console, carrying the secret', async () => {
    const calls: { url: string; secret: string | null; method: string }[] = [];

    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      calls.push({
        url: String(url),
        secret: new Headers(init.headers).get('x-safra-revalidate'),
        method: init.method ?? 'GET',
      });

      return Promise.resolve(new Response('{}', { status: 200 }));
    });

    await new SettingsRevalidationService(env(SECRET)).revalidate(
      'commission.partner_rate',
    );

    expect(calls.map((c) => c.url)).toEqual([
      'https://customer.test/api/revalidate-settings',
      'https://console.test/api/revalidate-settings',
    ]);
    expect(calls.every((c) => c.method === 'POST')).toBe(true);
    expect(calls.every((c) => c.secret === SECRET)).toBe(true);
  });

  it('never asks the partner portal, which caches nothing', async () => {
    /*
      Not an omission and not an oversight — `partnerFetch` is `cache: 'no-store'` and the dashboard
      is `force-dynamic`, so there is nothing there to purge. Asserted rather than left to a comment
      because the tempting "fix" for a future bug is to add the third call, and a route in an app
      with nothing tagged is the capability-with-no-feature shape this codebase keeps finding.
    */
    const urls: string[] = [];

    vi.stubGlobal('fetch', (url: string) => {
      urls.push(String(url));
      return Promise.resolve(new Response('{}', { status: 200 }));
    });

    await new SettingsRevalidationService(env(SECRET)).revalidate(
      'partner.first_violation_fine',
    );

    expect(urls.some((u) => u.includes('partner.test'))).toBe(false);
  });

  it('makes no request at all when no secret is configured', async () => {
    /*
      Fail closed. An unconfigured deployment loses immediacy and keeps its TTL floor; what it must
      NOT do is post an empty secret, which the front end would refuse anyway and which would put a
      pointless request on every save.
    */
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await new SettingsRevalidationService(env()).revalidate('refund.minimum_percent');

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not throw when a front end is down', async () => {
    /*
      THE assertion of this file. The write has committed by the time this runs, so a rejected
      promise here would report a failed save for a change that is already in force — and an
      operator would press «حفظ» again, which is the one thing a settings screen must not invite.
    */
    vi.stubGlobal('fetch', () => Promise.reject(new Error('ECONNREFUSED')));

    await expect(
      new SettingsRevalidationService(env(SECRET)).revalidate(
        'booking.same_day_cutoff_enabled',
      ),
    ).resolves.toBeUndefined();
  });

  it('does not throw when a front end refuses the secret', async () => {
    /* The two sides disagreeing about the secret answers 404, and must not fail the save either. */
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}', { status: 404 })));

    await expect(
      new SettingsRevalidationService(env(SECRET)).revalidate(
        'commission.customer_fee_value',
      ),
    ).resolves.toBeUndefined();
  });
});
