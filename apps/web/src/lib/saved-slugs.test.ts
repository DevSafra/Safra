import { afterEach, describe, expect, it, vi } from 'vitest';

import { FAVOURITE_STATUS_BATCH } from '@safra/contracts';

import { savedSlugs } from './api';

/*
  savedSlugs now forwards the visitor's address (lib/visitor.ts), which reads the incoming request's
  headers. Outside a Next request there are none, so a test supplies an empty set, as the app always
  calls this inside one.
*/
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));

/*
  The full map asks which of up to 250 stays the reader saved, and the API refuses more than
  FAVOURITE_STATUS_BATCH in one request. One request naming all 250 would be refused whole, and every
  heart on the map would be drawn empty.
*/
describe('which stays the reader saved', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks in batches the API accepts, and answers for all of them', async () => {
    const asked: number[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: URL | string) => {
        const slugs = new URL(String(input)).searchParams.getAll('slugs');
        asked.push(slugs.length);
        /* The reader saved every tenth stay. */
        const saved = slugs.filter((slug) => Number(slug.slice(5)) % 10 === 0);
        return Promise.resolve(new Response(JSON.stringify({ saved }), { status: 200 }));
      }),
    );

    const slugs = Array.from({ length: 130 }, (_, i) => `stay-${i}`);
    const saved = await savedSlugs('token', slugs);

    expect(asked.every((n) => n <= FAVOURITE_STATUS_BATCH)).toBe(true);
    expect(asked.reduce((a, b) => a + b, 0)).toBe(130);
    expect(saved.size).toBe(13);
    expect(saved.has('stay-120')).toBe(true);
  });
});
