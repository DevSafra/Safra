/**
 * Reads the query parameters every registry page shares: search, page number and page size.
 *
 * Next gives `searchParams` as `string | string[] | undefined` because a URL can legitimately
 * repeat a key. Taking the FIRST value is the right reading here: `?q=a&q=b` is either a bug or
 * somebody probing, and neither deserves an array reaching a SQL `LIKE`.
 *
 * Trimmed, and an empty string collapses to `undefined` so the API never receives `?q=` — which
 * its `.strict()` schema would reject with a 400 and turn a stray submit into an error page.
 */

/**
 * Rows per page when nobody has chosen.
 *
 * 25 was already the API client's default, so this changes nothing for a caller who does not pass
 * a size — it just gives the number a name and one home.
 */
export const DEFAULT_PAGE_SIZE = 25;

/**
 * The floor and ceiling, matching `pageQuerySchema` in `@safra/contracts`.
 *
 * Clamped here as well as validated there, and that is not redundant: the API answers a
 * `?size=5000` with a 400, which would turn a typo in the URL into an error page instead of a
 * table. Clamping first means the worst a hand-edited URL can do is show 100 rows.
 */
export const MIN_PAGE_SIZE = 1;
export const MAX_PAGE_SIZE = 100;

/**
 * The highest page number a URL may ask for, matching the contract.
 *
 * The ceiling is what stops `?page=1e9` from being a cheap way to make the database scan a
 * billion rows and throw them away — an OFFSET is paid for in full before the first row is
 * returned, so a page number is an expensive thing to accept unbounded.
 */
export const MAX_PAGE = 100_000;

export interface ListParams {
  readonly q: string | undefined;
  /** 1-based, already clamped — safe to pass straight to the API. */
  readonly page: number;
  /** Rows per page, already clamped — safe to pass straight to the API. */
  readonly size: number;
}

export async function listParams(
  searchParams: Promise<Record<string, string | string[] | undefined>>,
): Promise<ListParams> {
  const params = await searchParams;

  const first = (key: string): string | undefined => {
    const raw = params[key];
    const value = Array.isArray(raw) ? raw[0] : raw;

    return value?.trim() || undefined;
  };

  return {
    q: first('q'),
    page: pageNumber(first('page')),
    size: pageSize(first('size')),
  };
}

/**
 * Parses `?size=` into a usable row count.
 *
 * Anything unparseable falls back to the default rather than erroring. A page size is a display
 * preference: the right response to `?size=abc` is a table with 25 rows, not a stack trace.
 */
export function pageSize(raw: string | undefined): number {
  const parsed = Number(raw);

  if (!Number.isFinite(parsed)) return DEFAULT_PAGE_SIZE;

  return Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, Math.trunc(parsed)));
}

/**
 * Parses `?page=` into a 1-based page number.
 *
 * Same reasoning as `pageSize`: the reader TYPES this one, so a typo is an ordinary event and the
 * right answer to `?page=abc` or `?page=0` is page one.
 */
export function pageNumber(raw: string | undefined): number {
  const parsed = Number(raw);

  if (!Number.isFinite(parsed)) return 1;

  return Math.min(MAX_PAGE, Math.max(1, Math.trunc(parsed)));
}
