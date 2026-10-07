/**
 * «عرض المزيد» — every cursor list a person reads grows in place (Bashar, 2026-10-07).
 *
 * A list shows {@link SHOW_MORE_STEP} rows and, when there are more, a control at its end that adds
 * the next fifteen beneath the ones already on screen. It replaced a «next page» link that swapped
 * the whole list for the following one, which on a wallet statement meant losing the line you were
 * reading to look at the one after it.
 *
 * ## The count lives in the URL, not in a component
 *
 * `?shown=30` is the whole state. The server reads that many rows and renders them, so a reload, a
 * shared link and the back button all land on the same list, the rows stay server-rendered with
 * their own markup, and the control works as a plain link before any script has run. The client half
 * (`ShowMore` in `@safra/ui`) only makes the navigation soft, so the page does not jump.
 *
 * ## Bounded, because it is a request path
 *
 * Reading «shown» rows costs ceil(shown / {@link REQUEST_CHUNK}) keyset requests, each on an index.
 * Past {@link SHOW_MORE_CEILING} the list does not keep growing: the control moves the WINDOW
 * forward instead (`?cursor=`), which is the old forward-only page, and a «back to the start» link
 * appears. Three hundred rows is a long statement; a list that grew without limit would turn one
 * reader's scroll into an unbounded read on every press.
 */

/** Rows added per press, and the first screenful. */
export const SHOW_MORE_STEP = 15;

/** The most rows one list window holds before the control moves the window instead. */
export const SHOW_MORE_CEILING = 300;

/**
 * Rows asked for per request while reading a window. A multiple of the step, under every list
 * endpoint's ceiling of 100 (`cursorQuerySchema`), so three hundred rows is four requests.
 */
const REQUEST_CHUNK = 90;

/**
 * `?shown=` as a row count: a multiple of the step between one step and the ceiling.
 *
 * CLAMPED rather than validated, for the reason `pageNumber()` gives on the console: the value is
 * typed and pasted by people, and `?shown=5000` or `?shown=abc` should be a list, not an error page.
 */
export function shownCount(raw: unknown): number {
  const value: unknown = Array.isArray(raw) ? (raw as unknown[])[0] : raw;
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;

  if (!Number.isFinite(parsed) || parsed <= SHOW_MORE_STEP) return SHOW_MORE_STEP;

  const stepped = Math.ceil(parsed / SHOW_MORE_STEP) * SHOW_MORE_STEP;

  return Math.min(stepped, SHOW_MORE_CEILING);
}

/** One page as the list fetchers return it: rows and the cursor after them. */
interface CursorPageShape<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

/**
 * Reads `shown` rows from `cursor` onwards, a chunk at a time.
 *
 * The fetchers answer a page or a failure word (`'failed'`, `'unauthenticated'`); a failure on ANY
 * chunk is returned as itself, never as a shorter list, because a statement that silently stops
 * part-way reads as a complete one.
 */
export async function readShown<R>(
  fetchPage: (limit: number, cursor: string | undefined) => Promise<R>,
  shown: number,
  cursor: string | undefined,
): Promise<R> {
  type Page = Extract<R, CursorPageShape<unknown>>;

  let remaining = shown;
  let after = cursor;
  let first: Page | undefined;
  const items: unknown[] = [];

  while (remaining > 0) {
    const page = await fetchPage(Math.min(remaining, REQUEST_CHUNK), after);

    if (!isPage<Page>(page)) return page;

    first ??= page;
    items.push(...page.items);
    remaining -= page.items.length;
    after = page.nextCursor ?? undefined;

    if (page.nextCursor === null || page.items.length === 0) break;
  }

  if (!first) return { items: [], nextCursor: null } as R;

  return { ...first, items, nextCursor: remaining > 0 ? null : (after ?? null) };
}

function isPage<P>(value: unknown): value is P {
  return typeof value === 'object' && value !== null && 'items' in value;
}

/**
 * Where «عرض المزيد» goes: the query string for the next state, or null when the list has ended.
 *
 * Inside the ceiling it is the same window with fifteen more rows; at the ceiling it is the next
 * window from the last row's cursor. Only `cursor` and `shown` are written: the list's own filters,
 * where it has any, are the caller's to carry.
 */
export function showMoreQuery(state: {
  readonly cursor: string | undefined;
  readonly shown: number;
  readonly nextCursor: string | null;
}): string | null {
  if (state.nextCursor === null) return null;

  const query = new URLSearchParams();

  if (state.shown + SHOW_MORE_STEP > SHOW_MORE_CEILING) {
    query.set('cursor', state.nextCursor);

    return query.toString();
  }

  if (state.cursor) query.set('cursor', state.cursor);
  query.set('shown', String(state.shown + SHOW_MORE_STEP));

  return query.toString();
}
