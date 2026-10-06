import 'server-only';

import { headers } from 'next/headers';

import { internalCallerHeaders } from '@safra/session';

/**
 * The headers that put a page's API call on the VISITOR's rate limit rather than this server's.
 *
 * For server components and anything they call, which have no `Request` in hand. A route handler
 * or the middleware passes its own `request.headers` to `internalCallerHeaders` instead. Both read
 * the same rule, in `@safra/session`, for where the visitor's address comes from.
 *
 * Only on an UNCACHED fetch (`no-store`, `revalidate: 0`). Reading the request headers makes a
 * render dynamic, and Next keys its data cache on the fetch's headers, so on a cached fetch this
 * would turn one shared copy into one per visitor.
 */
export async function visitorHeaders(): Promise<Record<string, string>> {
  return internalCallerHeaders(await headers());
}
