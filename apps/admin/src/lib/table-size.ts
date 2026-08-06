import 'server-only';

import {
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
): Promise<{ q: string | undefined; page: number; size: number }> {
  const params = await searchParams;

  return {
    q: first(params, 'q'),
    page: pageNumber(first(params, 'page')),
    size: await resolvePageSize(section, first(params, 'size')),
  };
}
