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

  return {
    q: first(params, 'q'),
    page: pageNumber(first(params, 'page')),
    size: pageSize(first(params, 'size')),
  };
}

/**
 * Reads the first value of a repeated query key, trimmed, empty collapsing to `undefined`.
 *
 * The same rule `listParams` applies, extracted because the return-link helpers below read raw
 * params too and two copies of "which value counts" would drift.
 */
function first(
  params: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const raw = params[key];
  const value = Array.isArray(raw) ? raw[0] : raw;

  return value?.trim() || undefined;
}

/**
 * The `?…` to append to a detail link so the detail screen can rebuild the list URL.
 *
 * The four named fields below ARE the allow-list, and that is deliberate: a helper that copied
 * whatever the URL happened to carry would reflect arbitrary attacker-chosen parameters into a
 * link on our own page, and would also carry junk that means nothing to the list.
 *
 * Returns `''` when there is nothing worth carrying, so the common case adds nothing to the link.
 * `page=1` and the default size are dropped for the same reason — a URL that states the default is
 * noise, and two URLs for one view is two things to keep in step.
 */
export function returnQuery(params: {
  readonly page?: number | undefined;
  readonly size?: number | undefined;
  readonly q?: string | undefined;
  readonly status?: string | undefined;
}): string {
  const query = new URLSearchParams();

  if (params.page !== undefined && params.page > 1)
    query.set('page', String(params.page));
  if (params.size !== undefined && params.size !== DEFAULT_PAGE_SIZE)
    query.set('size', String(params.size));
  if (params.q) query.set('q', params.q);
  if (params.status) query.set('status', params.status);

  const search = query.toString();

  return search ? `?${search}` : '';
}

/**
 * The DOM id of a list row, and the URL fragment that scrolls back to it.
 *
 * One function for both ends on purpose: an `id` and a `#fragment` that are written separately
 * drift, and the failure is silent — the browser finds nothing to scroll to and simply lands at
 * the top, which is exactly what the feature was added to stop.
 *
 * Every character outside `[A-Za-z0-9_-]` is folded to `_` so the result is always a usable id and
 * a usable fragment. References are `BKG-…`, `PAR-…`, `PRO-…` and already qualify; the fold is
 * there so a reference format that one day includes a space or a `#` degrades to a harmless
 * no-scroll rather than to a broken URL.
 */
export function rowAnchor(reference: string): string {
  return `row-${reference.replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

/**
 * Rebuilds the list URL a detail screen was reached from.
 *
 * `basePath` is supplied by the caller as a literal — never taken from the URL. That is what makes
 * this safe: the only thing the query string can influence is which PAGE of a known list to return
 * to, so a crafted link cannot turn the back button into a redirect off the console.
 *
 * `page` and `size` are clamped on the way through, so a hand-edited `?page=0` produces a link to
 * page one rather than a link the API answers with a 400.
 *
 * `reference` adds the row fragment. It is the detail screen's OWN reference — the record it is
 * already displaying — not something carried in the query string, so there is no extra parameter
 * to keep in step and nothing a crafted link can point at that the reader is not already looking
 * at. A page of 25 rows is a screen and a half, so returning to the right page still left the
 * reader hunting for the row they had opened (Bashar, 2026-08-05).
 */
export function returnHref(
  basePath: string,
  params: Record<string, string | string[] | undefined>,
  reference?: string,
): string {
  const page = first(params, 'page');
  const size = first(params, 'size');
  const query = returnQuery({
    ...(page === undefined ? {} : { page: pageNumber(page) }),
    ...(size === undefined ? {} : { size: pageSize(size) }),
    q: first(params, 'q'),
    status: first(params, 'status'),
  });

  return `${basePath}${query}${reference ? `#${rowAnchor(reference)}` : ''}`;
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
