import { NextResponse } from 'next/server';

import { getPartnerSession } from '@/lib/session-server';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

/**
 * Streams a listing photo from the API, with the partner's token attached server-side.
 *
 * ## Why a proxy and not a direct URL
 *
 * The same reason every other API call goes through this app: the access token lives in an
 * HttpOnly cookie and must never reach client JavaScript, and an `<img src>` cannot carry an
 * Authorization header. Handing the browser a signed CDN URL is the other answer, and it is the
 * one to build when object storage has a signed-URL story — recorded in `docs/FUTURE-WORK.md`.
 *
 * ## Authorisation is the API's, not this route's
 *
 * This forwards the caller's own token; the API decides whether that partner may see that file.
 * A route that fetched with a service credential would turn "any signed-in partner" into "every
 * photo on the platform", which is exactly the shape of bug a proxy invites.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string }> },
): Promise<Response> {
  const session = await getPartnerSession();

  if (!session) return new NextResponse(null, { status: 401 });

  const { key } = await params;

  const upstream = await fetch(
    `${API_URL}/api/v1/partner/images/${encodeURIComponent(key)}`,
    {
      headers: { Authorization: `Bearer ${session.accessToken}` },
      cache: 'no-store',
    },
  ).catch(() => null);

  if (!upstream || !upstream.ok) {
    return new NextResponse(null, { status: upstream?.status ?? 502 });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      /* Private: a listing photo is not secret, but it is fetched with a session token. */
      'Cache-Control': 'private, max-age=60',
    },
  });
}
