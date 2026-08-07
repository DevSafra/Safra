import 'server-only';

import { NextResponse } from 'next/server';

import { getPartnerSession } from './session-server';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

/**
 * Forwards an authenticated partner call to the API.
 *
 * The same shape as the console's, and for the same reason: the access token is attached
 * server-side from the HttpOnly cookie, so no token ever reaches client JavaScript. That is why
 * these route handlers exist at all rather than the browser calling the API directly.
 *
 * Distinct from `partnerFetch` in `api.ts`, which is for SERVER components reading data and
 * returns a parsed value or a sentinel. This is for route handlers relaying a browser's write and
 * returning the API's own status and body — a page decides how to render a failure, whereas a
 * form needs to know what the API actually said.
 */
export async function proxy(
  path: string,
  init: { method: string; body?: unknown } = { method: 'POST' },
): Promise<NextResponse> {
  const session = await getPartnerSession();

  if (!session) {
    return NextResponse.json({ message: 'Not signed in.' }, { status: 401 });
  }

  try {
    const response = await fetch(`${API_URL}/api/v1${path}`, {
      method: init.method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      cache: 'no-store',
    });

    if (response.status === 204) return new NextResponse(null, { status: 204 });

    const payload: unknown = await response.json().catch(() => null);

    return NextResponse.json(payload, { status: response.status });
  } catch {
    return NextResponse.json(
      { message: 'Could not reach the server. Please try again.' },
      { status: 502 },
    );
  }
}
