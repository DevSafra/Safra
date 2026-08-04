import 'server-only';

import { getStaffSession } from '@/lib/session-server';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

/**
 * تصدير CSV — a thin pass-through to the API's audited export (B-13).
 *
 * ## Why this is a proxy and no longer a generator
 *
 * The first version built the CSV here, walking the public API a page at a time. It worked, and it
 * could not write an audit row inside the API's transaction — so an export left no trace of who
 * took what. An export removes data from the console's access controls, which is exactly what the
 * audit log is for.
 *
 * So the API owns it now: it counts, records `booking.exported` with the actor, the filters and the
 * row count, and returns the bytes. This route exists only because the BROWSER authenticates with
 * an HttpOnly cookie and cannot send a bearer token — the same reason every other write goes
 * through `lib/proxy`. It adds no logic, and deliberately so: logic here would be logic outside the
 * audited path.
 *
 * The filters are forwarded verbatim rather than re-parsed. Re-validating would create a second
 * definition of a valid export, and the API's `.strict()` schema is the one that counts.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const session = await getStaffSession();

  if (!session) return new Response('Not signed in.', { status: 401 });

  const incoming = new URL(request.url);
  const target = new URL(`${API_URL}/api/v1/admin/bookings/export`);

  for (const key of ['q', 'status'] as const) {
    const value = incoming.searchParams.get(key);

    if (value) target.searchParams.set(key, value);
  }

  const response = await fetch(target, {
    headers: {
      Accept: 'text/csv',
      Authorization: `Bearer ${session.accessToken}`,
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    /* Generic to the browser; the API already logged the specifics. */
    return new Response('Export failed.', { status: response.status });
  }

  /*
    The body is streamed through rather than buffered, so a large export never sits in this
    process's memory. The headers that matter are re-set explicitly: copying the API's whole header
    set would forward its `Content-Length` alongside a stream this route does not control.
  */
  return new Response(response.body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="safra-bookings.csv"',
      'Cache-Control': 'no-store',
    },
  });
}
