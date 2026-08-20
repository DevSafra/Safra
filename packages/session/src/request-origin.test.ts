import { describe, expect, it } from 'vitest';

import { isSameOrigin, seeOther } from './request-origin.js';

/**
 * The guard that answered 403 to everybody, and the redirect that pointed at `0.0.0.0`.
 *
 * Both were one root cause: `request.url` on the `output: 'standalone'` runtime — the runtime the
 * container images actually run — carries the address the server is BOUND to rather than the host
 * the browser asked for. Under `next start` it binds to `localhost` and the two agree, which is why
 * every test and every local check passed while the containerised behaviour was broken.
 *
 * Measured against the standalone server on 2026-08-20: the customer app's currency switcher
 * answered **403 with a correct same-origin `Origin` header** and 303 with the header removed, and
 * every POST-then-redirect sent the browser to `http://0.0.0.0:PORT/…`.
 */
describe('isSameOrigin', () => {
  const request = (headers: Record<string, string>): Request =>
    new Request('http://0.0.0.0:3000/ar/currency', { method: 'POST', headers });

  /**
   * The case that was broken, expressed as the bug.
   *
   * The URL the Request carries is `0.0.0.0` on purpose — that is what the standalone server hands
   * the route. What matters is the HEADERS, and they say `localhost:3000` both sides.
   */
  it('accepts a same-origin POST even when the server is bound elsewhere', () => {
    expect(
      isSameOrigin(request({ origin: 'http://localhost:3000', host: 'localhost:3000' })),
    ).toBe(true);
  });

  it('accepts a same-origin POST behind a proxy that rewrote the host', () => {
    expect(
      isSameOrigin(request({ origin: 'https://safra.example', host: 'safra.example' })),
    ).toBe(true);
  });

  it('refuses a genuine cross-site POST', () => {
    expect(
      isSameOrigin(request({ origin: 'https://evil.example', host: 'safra.example' })),
    ).toBe(false);
  });

  /** Same host, different port, is a different origin — and the host header carries the port. */
  it('refuses a different port on the same name', () => {
    expect(
      isSameOrigin(request({ origin: 'http://localhost:4000', host: 'localhost:3000' })),
    ).toBe(false);
  });

  /**
   * Absence is accepted, and the reason is in the helper's own comment: browsers send `Origin` on
   * every cross-origin POST, so a missing one is not evidence of a cross-site request. Refusing it
   * would break curl and health checks for nothing.
   */
  it('accepts a request with no Origin header at all', () => {
    expect(isSameOrigin(request({ host: 'localhost:3000' }))).toBe(true);
  });

  /** An Origin with no Host to compare it against cannot be shown to be same-origin. */
  it('refuses when there is an Origin but no Host', () => {
    expect(isSameOrigin(request({ origin: 'http://localhost:3000' }))).toBe(false);
  });

  it('refuses an unparseable Origin rather than throwing', () => {
    expect(isSameOrigin(request({ origin: 'not a url', host: 'localhost:3000' }))).toBe(
      false,
    );
  });
});

describe('seeOther', () => {
  it('answers 303 with the path exactly as given', () => {
    const response = seeOther('/bookings?size=10');

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/bookings?size=10');
  });

  /**
   * The property that fixes the bug: no host anywhere in the header.
   *
   * A relative Location is resolved by the browser against the URL it already asked for, so there is
   * no server-side notion of "where am I" to get wrong — and no absolute URL for an open redirect to
   * hide inside.
   */
  it('never names a host', () => {
    const location = seeOther('/partners?queuePage=2').headers.get('location') ?? '';

    expect(location.startsWith('/')).toBe(true);
    expect(location).not.toContain('://');
    expect(location).not.toContain('0.0.0.0');
  });

  it('carries through headers a caller already set', () => {
    const headers = new Headers({ 'set-cookie': 'safra-theme=dark; Path=/' });
    const response = seeOther('/', { headers });

    expect(response.headers.get('set-cookie')).toBe('safra-theme=dark; Path=/');
    expect(response.headers.get('location')).toBe('/');
  });
});
