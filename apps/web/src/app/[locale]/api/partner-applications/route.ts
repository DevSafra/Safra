import { NextResponse } from 'next/server';

import { ERROR } from '@safra/contracts';

import { getSession } from '@/lib/session-server';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

/**
 * Server-side proxy for «انضم كشريك» (Bashar, 2026-08-19).
 *
 * ## A session is REQUIRED
 *
 * Applying is only for people who already have an account: the request is filed against it, and
 * the address, the eligibility check and the account that eventually becomes a partner all come
 * from the token. Refused here as well as at the API — not for safety, which the API provides,
 * but so an expired session produces a clean 401 the form can explain rather than an upstream
 * error the reader cannot act on.
 *
 * The token is attached from the HttpOnly cookie, so it never reaches client JavaScript.
 *
 * The body passes through untouched. Validating here would duplicate `partnerApplicationSchema`
 * and two copies of a rule drift; every rule that matters is enforced server-side regardless of
 * what arrives — including the throttle, which is why this proxy adds none of its own.
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
    const response = await fetch(`${API_URL}/api/v1/partner/applications`, {
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
