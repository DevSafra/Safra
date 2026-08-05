import { describe, expect, it } from 'vitest';

import { COUNT_CAP, offsetPage, pageQuerySchema } from './pagination.js';

/**
 * The page arithmetic, which is the whole of what `offsetPage` is for.
 *
 * Every registry in the console prints these three numbers under its table, and each one has a
 * failure mode that looks like data rather than like a bug: "من ٠" reads as an empty database,
 * a total that grows as you page reads as rows arriving, and an exact-looking capped total reads
 * as the truth. So they are pinned here rather than trusted.
 */
describe('offsetPage', () => {
  const query = (page: number, limit: number) => ({ page, limit });

  it('divides the total into pages', () => {
    expect(offsetPage([], 100, query(1, 25)).pages).toBe(4);
  });

  /** A partial last page is still a page. */
  it('rounds a partial page up', () => {
    expect(offsetPage([], 101, query(1, 25)).pages).toBe(5);
  });

  /**
   * An empty set is "صفحة ١ من ١", never "من ٠".
   *
   * Zero pages is arithmetically defensible and reads as a broken screen — the reader is looking
   * at page one either way, so that is what the bar has to say.
   */
  it('never reports fewer than one page', () => {
    const page = offsetPage([], 0, query(1, 25));

    expect(page.pages).toBe(1);
    expect(page.total).toBe(0);
    expect(page.capped).toBe(false);
  });

  it('echoes the requested page back', () => {
    expect(offsetPage([], 500, query(7, 10)).page).toBe(7);
  });

  it('passes the rows through untouched', () => {
    expect(offsetPage(['a', 'b'], 2, query(1, 25)).items).toStrictEqual(['a', 'b']);
  });

  /** The count is exact right up to the cap. */
  it('reports a total at the cap as exact', () => {
    const page = offsetPage([], COUNT_CAP, query(1, 25));

    expect(page.total).toBe(COUNT_CAP);
    expect(page.capped).toBe(false);
  });

  /**
   * One row past the cap is what "there are more" looks like arriving here.
   *
   * Services count over a `LIMIT COUNT_CAP + 1` subquery, so `COUNT_CAP + 1` is the only value
   * above the cap that can ever reach this function — and it means "at least this many", not
   * "exactly this many". The total is clamped back DOWN to the cap so no caller can print
   * `10001` as if it had been counted.
   */
  it('clamps a total past the cap and flags it', () => {
    const page = offsetPage([], COUNT_CAP + 1, query(1, 25));

    expect(page.total).toBe(COUNT_CAP);
    expect(page.capped).toBe(true);
  });

  /**
   * A capped set always has one more page than the reader is on.
   *
   * Otherwise the last page derived from the capped total would be the end of the walk, and a
   * reader on page 400 of a capped set would be told there is nothing after it while rows exist.
   */
  it('keeps a next page available while the count is capped', () => {
    expect(offsetPage([], COUNT_CAP + 1, query(400, 25)).pages).toBe(401);
    expect(offsetPage([], COUNT_CAP + 1, query(1, 25)).pages).toBe(COUNT_CAP / 25);
  });
});

describe('pageQuerySchema', () => {
  it('defaults to the first page at 25 rows', () => {
    expect(pageQuerySchema.parse({})).toStrictEqual({ page: 1, limit: 25 });
  });

  /** Query strings arrive as strings; `z.coerce` is what makes `?page=3` a number. */
  it('coerces strings from a query string', () => {
    expect(pageQuerySchema.parse({ page: '3', limit: '50' })).toStrictEqual({
      page: 3,
      limit: 50,
    });
  });

  /**
   * The ceilings are refusals, not clamps.
   *
   * An unbounded `limit` is a DoS vector and an unbounded `page` is a deep `OFFSET` scan, so both
   * are rejected at the boundary. The console clamps BEFORE calling, so a hand-edited URL shows a
   * table rather than an error page — these 400s are for everything that is not the console.
   */
  it('rejects a limit past the ceiling', () => {
    expect(pageQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
  });

  it('rejects a page past the ceiling', () => {
    expect(pageQuerySchema.safeParse({ page: 100_001 }).success).toBe(false);
  });

  it('rejects page zero and negative pages', () => {
    expect(pageQuerySchema.safeParse({ page: 0 }).success).toBe(false);
    expect(pageQuerySchema.safeParse({ page: -1 }).success).toBe(false);
  });

  it('rejects a fractional page', () => {
    expect(pageQuerySchema.safeParse({ page: 1.5 }).success).toBe(false);
  });

  /** `.strict()`, so a stray `cursor=` from an old bookmark is a 400 rather than silence. */
  it('rejects unknown fields', () => {
    expect(pageQuerySchema.safeParse({ page: 1, cursor: 'abc' }).success).toBe(false);
  });
});
