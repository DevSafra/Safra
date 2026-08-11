import { NextResponse } from 'next/server';

import { ERROR } from '@safra/contracts';

import { getSession } from '@/lib/session-server';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

/**
 * Server-side proxy for changing your own password (handoff §6, الملف الشخصي).
 *
 * Authenticated here, from the HttpOnly cookie, so the access token never reaches client JavaScript —
 * which matters more on this route than any other, because the body carries two passwords.
 *
 * ## Nothing is validated, and nothing is logged
 *
 * The body passes through untouched: the API owns the policy, and a second copy would drift. Nor is any
 * part of it recorded here — rule 1 forbids logging a secret, and a proxy that helpfully logged its
 * payload on failure would write both passwords to disk.
 *
 * ## The status is preserved
 *
 * A wrong current password is a 400 with `auth.password_incorrect`, and the form says so specifically.
 * Flattening it to a generic failure would leave somebody retyping a correct new password.
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
    const response = await fetch(`${API_URL}/api/v1/auth/me/password`, {
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
