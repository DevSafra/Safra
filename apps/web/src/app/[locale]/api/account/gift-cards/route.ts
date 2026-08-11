import { NextResponse } from 'next/server';

import { ERROR } from '@safra/contracts';

import { getSession } from '@/lib/session-server';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

/**
 * Buying a gift card (handoff §6, بطاقات الهدايا).
 *
 * Authenticated here from the HttpOnly cookie, so the access token never reaches client JavaScript.
 *
 * ## Nothing about the response is logged
 *
 * The upstream answer carries the plaintext code — the one and only time it exists outside the
 * database's hash. A proxy that helpfully logged its payload on failure would write a spendable
 * instrument to disk, so this one logs nothing at all and passes the body straight through.
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
    const response = await fetch(`${API_URL}/api/v1/gift-cards`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });

    /* The status is preserved: an insufficient balance is a 400 the form explains specifically. */
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
