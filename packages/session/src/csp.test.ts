import { describe, expect, it } from 'vitest';

import { buildCsp, cspHeaders, createNonce, mediaOrigins } from './csp.js';

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

/**
 * The regression: a policy that forgot where the photographs come from.
 *
 * The partner portal shipped `img-src 'self' data: blob:` and could not display a single listing
 * photograph. Every layer reported success — the upload, the store, the URL — and the browser
 * silently refused to fetch it, which appears in no server log.
 */
describe('mediaOrigins', () => {
  it('reduces a media base to the origin a CSP can name', () => {
    expect(mediaOrigins(['https://media.safra.com/properties'])).toEqual([
      'https://media.safra.com',
    ]);
  });

  it('keeps the port, because an origin with a different port is a different origin', () => {
    expect(mediaOrigins(['http://localhost:9000/safra-media'])).toEqual([
      'http://localhost:9000',
    ]);
  });

  it('collapses two bases that share an origin', () => {
    expect(
      mediaOrigins(['https://media.safra.com/a', 'https://media.safra.com/b']),
    ).toEqual(['https://media.safra.com']);
  });

  it('ignores what is not configured', () => {
    expect(mediaOrigins([undefined, ''])).toEqual([]);
  });

  /* A relative base is same-origin and already covered by `'self'`; throwing would 500 the app. */
  it('skips a base that is not absolute rather than throwing', () => {
    expect(() => mediaOrigins(['/api/v1/media'])).not.toThrow();
    expect(mediaOrigins(['/api/v1/media'])).toEqual([]);
  });

  it('produces a policy that actually names the media host', () => {
    const csp = buildCsp({
      nonce: 'n',
      imgSrc: ["'self'", 'data:', ...mediaOrigins(['https://media.safra.com/x'])].join(
        ' ',
      ),
      upgradeInsecure: false,
    });

    expect(csp).toContain("img-src 'self' data: https://media.safra.com");
    /* And does NOT fall back to permitting the whole internet. */
    expect(csp).not.toContain('img-src https:');
  });
});
