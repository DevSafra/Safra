import 'server-only';

import { getAmenities, type Amenity } from '@/lib/catalog';
import { parseSearch, type ParsedSearch } from '@/lib/search-query';

/**
 * A search as the browser's own fetches send it, read the way the results page reads its URL.
 *
 * Shared by the route that loads the next batch and the one that loads the map, so both parse with
 * the page's allow-list (`parseSearch`) and neither forwards a parameter the page would drop.
 */
export async function readSearchRequest(request: Request): Promise<{
  url: URL;
  parsed: ParsedSearch;
  amenities: Amenity[];
  /** A person who opened the URL, rather than the page fetching it: sent to the page instead. */
  navigation: boolean;
}> {
  const url = new URL(request.url);
  const raw = Object.fromEntries(
    [...new Set(url.searchParams.keys())].map((key) => {
      const values = url.searchParams.getAll(key);
      return [key, values.length > 1 ? values : values[0]];
    }),
  );

  const amenities = await getAmenities();
  const parsed = parseSearch(
    raw,
    new Set(amenities.filter((one) => one.propertyCount > 0).map((one) => one.code)),
  );

  const navigation =
    request.headers.get('sec-fetch-mode') === 'navigate' ||
    (request.headers.get('accept') ?? '').includes('text/html');

  return { url, parsed, amenities, navigation };
}
