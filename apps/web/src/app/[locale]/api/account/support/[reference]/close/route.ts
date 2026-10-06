import { NextResponse } from 'next/server';

import { ERROR } from '@safra/contracts';
import { internalCallerHeaders } from '@safra/session';

import { getSession } from '@/lib/session-server';
import { refuseCrossOrigin } from '@/lib/cross-origin';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

/**
 * Closing a support ticket (الدعم).
 *
 * Authenticated from the HttpOnly cookie like its `reply` sibling, so the access token never reaches
 * client JavaScript.
 *
 * There is no body to forward. The reference in the path is the whole request and the API takes the
 * owner from the token, so this route has nothing to validate and nothing a caller could smuggle
 * through it.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ reference: string }> },
): Promise<NextResponse> {
  const refused = refuseCrossOrigin(request);
  if (refused) return refused;

  const session = await getSession();

  if (!session) {
    return NextResponse.json({ code: ERROR.AUTH_REQUIRED }, { status: 401 });
  }

  try {
    const response = await fetch(
      `${API_URL}/api/v1/support/${encodeURIComponent((await params).reference)}/close`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${session.accessToken}`,
          ...internalCallerHeaders(request.headers),
        },
        cache: 'no-store',
      },
    );

    return NextResponse.json(await response.json().catch(() => null), {
      status: response.status,
    });
  } catch {
    return NextResponse.json(
      { code: ERROR.REQUEST_UPSTREAM_UNREACHABLE },
      { status: 502 },
    );
  }
}
