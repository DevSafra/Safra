import 'server-only';

import {
  TABLE_SECTION_PARAMS,
  DEFAULT_TABLE_PAGE_SIZE,
  storedPageSize,
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
  // Clamped, not trusted — `?size=5000` is a typo to survive, not an error page.
  if (fromUrl !== undefined) return pageSize(fromUrl);

  const preferences = await getPreferences();

  if (preferences === 'failed' || preferences === 'unauthenticated') {
    return DEFAULT_TABLE_PAGE_SIZE;
  }

  return storedPageSize(preferences.tablePageSizes, section);
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
): Promise<{ q: string | undefined; page: number; size: number }> {
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

  return {
    q: first(params, queryName),
    page: pageNumber(first(params, names.page)),
    size: await resolvePageSize(section, first(params, names.size)),
  };
}
