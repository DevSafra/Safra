import { NextResponse } from 'next/server';

import { ERROR } from '@safra/contracts';

import { getSession } from '@/lib/session-server';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

/**
 * Raising a dispute (النزاعات).
 *
 * Authenticated here from the HttpOnly cookie, so the access token never reaches client JavaScript.
 * The body passes through untouched — the API owns every rule about what may be disputed, and a second
 * copy of them here would drift from the one that is enforced.
 *
 * Nothing is logged. A dispute's description is somebody's account of a stay that went wrong, and the
 * API redacts contact details out of it precisely so they are not stored; writing the raw body to a
 * proxy log would put back exactly what the redaction removed.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ code: ERROR.AUTH_REQUIRED }, { status: 401 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: ERROR.REQUEST_MALFORMED_BODY }, { status: 400 });
  }

  try {
    const response = await fetch(`${API_URL}/api/v1/disputes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });

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
