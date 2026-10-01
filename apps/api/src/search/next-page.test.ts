import { describe, expect, it } from 'vitest';

import { MAX_SEARCH_OFFSET, nextPage } from './search.service.js';

const offsetOf = (cursor: string | null) =>
  cursor === null ? null : Number(Buffer.from(cursor, 'base64url').toString('utf8'));

/**
 * The ceiling a list that loads on scroll runs into (2026-10-01). Below it every batch hands out
 * the next cursor; at it the last addressable batch is still served; past it there is no cursor,
 * and the answer says the list was cut short so the page can ask the reader to narrow.
 */
describe('nextPage', () => {
  it('hands out the next cursor below the ceiling', () => {
    const page = nextPage(980, 20, true);
    expect(offsetOf(page.nextCursor)).toBe(1000);
    expect(page.truncated).toBe(false);
  });

  it('stops at the ceiling and says it was truncated', () => {
    expect(nextPage(MAX_SEARCH_OFFSET - 10, 20, true)).toEqual({
      nextCursor: null,
      truncated: true,
    });
  });

  it('reports a genuine end as complete, not truncated', () => {
    expect(nextPage(MAX_SEARCH_OFFSET - 10, 20, false)).toEqual({
      nextCursor: null,
      truncated: false,
    });
    expect(nextPage(0, 20, false)).toEqual({ nextCursor: null, truncated: false });
  });
});
