import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { partnerFetch } from './api';
import { proxy } from './proxy';
import { visitorHeaders } from './visitor';

/**
 * The partner portal's server-side calls, on the signed-in person's rate limit (2026-10-06).
 *
 * Without the visitor's address everybody using one instance shared one bucket at the API, so one
 * busy colleague could spend everyone's. The API's half is
 * `apps/api/src/common/http/internal-caller.test.ts`.
 */
let incoming = new Headers();

vi.mock('next/headers', () => ({ headers: () => Promise.resolve(incoming) }));
vi.mock('./session-server', () => ({
  getPartnerSession: () => Promise.resolve({ accessToken: 'access' }),
}));

const SECRET = 'k'.repeat(48);
const sent: Headers[] = [];

beforeEach(() => {
  incoming = new Headers({ 'x-forwarded-for': '6.6.6.6, 198.51.100.7' });
  sent.length = 0;
  vi.stubEnv('INTERNAL_CALLER_SECRET', SECRET);
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: unknown, init: RequestInit) => {
      sent.push(new Headers(init.headers));
      return Promise.resolve(Response.json({}));
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('visitorHeaders', () => {
  it('names the visitor the edge recorded, with the secret', async () => {
    expect(await visitorHeaders()).toEqual({
      'x-safra-internal-caller': SECRET,
      'x-safra-visitor-ip': '198.51.100.7',
    });
  });

  it('adds nothing when the secret is not configured, as in local development', async () => {
    vi.stubEnv('INTERNAL_CALLER_SECRET', '');

    expect(await visitorHeaders()).toEqual({});
  });
});

/* The two doors every page and every route handler here goes through to reach the API. */
describe.each([
  ['partnerFetch', () => partnerFetch('/probe', z.unknown())],
  ['proxy', () => proxy('/probe', { method: 'POST', body: { a: 1 } })],
])('%s', (_name, call) => {
  it('sends the visitor and keeps the token', async () => {
    await call();

    expect(sent[0]?.get('x-safra-visitor-ip')).toBe('198.51.100.7');
    expect(sent[0]?.get('authorization')).toBe('Bearer access');
  });
});
