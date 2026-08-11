import { NextResponse } from 'next/server';

import { ERROR } from '@safra/contracts';

import { getSession } from '@/lib/session-server';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

/**
 * Server-side proxy for editing your own name and phone (handoff §6, الملف الشخصي).
 *
 * Authenticated here, from the HttpOnly cookie, so the access token never reaches client JavaScript.
 *
 * The body passes through untouched: validating it here would duplicate the Zod schema the API already
 * enforces, and two copies of a rule drift. Every rule that matters — the length policy, the trim, and
 * the refusal to accept an `email` field at all — is enforced server-side regardless of what arrives.
 *
 * The upstream STATUS is preserved rather than flattened, so the form can tell a rejected value from a
 * failure it can only apologise for.
 */
export async function PATCH(request: Request): Promise<NextResponse> {
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
    const response = await fetch(`${API_URL}/api/v1/auth/me/profile`, {
      method: 'PATCH',
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
