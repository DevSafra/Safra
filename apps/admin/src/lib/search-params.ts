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

import { DEFAULT_TABLE_PAGE_SIZE, MAX_PAGE_NUMBER } from '@safra/contracts';

/**
 * Rows per page when nobody has chosen — ten, everywhere (Bashar, 2026-08-06).
 *
 * Re-exported from `@safra/contracts` rather than declared here, because the API validates saved
 * sizes against the same contract and two constants named "the default" in two packages is one
 * more than can stay in step. It was 25.
 *
 * This is the floor of a three-step resolution, not the whole answer: `?size=` wins, then the
 * reader's saved preference for that registry, then this. See `resolvePageSize`.
 */
export const DEFAULT_PAGE_SIZE = DEFAULT_TABLE_PAGE_SIZE;

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
 * The highest page number a URL may ask for — the contract's own constant, re-exported.
 *
 * The ceiling is what stops `?page=1e9` from being a cheap way to make the database scan a
 * billion rows and throw them away — an OFFSET is paid for in full before the first row is
 * returned, so a page number is an expensive thing to accept unbounded.
 *
 * It used to be a second literal here, kept in step by hand. It is not any more: the clamp only
 * turns a bad URL into a table while it agrees with the schema that would otherwise answer 400,
 * and 2026-08-20 lowered the ceiling from 100,000 to 1,000 — the exact kind of change that leaves
 * a hand-copied number behind. See `MAX_PAGE_NUMBER` in `@safra/contracts`.
 */
export const MAX_PAGE = MAX_PAGE_NUMBER;

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
export function first(
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
 * A `?status=` (or any other closed vocabulary), dropped if it is not one of the allowed values.
 *
 * ## Why the console filters this and does not leave it to the API
 *
 * The API is right to reject an unknown status: its schemas are `.strict()` so a typo cannot
 * silently widen a registry. But the console turns that 400 into «تعذّر تحميل القائمة» — a screen
 * with no table on it — and a status is something a person can TYPE into the URL or keep in a
 * bookmark after the vocabulary changes. That is the same reasoning that makes `pageNumber` and
 * `pageSize` CLAMP rather than pass a bad value on: a hand-edited URL should degrade to a sensible
 * view, never to an error page.
 *
 * Dropping is the sensible view here, and it is not the same as clamping: an unrecognised filter
 * becomes NO filter, so the reader sees everything rather than nothing. The select beside the
 * table then shows «كل الحالات», which tells them the filter is not applied rather than leaving
 * them to wonder.
 */
export function oneOf<T extends string>(
  raw: string | string[] | undefined,
  allowed: readonly T[],
): T | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = value?.trim();

  return trimmed !== undefined && (allowed as readonly string[]).includes(trimmed)
    ? (trimmed as T)
    : undefined;
}

/**
 * The screens a detail page can be reached FROM, mapped to a LITERAL path prefix.
 *
 * This map is the security boundary of the whole back-link mechanism. A URL may choose a KEY from
 * this object and nothing else: it never supplies a path, a host, a scheme or a slash. So the
 * worst a crafted `?from=` can do is send the reader to a different console screen they can
 * already reach from the sidebar — never off the console, never to `//evil.test`, never to
 * `javascript:`.
 *
 * `rows: true` means the screen is a registry whose rows can also be an origin, so `properties`
 * means the listing registry and `properties:PRO-000102` means one listing. `rows: false` means
 * the screen has no addressable rows, and a reference alongside it is rejected rather than
 * ignored — `dashboard` has path `/`, and appending a segment to it would build `//PAR-000002`,
 * which a browser reads as PROTOCOL-RELATIVE and resolves to `https://PAR-000002`. That is the
 * open redirect this whole file exists to make impossible, so it is refused by construction.
 */
const ORIGINS = {
  bookings: { path: '/bookings', rows: true },
  partners: { path: '/partners', rows: true },
  properties: { path: '/properties', rows: true },
  messages: { path: '/messages', rows: true },
  disputes: { path: '/disputes', rows: false },
  dashboard: { path: '/', rows: false },
} as const;

export type OriginKey = keyof typeof ORIGINS;

/**
 * A console reference: a three-letter prefix and a run of alphanumerics — `BKG-2026-000431`,
 * `PAR-000002`, `PRO-000102`, `DSP-000014`.
 *
 * Anchored at both ends and allowing no `/`, `.`, `:` or `%`, so a reference can only ever be one
 * path SEGMENT. `from=bookings:../../settings` and `from=bookings:%2F%2Fevil.test` both fail here
 * and the whole `from` is discarded.
 */
const REFERENCE = /^[A-Z]{3}-[A-Za-z0-9-]{1,48}$/;

/** `bookings:BKG-2026-000431`, or `disputes` for a screen that is not a single record. */
export function origin(key: OriginKey, reference?: string): string {
  return reference ? `${key}:${reference}` : key;
}

