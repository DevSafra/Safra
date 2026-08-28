import 'server-only';

import {
  TABLE_SECTION_PARAMS,
  DEFAULT_TABLE_PAGE_SIZE,
  storedPageSize,
  type SectionSeen,
  type SeenSection,
  type TableSection,
} from '@safra/contracts';

import { getPreferences } from './api';
import { first, pageNumber, pageSize } from './search-params';

/**
 * How many rows this registry should show, for this reader, right now.
 *
 * Three sources, in order:
 *
 *  1. `?size=` in the URL — a link somebody shared, or the bar they just submitted. The URL always
 *     wins, because a shared view has to look the same to both people.
 *  2. What this staff member last chose for THIS registry, from their account.
 *  3. Ten (Bashar, 2026-08-06).
 *
 * ## Why the preference is on the account and not in the browser
 *
 * The sidebar's collapsed state lives in `localStorage`, and that is right for it — it is a
 * property of the window. Rows per page is a property of the PERSON: they want fifty because of
 * how they work, not because of which laptop they opened. `localStorage` would forget it on a new
 * machine and on a cleared cache, which is exactly when somebody notices.
 *
 * ## A failed read is not an error
 *
 * A console that refused to render الحجوزات because it could not read a display preference would
 * be worse than one that shows ten rows. `getPreferences` returning `failed` or `unauthenticated`
 * falls through to the default; the page's own fetch reports the real problem.
 */
export async function resolvePageSize(
  section: TableSection,
  fromUrl: string | undefined,
): Promise<number> {
  return (await readerView(section, fromUrl)).size;
}

/**
 * Both halves of what this reader's own row says about a registry, from ONE read.
 *
 * The page size and the «last opened» mark live in the same `users` row and arrive in the same
 * `/admin/me/preferences` payload. Fetching them separately would be a second round trip per
 * render for two fields of one record — and `staffFetch` is `no-store`, so nothing would dedupe
 * it.
 *
 * A failed read is not an error, for the reason `resolvePageSize` gives and for one more: no mark
 * means no tint, and a console that refused to render العملاء because it could not tell which rows
 * were new would be worse than one that tints nothing.
 */
export async function readerView(
  section: TableSection,
  fromUrl: string | undefined,
): Promise<{ size: number; seen: SectionSeen | null }> {
  const preferences = await getPreferences();
  const readable = preferences !== 'failed' && preferences !== 'unauthenticated';

  return {
    // Clamped, not trusted — `?size=5000` is a typo to survive, not an error page.
    size:
      fromUrl !== undefined
        ? pageSize(fromUrl)
        : readable
          ? storedPageSize(preferences.tablePageSizes, section)
          : DEFAULT_TABLE_PAGE_SIZE,
    /*
      All three marks, because the TINT and the BADGE describe the same set.

      Bashar, 2026-08-28: «when I switch to other page, the only seen marked rows should be not
      marked anymore». A row is marked while it is UNREAD and stops being marked once it has been on
      screen — so the tint uses the predicate the count uses, and the two can never disagree.

      An earlier version tinted the whole batch instead. That kept rows marked after they had been
      read, and it was arrived at by over-correcting a real defect: when a batch was wrongly retired
      the UNSEEN rows lost their mark too, which is what «new rows are not marked anymore» was
      reporting. The batch had to stop being retired; the tint did not have to stop following what
      is unread.
    */
    seen: readable ? (preferences.sectionSeenAt[section] ?? null) : null,
  };
}

/**
 * `listParams`, with the reader's saved page size folded in.
 *
 * The server-only twin of `listParams`. The split is not cosmetic: `search-params.ts` is imported
 * by `admin-table.tsx` for `rowAnchor`, which makes it client-reachable, and reading a preference
 * needs the session and the API. So the query-string parsing stays there and the part that talks
 * to the server lives here.
 */
export async function listParamsFor(
  section: TableSection,
  searchParams: Promise<Record<string, string | string[] | undefined>>,
  /**
   * What this table's search parameter is called — `q` for the registry on a route, something else
   * for a second table beside it.
   *
   * `TABLE_SECTION_PARAMS` namespaces `page` and `size` but not the search term, because until
   * `/ads` grew فواتير الإعلانات no second table on a route had its own search: `/staff`'s activity
   * panel reads `activityQ` by hand. Passed rather than derived so the map keeps meaning exactly
   * what the save endpoint needs it to mean — it is what that endpoint's REDIRECT is built from.
   */
  queryName = 'q',
): Promise<{
  q: string | undefined;
  page: number;
  size: number;
  /**
   * When this reader last opened the section, or `null` if never — or if it keeps no mark.
   *
   * Returned from here rather than fetched by each page because `resolvePageSize` already reads
   * the same `/admin/me/preferences` payload: two calls for two halves of one row would be a
   * second round trip per render for nothing.
   */
  seen: SectionSeen | null;
}> {
  const params = await searchParams;

  /*
    The section's OWN parameter names, not `page` and `size`.
    
    Three routes carry two tables — `/staff`, `/partners` and `/properties` — and the second on each
    namespaces its parameters so paging one does not move the other. This function already took a
    section and then ignored it for the parameter names, so a namespaced table had to read the query
    string by hand: `/staff` did exactly that, and in doing so it used `pageSize()` instead of
    `resolvePageSize()` and silently stopped honouring the reader's SAVED size for that table.
    Reading the names from the same map the save endpoint redirects through means one answer to
    "what is this table's page parameter".
  */
  const names = TABLE_SECTION_PARAMS[section];
  const view = await readerView(section, first(params, names.size));

  return {
    q: first(params, queryName),
    page: pageNumber(first(params, names.page)),
    size: view.size,
    seen: view.seen,
  };
}

/**
 * Whether a row is still UNREAD — the same question the sidebar badge counts.
 *
 * Two ways a row is unread, and neither alone is enough:
 *
 *  - it is inside the batch and BELOW the frontier, so paging down has not reached it — which is
 *    what makes a row stop being marked once it has been on screen;
 *  - or it is newer than anything ever shown, meaning it ARRIVED while the reader was here. Without
 *    this the mark appears only on the reader's SECOND visit after new rows land.
 *
 * `markSeen` re-opens the batch from the top of what was seen on the first report after an arrival,
 * which is what stops the second clause stranding all but the newest of them.
 *
 * Deliberately the same shape as `stillUnread` in `review.service.ts`. They are two expressions of
 * one rule and the failure when they drift is a badge counting three over a table marking none.
 */
export function isUnread(seen: SectionSeen | null) {
  return (createdAt: string): boolean => {
    if (seen === null) return false;

    const at = Date.parse(createdAt);
    const inBatch =
      at > Date.parse(seen.since) &&
      (seen.readTo === null || at < Date.parse(seen.readTo));
    const arrivedSince = seen.readFrom !== null && at > Date.parse(seen.readFrom);

    return inBatch || arrivedSince;
  };
}

/** The sections that keep a mark, narrowed for the pages that pass one to `MarkSectionSeen`. */
export type { SeenSection };
