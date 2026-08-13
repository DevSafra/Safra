import { NextResponse } from 'next/server';

import { ERROR } from '@safra/contracts';

import { getSession } from '@/lib/session-server';

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
  _request: Request,
  { params }: { params: Promise<{ reference: string }> },
): Promise<NextResponse> {
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
