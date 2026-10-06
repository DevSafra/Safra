import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { searchForDisplay, search } from './api';
import { visitorHeaders } from './visitor';

/**
 * The customer site's server-side calls, on the visitor's rate limit (2026-10-06).
 *
 * Without the visitor's address every customer of one web instance shared one bucket at the API, and
 * a busy minute left checkout reading «غير متاح». The API's half is
 * `apps/api/src/common/http/internal-caller.test.ts`.
 */
let incoming = new Headers();

vi.mock('next/headers', () => ({ headers: () => Promise.resolve(incoming) }));

const SECRET = 'k'.repeat(48);
const STAY = { checkIn: '2026-11-01', checkOut: '2026-11-03', adults: 2 };
const sent: Headers[] = [];

beforeEach(() => {
  incoming = new Headers({ 'x-forwarded-for': '6.6.6.6, 198.51.100.7' });
  sent.length = 0;
  vi.stubEnv('INTERNAL_CALLER_SECRET', SECRET);
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: unknown, init: RequestInit) => {
      sent.push(new Headers(init.headers));
      return Promise.resolve(Response.json({ items: [], nextCursor: null }));
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

describe('the page data client', () => {
  /* A live search is one visitor's question, so it is counted against that visitor. */
  it('sends the visitor on an uncached call', async () => {
    await search(STAY).catch(() => undefined);

    expect(sent[0]?.get('x-safra-visitor-ip')).toBe('198.51.100.7');
  });

  /*
    Next keys its data cache on the fetch's headers: the visitor's address on a cached call would
    give every visitor a private copy of the city teaser, and make the page dynamic besides.
  */
  it('sends nothing about the visitor on a cached call', async () => {
    await searchForDisplay(STAY).catch(() => undefined);

    expect(sent[0]?.has('x-safra-visitor-ip')).toBe(false);
    expect(sent[0]?.has('x-safra-internal-caller')).toBe(false);
  });
});
