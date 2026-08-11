import { NextResponse } from 'next/server';

import { ERROR } from '@safra/contracts';

import { getSession } from '@/lib/session-server';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

/**
 * Redeeming a gift card code (handoff §6, بطاقات الهدايا).
 *
 * Authenticated here from the HttpOnly cookie, so the access token never reaches client JavaScript.
 *
 * ## Nothing about the REQUEST is logged
 *
 * The body carries a code, and a code is cash: whoever holds the string can turn it into money. Rule 1
 * forbids logging a secret, and a proxy that recorded its payload on failure would write spendable
 * instruments into a log file. It passes the body straight through and records none of it.
 *
 * The code travels in a body rather than a query string for the same reason — a query string reaches
 * access logs, browser history and the `Referer` header.
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
    const response = await fetch(`${API_URL}/api/v1/gift-cards/redeem`, {
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
