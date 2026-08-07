import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { accountOf, accountTracker, skipUnlessAccountNamed } from './account-tracker.js';

/**
 * The key an auth request is counted under.
 *
 * These assert the two properties the change of 2026-08-07 exists for, and the one it must not
 * break:
 *
 * - two people behind ONE address get separate budgets (the NAT problem);
 * - one person from two addresses gets separate budgets (so a stranger cannot starve them);
 * - the address itself never appears in the key (it is personal data, and Redis keys leak).
 */
const request = (body: unknown, ip = '1.2.3.4', forwarded?: string) =>
  ({
    ip,
    body,
    headers: forwarded ? { 'x-forwarded-for': forwarded } : {},
  }) as unknown as Record<string, unknown>;

describe('accountOf', () => {
  it('reads the email from the parsed body', () => {
    expect(accountOf(request({ email: 'a@safra.test' }))).toBe('a@safra.test');
  });

  /* Or an attacker varies the case and gets a fresh bucket per spelling. */
  it('normalises case and surrounding space', () => {
    expect(accountOf(request({ email: '  Bob@Safra.Test ' }))).toBe('bob@safra.test');
  });

  it('returns null when the body names no account', () => {
    expect(accountOf(request({ refreshToken: 'x' }))).toBeNull();
    expect(accountOf(request(null))).toBeNull();
    expect(accountOf(request({ email: 42 }))).toBeNull();
    expect(accountOf(request({ email: '   ' }))).toBeNull();
  });
});

describe('accountTracker', () => {
  /**
   * THE reason this change was made.
   *
   * Two partners behind one carrier-grade NAT address must not share a budget — one front desk
   * retrying a typo would otherwise lock out every other partner on that carrier, and the symptom
   * is «محاولات كثيرة» on a first attempt.
   */
  it('gives two accounts behind one address separate buckets', () => {
    const one = accountTracker(request({ email: 'one@safra.test' }, '5.5.5.5'));
    const two = accountTracker(request({ email: 'two@safra.test' }, '5.5.5.5'));

    expect(one).not.toBe(two);
  });

  /**
   * And the failure the obvious fix would have introduced.
   *
   * Keying on email ALONE would let anybody who knows an address spend that account's budget from
   * anywhere, keeping the real owner locked out — a targeted denial of service available to a
   * stranger. Including the IP means a stranger's attempts land in their own bucket.
   */
  it('gives one account on two networks separate buckets', () => {
    const home = accountTracker(request({ email: 'one@safra.test' }, '5.5.5.5'));
    const cafe = accountTracker(request({ email: 'one@safra.test' }, '9.9.9.9'));

    expect(home).not.toBe(cafe);
  });

  it('gives the same person on the same network one bucket', () => {
    const first = accountTracker(request({ email: 'one@safra.test' }, '5.5.5.5'));
    const second = accountTracker(request({ email: 'ONE@safra.test ' }, '5.5.5.5'));

    expect(first).toBe(second);
  });

  /*
    Redis keys turn up in MONITOR output, slow-query logs and whatever a host captures. An email
    address is personal data and the counter has no use for a readable one.
  */
  it('never puts the address itself in the key', () => {
    const key = accountTracker(request({ email: 'someone@safra.test' }, '5.5.5.5'));

    expect(key).not.toContain('someone');
    expect(key).not.toContain('safra.test');
    expect(key).toContain('5.5.5.5');
  });

  /** Behind a proxy the left-most forwarded entry is the client; the rest appended themselves. */
  it('uses the forwarded client address rather than the proxy', () => {
    const key = accountTracker(
      request({ email: 'a@safra.test' }, '10.0.0.1', '203.0.113.9, 10.0.0.5'),
    );

    expect(key).toContain('203.0.113.9');
    expect(key).not.toContain('10.0.0.1');
  });

  it('still produces a key when no account is named', () => {
    expect(accountTracker(request({}))).toContain('anonymous');
  });
});

describe('skipUnlessAccountNamed', () => {
  const context = (body: unknown) =>
    ({
      switchToHttp: () => ({ getRequest: () => request(body) }),
    }) as unknown as ExecutionContext;

  /*
    Keyed on the SHAPE of the request rather than a decorator: an endpoint whose body carries an
    email is an endpoint about one account, which is exactly the set that wants per-account
    throttling. A decorator would be one more thing to remember on the next auth route.
  */
  it('applies where the body names an account', () => {
    expect(skipUnlessAccountNamed(context({ email: 'a@safra.test' }))).toBe(false);
  });

  it('skips everywhere else, so ordinary endpoints keep the per-IP limit alone', () => {
    expect(skipUnlessAccountNamed(context({ q: 'damascus' }))).toBe(true);
    expect(skipUnlessAccountNamed(context(undefined))).toBe(true);
  });
});
