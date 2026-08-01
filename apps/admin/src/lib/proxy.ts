import 'server-only';

import { NextResponse } from 'next/server';

import { getStaffSession } from './session-server';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

/**
 * Forwards an authenticated staff call to the API.
 *
 * Exists so route handlers stay three lines each. The access token is attached
 * server-side from the HttpOnly cookie, which is the whole reason these handlers are
 * here rather than the browser calling the API directly: no token ever reaches
 * client JavaScript.
 */
export async function proxy(
  path: string,
  init: { method: string; body?: unknown } = { method: 'POST' },
): Promise<NextResponse> {
  const session = await getStaffSession();

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
