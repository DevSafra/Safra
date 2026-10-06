import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { callAuth, callLogout, forwardedHeaders } from './auth-api.js';
import {
  INTERNAL_CALLER_HEADER,
  VISITOR_ADDRESS_HEADER,
  internalCallerHeaders,
  visitorAddress,
} from './internal-caller.js';

/**
 * What the three sites tell the API about the visitor a server-side call is for.
 *
 * The API's half — that the claim is honoured only with the secret, and buckets per address — is
 * `apps/api/src/common/http/internal-caller.test.ts`, which drives its middleware with this builder.
 */
const SECRET = 'k'.repeat(48);

function incoming(forwardedFor?: string): Headers {
  return new Headers(
    forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor },
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('visitorAddress', () => {
  /*
    The edge APPENDS, so the right-hand entry is the one it vouches for and everything to its left
    is whatever the client sent. Reading the left-hand one would let a visitor pick their bucket.
  */
  it('takes the address the edge appended, not one the client prepended', () => {
    expect(visitorAddress(incoming('6.6.6.6, 198.51.100.7'))).toBe('198.51.100.7');
  });

  it('reads a single entry and an IPv6 address', () => {
    expect(visitorAddress(incoming('198.51.100.7'))).toBe('198.51.100.7');
    expect(visitorAddress(incoming('2001:db8::1'))).toBe('2001:db8::1');
  });

  it('answers nothing when there is no header, or nothing in it that is an address', () => {
    expect(visitorAddress(incoming())).toBeNull();
    expect(visitorAddress(incoming(' , '))).toBeNull();
    expect(visitorAddress(incoming('198.51.100.7, unknown'))).toBeNull();
  });
});

describe('internalCallerHeaders', () => {
  beforeEach(() => {
    vi.stubEnv('INTERNAL_CALLER_SECRET', SECRET);
  });

  it('carries the visitor address and the secret', () => {
    expect(internalCallerHeaders(incoming('6.6.6.6, 198.51.100.7'))).toEqual({
      [INTERNAL_CALLER_HEADER]: SECRET,
      [VISITOR_ADDRESS_HEADER]: '198.51.100.7',
    });
  });

  /* Local development: no variable, no headers, and the API behaves exactly as it always did. */
  it('sends nothing when the secret is not configured', () => {
    vi.stubEnv('INTERNAL_CALLER_SECRET', '');

    expect(internalCallerHeaders(incoming('198.51.100.7'))).toEqual({});
  });

  /* No address means no claim — the secret alone is never sent, so it vouches for nothing. */
  it('sends nothing when there is no visitor address to vouch for', () => {
    expect(internalCallerHeaders(incoming())).toEqual({});
  });

  it('accepts a page’s read-only headers as well as a request’s', () => {
    const readOnly = {
      get: (name: string) => (name === 'x-forwarded-for' ? '192.0.2.4' : null),
    };

    expect(internalCallerHeaders(readOnly)[VISITOR_ADDRESS_HEADER]).toBe('192.0.2.4');
  });
});

/*
  The shared callers. Every one of them is a route a visitor can drive repeatedly — sign-in, refresh,
  sign-out — and every one of them was on the web server's bucket.
*/
describe('the session package’s own API callers', () => {
  const sent: Headers[] = [];

  beforeEach(() => {
    sent.length = 0;
    vi.stubEnv('INTERNAL_CALLER_SECRET', SECRET);
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        sent.push(new Headers(init.headers));
        return Promise.resolve(new Response(null, { status: 401 }));
      }),
    );
  });

  it('forwardedHeaders adds the vouched address beside the raw chain', () => {
    const request = new Request('http://site.test/x', {
      headers: { 'x-forwarded-for': '6.6.6.6, 198.51.100.7', 'user-agent': 'Probe' },
    });

    expect(forwardedHeaders(request)).toMatchObject({
      'x-forwarded-for': '6.6.6.6, 198.51.100.7',
      'user-agent': 'Probe',
      [INTERNAL_CALLER_HEADER]: SECRET,
      [VISITOR_ADDRESS_HEADER]: '198.51.100.7',
    });
  });

  it('callAuth sends what the middleware gives it for a refresh', async () => {
    await callAuth('/auth/refresh', {
      refreshToken: 'token',
      headers: internalCallerHeaders(incoming('198.51.100.7')),
    });

    expect(sent[0]?.get(VISITOR_ADDRESS_HEADER)).toBe('198.51.100.7');
    expect(sent[0]?.get(INTERNAL_CALLER_HEADER)).toBe(SECRET);
  });

  it('callLogout sends them too, beside the refresh cookie', async () => {
    await callLogout('token', internalCallerHeaders(incoming('198.51.100.7')));

    expect(sent[0]?.get(VISITOR_ADDRESS_HEADER)).toBe('198.51.100.7');
    expect(sent[0]?.get('cookie')).toBe('safra_refresh=token');
  });
});
