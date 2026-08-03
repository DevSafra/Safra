import { describe, expect, it } from 'vitest';

import { buildCsp, cspHeaders, createNonce } from './csp.js';

/**
 * Content-Security-Policy construction.
 *
 * The policy this replaced was `script-src 'self'` with one hash, and it blocked every
 * inline script Next.js emits for hydration — 18 on the customer home page, 4 on the
 * staff sign-in page with none allowed. The pages still returned `200`, because the HTML
 * is server-rendered, so nothing that asserted a status code could see it. In a browser
 * nothing worked.
 *
 * These tests pin the properties whose absence caused that, and whose absence would
 * cause it again: a nonce must be present, unique, and unguessable, and the policy must
 * carry `strict-dynamic` so Next's chunk loading is trusted transitively.
 */
describe('buildCsp', () => {
  const policy = (overrides: Partial<Parameters<typeof buildCsp>[0]> = {}) =>
    buildCsp({
      nonce: 'test-nonce-value',
      imgSrc: "'self' data:",
      upgradeInsecure: false,
      ...overrides,
    });

  it('admits inline scripts by nonce', () => {
    expect(policy()).toContain("'nonce-test-nonce-value'");
  });

  /**
   * Without `strict-dynamic` the nonce'd bootstrap runs and then everything it loads is
   * blocked — the same failure one step further along, and harder to recognise.
   */
  it('trusts scripts loaded by a nonced script', () => {
    expect(policy()).toContain("'strict-dynamic'");
  });

  /**
   * The whole point. `unsafe-inline` would allow ALL inline script in order to permit
   * Next's, which is precisely the protection CSP exists to give up last. Note that
   * browsers ignore `unsafe-inline` when a nonce is present, so this would be worse than
   * useless — it would be misleading.
   */
  it('never allows arbitrary inline script', () => {
    expect(policy()).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });

  it('never allows eval', () => {
    expect(policy()).not.toContain("'unsafe-eval'");
  });

  describe('the rest of the policy', () => {
    it('takes img-src from the caller, because the two apps differ', () => {
      expect(policy({ imgSrc: "'self' https:" })).toContain("img-src 'self' https:");
      expect(policy({ imgSrc: "'self' data: blob:" })).toContain(
        "img-src 'self' data: blob:",
      );
    });

    it('forbids framing, foreign form targets, and plugins', () => {
      const p = policy();

      expect(p).toContain("frame-ancestors 'none'");
      expect(p).toContain("form-action 'self'");
      expect(p).toContain("base-uri 'none'");
      expect(p).toContain("object-src 'none'");
    });

    /** Only in production: it would break a plain-http local environment. */
    it('upgrades insecure requests only when asked', () => {
      expect(policy({ upgradeInsecure: true })).toContain('upgrade-insecure-requests');
      expect(policy({ upgradeInsecure: false })).not.toContain(
        'upgrade-insecure-requests',
      );
    });

    /** Styles are the documented exception — Next injects critical CSS inline. */
    it('allows inline style, and says so only for style', () => {
      expect(policy()).toContain("style-src 'self' 'unsafe-inline'");
    });
  });
});

describe('createNonce', () => {
  /** A repeated nonce can be named by an injected script and would then be trusted. */
  it('never repeats', () => {
    const nonces = new Set(Array.from({ length: 500 }, () => createNonce()));

    expect(nonces.size).toBe(500);
  });

  it('carries at least 128 bits of entropy', () => {
    // 16 random bytes, base64 — 24 characters including padding.
    expect(createNonce()).toHaveLength(24);
  });

  it('is base64, so it needs no escaping inside the header', () => {
    expect(createNonce()).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });
});

describe('cspHeaders', () => {
  /**
   * BOTH halves are required, and the request half is the one that gets forgotten.
   * Next reads the nonce out of the request header to stamp its own script tags; omit it
   * and the browser enforces a policy against scripts that carry no nonce — which is
   * exactly the failure this whole module exists to fix.
   */
  it('sets the policy on the request as well as the response', () => {
    const { request, response } = cspHeaders('default-src ‘self’');

    expect(request['content-security-policy']).toBe('default-src ‘self’');
    expect(response['content-security-policy']).toBe('default-src ‘self’');
  });
});