/** A resolved origin: where to go, which screen it is, and whether it is one row or the list. */
export interface Origin {
  readonly path: string;
  readonly key: OriginKey;
  /** True when the destination is a single record, which the back control names in the singular. */
  readonly record: boolean;
}

/**
 * Resolves a `?from=` into an origin, or to `null` if it is not one this console issued.
 *
 * Every part is checked: the key must be one of six literals; a reference, if present, must match
 * `REFERENCE` and must belong to a screen that HAS rows. Anything else returns `null` and the
 * caller falls back to its own registry — a back link that goes somewhere ordinary is a mild
 * inconvenience, and one that follows an unvalidated string is an open redirect.
 *
 * Note what is NOT done here: the reference is never looked up, and no permission is inferred from
 * it. This decides a LINK, and the screen it points at authorises itself on its own request. A
 * `from` naming a booking the reader may not open produces a link that answers 404 to them, which
 * is what that screen does anyway.
 */
export function resolveOrigin(raw: string | undefined): Origin | null {
  if (!raw) return null;

  const separator = raw.indexOf(':');
  const key = separator === -1 ? raw : raw.slice(0, separator);
  const reference = separator === -1 ? undefined : raw.slice(separator + 1);

  // `hasOwn`, not `in`: `from=constructor` and `from=__proto__` are inherited, not entries.
  if (!Object.hasOwn(ORIGINS, key)) return null;

  const target = ORIGINS[key as OriginKey];

  if (reference === undefined) {
    return { path: target.path, key: key as OriginKey, record: false };
  }

  if (!target.rows || !REFERENCE.test(reference)) return null;

  return { path: `${target.path}/${reference}`, key: key as OriginKey, record: true };
}

/**
 * The link from one detail screen to another — the الشريك and العقار cards, the partner column.
 *
 * It carries two things: WHERE the reader is now (`from`), so the next screen can come back here,
 * and the ORIGINAL list position, so that coming back here and then pressing back again still
 * reaches the right page of the right filtered registry. Opening a partner from a booking and
 * being returned to the partners registry is the failure this exists to prevent (Bashar,
 * 2026-08-06).
 *
 * `basePath` and the origin KEY are literals from the caller. The target reference is DATA — it
 * comes from an API response — so it is percent-encoded before it becomes a path segment, which is
 * what every route handler in `app/api/` already does and what the الحجوزات lookup does before it
 * redirects. References are database-generated and none of them needs encoding today; the point is
 * that this function cannot become the one place a reference reaches a URL raw.
 *
 * The `from` value is encoded by `URLSearchParams`, and its reference half is re-validated against
 * `REFERENCE` on the way back in, so the round trip is checked at both ends.
 */
export function detailHref(
  basePath: string,
  reference: string,
  from: string,
  params: Record<string, string | string[] | undefined>,
): string {
  const page = first(params, 'page');
  const size = first(params, 'size');
  const query = new URLSearchParams();

  query.set('from', from);

  if (page !== undefined && pageNumber(page) > 1)
    query.set('page', String(pageNumber(page)));
  if (size !== undefined && pageSize(size) !== DEFAULT_PAGE_SIZE)
    query.set('size', String(pageSize(size)));

  const q = first(params, 'q');
  const status = first(params, 'status');

  if (q) query.set('q', q);
  if (status) query.set('status', status);

  return `${basePath}/${encodeURIComponent(reference)}?${query.toString()}`;
}

/**
 * Where the back control goes, and which screen it should say it goes to.
 *
 * Two cases. Reached from another DETAIL screen — `?from=bookings:BKG-…` — it returns to that
 * record, carrying the list position onward so the trip composes: partner → booking → the right
 * page of الحجوزات. Reached from a list, or from nowhere, it behaves as it always did and returns
 * to the registry, scrolled to the row.
 *
 * `origin` is `null` in the second case, which is what tells the caller to keep naming its own
 * section in the label.
 */
export function backTarget(
  basePath: string,
  params: Record<string, string | string[] | undefined>,
  reference?: string,
): { href: string; origin: Origin | null } {
  const from = resolveOrigin(first(params, 'from'));

  if (from === null) {
    return { href: returnHref(basePath, params, reference), origin: null };
  }

  const page = first(params, 'page');
  const size = first(params, 'size');

  /*
    The list position travels ON to the origin, which is what makes the trip compose: a partner
    opened from a booking that was opened from page 4 of a filtered الحجوزات returns to that
    booking, and the booking's own back link still has the page and the filter to return to.

    A row origin also gets its `#row-…` fragment, so returning to a LIST origin — «العقارات» from a
    partner — lands on the row rather than at the top, exactly as it does from the registry itself.
  */
  const carried = returnQuery({
    ...(page === undefined ? {} : { page: pageNumber(page) }),
    ...(size === undefined ? {} : { size: pageSize(size) }),
    q: first(params, 'q'),
    status: first(params, 'status'),
  });

  return { href: `${from.path}${carried}`, origin: from };
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
