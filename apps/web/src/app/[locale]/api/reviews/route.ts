import { NextResponse } from 'next/server';

import { ERROR } from '@safra/contracts';

import { getSession } from '@/lib/session-server';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

/**
 * Server-side proxy for review creation (§7.3).
 *
 * Unlike booking creation this one is AUTHENTICATED: a review is written by a signed-in customer
 * about their own completed stay, and the access token is attached here from the HttpOnly cookie
 * so it never reaches client JavaScript.
 *
 * The body passes through untouched. Validating here would duplicate the Zod schema the API
 * already enforces, and two copies of a rule drift — the same call `api/bookings/route.ts` makes.
 * Every rule that matters (your booking, completed, not already reviewed) is enforced server-side
 * regardless of what arrives.
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
    const response = await fetch(`${API_URL}/api/v1/reviews`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });

    const payload: unknown = await response.json().catch(() => null);

    return NextResponse.json(payload, { status: response.status });
  } catch {
    return NextResponse.json(
      { code: ERROR.REQUEST_UPSTREAM_UNREACHABLE },
      { status: 502 },
    );
  }
}
