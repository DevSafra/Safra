import 'server-only';

import { getStaffSession } from '@/lib/session-server';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

/** `EXP-000112`. Bounded here as well as in the API — a path segment is user input. */
const REFERENCE_PATTERN = /^EXP-\d{1,12}$/;

/**
 * Collects a built export.
 *
 * A thin pass-through, and deliberately thin: the API decides whether this caller may have the file
 * and writes `booking.exported` immediately before the bytes leave. Logic here would be logic
 * outside the audited path.
 *
 * This route exists only because the BROWSER authenticates with an HttpOnly cookie and cannot send
 * a bearer token — the same reason every other write goes through `lib/proxy`.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ reference: string }> },
): Promise<Response> {
  const session = await getStaffSession();

  if (!session) return new Response('Not signed in.', { status: 401 });

  const { reference } = await params;

  /* Refused before it reaches a URL. The API bounds it too; neither relies on the other. */
  if (!REFERENCE_PATTERN.test(reference)) {
    return new Response('Not found.', { status: 404 });
  }

  const response = await fetch(`${API_URL}/api/v1/admin/exports/${reference}/download`, {
    headers: { Accept: 'text/csv', Authorization: `Bearer ${session.accessToken}` },
    cache: 'no-store',
  });

  if (!response.ok) {
    /* Generic to the browser; the API already logged the specifics. */
    return new Response('Export unavailable.', { status: response.status });
  }

  /*
    Streamed rather than buffered, so a large export never sits in this process's memory. The
    headers that matter are re-set explicitly: copying the API's whole header set would forward its
    `Content-Length` alongside a stream this route does not control.
  */
  return new Response(response.body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${reference}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
