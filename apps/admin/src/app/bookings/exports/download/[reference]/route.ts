import 'server-only';

import { seeOther } from '@safra/session';

import { getStaffSession } from '@/lib/session-server';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

/** `EXP-000112`. Bounded here as well as in the API — a path segment is user input. */
const REFERENCE_PATTERN = /^EXP-\d{1,12}$/;

/**
 * Where a reader who could not have the file is sent: back to the list, with one flag.
 *
 * A literal, so nothing in the request can influence the destination — this route takes a reference
 * from the path, and a redirect built from caller input is the classic open redirect.
 */
const UNAVAILABLE = '/bookings/exports?unavailable=1';

/**
 * Collects a built export.
 *
 * A thin pass-through, and deliberately thin: the API decides whether this caller may have the file
 * and writes `booking.exported` immediately before the bytes leave. Logic here would be logic
 * outside the audited path.
 *
 * This route exists only because the BROWSER authenticates with an HttpOnly cookie and cannot send
 * a bearer token — the same reason every other write goes through `lib/proxy`.
 *
 * ## A failure is a REDIRECT, never a body
 *
 * The reader arrives here by clicking «تنزيل», so the browser navigates and renders whatever comes
 * back. It used to answer `Not signed in.` / `Not found.` / `Export unavailable.` — three bare
 * English strings, outside the catalogue, shown as documents with no console around them. Each is
 * now a redirect to the collection screen, which says what happened in Arabic and still lists every
 * other file. Same reasoning as the rows-per-page bar (2026-08-25, Bashar).
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ reference: string }> },
): Promise<Response> {
  const session = await getStaffSession();

  /* The session went while the page was open. Sign in, and the console is one step away. */
  if (!session) return seeOther('/login');

  const { reference } = await params;

  /*
    Refused before it reaches a URL. The API bounds it too; neither relies on the other.

    The SAME destination as an upstream refusal below, on purpose: a malformed reference and a real
    reference this reader may not have must be indistinguishable, or the difference between them
    tells a caller which export ids exist.
  */
  if (!REFERENCE_PATTERN.test(reference)) return seeOther(UNAVAILABLE);

  const response = await fetch(`${API_URL}/api/v1/admin/exports/${reference}/download`, {
    headers: { Accept: 'text/csv', Authorization: `Bearer ${session.accessToken}` },
    cache: 'no-store',
  });

  if (!response.ok) {
    /* Generic to the browser; the API already logged the specifics. */
    return seeOther(UNAVAILABLE);
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
