import 'server-only';

import { z } from 'zod';

import { getPartnerSession } from './session-server';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

export type ApiResult<T> = T | 'unauthenticated' | 'failed';

/**
 * The partner API client.
 *
 * Nothing here is ever cached: a cached listing is a stale review decision, and a cached booking
 * list is one partner's guests served to another the moment this runs behind a shared cache.
 * `cache: 'no-store'` is not an option callers can change.
 *
 * The access token is attached server-side from the HttpOnly cookie, which is the whole reason
 * this exists rather than the browser calling the API directly: no token ever reaches client
 * JavaScript.
 */
export async function partnerFetch<T>(
  path: string,
  schema: z.ZodType<T>,
  init: { method?: string; body?: unknown } = {},
): Promise<ApiResult<T>> {
  const session = await getPartnerSession();
  if (!session) return 'unauthenticated';

  let response: Response;

  try {
    response = await fetch(`${API_URL}/api/v1${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      cache: 'no-store',
    });
  } catch {
    return 'failed';
  }

  /*
    403 is reported as `unauthenticated` alongside 401, deliberately — the same choice the console
    makes. From a page's point of view they call for the same rendering, and distinguishing them
    would tempt a screen into explaining which permission is missing.
  */
  if (response.status === 401 || response.status === 403) return 'unauthenticated';
  if (!response.ok) return 'failed';

  const parsed = schema.safeParse(await response.json().catch(() => null));

  return parsed.success ? parsed.data : 'failed';
}

/**
 * A listing as `GET /partner/properties` returns it.
 *
 * Parsed rather than cast, and written against the RESPONSE rather than against the columns one
 * would expect. The first version of this asked for `address`, `city` and `units`; `listOwn`
 * selects none of them, so `safeParse` failed on every call and the page rendered "could not load"
 * with nothing in any log — the exact failure the console's client carries a warning about.
 *
 * What is absent is worth naming, because the handoff's §7.2 card wants it: there is no nightly
 * PRICE and no unit count here, so the card cannot show either until `listOwn` returns them.
 */
const propertySchema = z.object({
  reference: z.string(),
  slug: z.string(),
  nameAr: z.string(),
  nameEn: z.string().nullable(),
  status: z.string(),
  rating: z.string().nullable(),
  reviewsCount: z.number(),
  recommendationScore: z.string().nullable(),
  verifiedAt: z.union([z.string(), z.date()]).nullable(),
  createdAt: z.union([z.string(), z.date()]),
});

export type PartnerProperty = z.infer<typeof propertySchema>;

export async function getMyProperties() {
  return partnerFetch('/partner/properties', z.array(propertySchema));
}
