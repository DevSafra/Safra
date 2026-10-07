import { describe, expect, it } from 'vitest';

import {
  SHOW_MORE_CEILING,
  SHOW_MORE_STEP,
  readShown,
  showMoreQuery,
  shownCount,
} from './show-more.js';

/** A list of `total` rows behind a keyset cursor, recording every request made of it. */
function listOf(total: number) {
  const rows = Array.from({ length: total }, (_, index) => index);
  const requests: { limit: number; cursor: string | undefined }[] = [];

  const fetchPage = (limit: number, cursor: string | undefined) => {
    requests.push({ limit, cursor });

    const start = cursor === undefined ? 0 : Number(cursor);
    const items = rows.slice(start, start + limit);
    const next = start + limit < total ? String(start + limit) : null;

    return Promise.resolve({ items, nextCursor: next });
  };

  return { fetchPage, requests };
}

describe('shownCount', () => {
  it.each([
    [undefined, SHOW_MORE_STEP],
    ['', SHOW_MORE_STEP],
    ['abc', SHOW_MORE_STEP],
    ['0', SHOW_MORE_STEP],
    ['-30', SHOW_MORE_STEP],
    ['15', 15],
    ['16', 30],
    ['30', 30],
    ['5000', SHOW_MORE_CEILING],
    [['45', '90'], 45],
  ])('reads %j as %i rows', (raw, expected) => {
    expect(shownCount(raw)).toBe(expected);
  });
});

describe('readShown', () => {
  it('reads one screenful and keeps the cursor after it', async () => {
    const { fetchPage } = listOf(40);
    const page = await readShown(fetchPage, 15, undefined);

    expect(page).toMatchObject({ nextCursor: '15' });
    expect((page as { items: number[] }).items).toEqual([...Array(15).keys()]);
  });

  it('ends the list exactly at its last row, with nothing more to offer', async () => {
    const { fetchPage } = listOf(15);
    const page = await readShown(fetchPage, 15, undefined);

    expect((page as { items: number[] }).items).toHaveLength(15);
    expect(page).toMatchObject({ nextCursor: null });
  });

  it('reads a long window in chunks under the endpoint ceiling, in order, without gaps', async () => {
    const { fetchPage, requests } = listOf(1000);
    const page = await readShown(fetchPage, SHOW_MORE_CEILING, undefined);

    expect((page as { items: number[] }).items).toEqual([
      ...Array(SHOW_MORE_CEILING).keys(),
    ]);
    expect(requests.every((request) => request.limit <= 100)).toBe(true);
    expect(requests).toHaveLength(Math.ceil(SHOW_MORE_CEILING / 90));
  });

  it('starts from the cursor it is given', async () => {
    const { fetchPage } = listOf(400);
    const page = await readShown(fetchPage, 15, '300');

    expect((page as { items: number[] }).items[0]).toBe(300);
  });

  it('returns a failure on any chunk as itself, never as a shorter list', async () => {
    let calls = 0;
    const page = await readShown(
      (limit: number) => {
        calls += 1;

        return Promise.resolve(
          calls === 1
            ? { items: Array(limit).fill(0), nextCursor: 'x' }
            : ('failed' as const),
        );
      },
      SHOW_MORE_CEILING,
      undefined,
    );

    expect(page).toBe('failed');
  });

  it('answers an empty list as an empty list', async () => {
    const { fetchPage } = listOf(0);

    expect(await readShown(fetchPage, 15, undefined)).toEqual({
      items: [],
      nextCursor: null,
    });
  });
});

describe('showMoreQuery', () => {
  it('offers nothing once the list has ended', () => {
    expect(showMoreQuery({ cursor: undefined, shown: 15, nextCursor: null })).toBeNull();
  });

  it('grows the same window by one step', () => {
    expect(showMoreQuery({ cursor: undefined, shown: 15, nextCursor: 'c' })).toBe(
      'shown=30',
    );
    expect(showMoreQuery({ cursor: 'w', shown: 30, nextCursor: 'c' })).toBe(
      'cursor=w&shown=45',
    );
  });

  it('moves the window forward at the ceiling instead of growing past it', () => {
    expect(
      showMoreQuery({ cursor: undefined, shown: SHOW_MORE_CEILING, nextCursor: 'c' }),
    ).toBe('cursor=c');
  });
});
