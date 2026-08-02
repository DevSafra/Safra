import { NextResponse, type NextRequest } from 'next/server';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

/**
 * Forwards an invitation acceptance to the API.
 *
 * Deliberately NOT using `proxy()`: that helper attaches the caller's session, and
 * this is the one console mutation made by somebody who has no session at all. The
 * invitation token in the body is the entire authentication, so nothing is added here.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body: unknown = await request.json().catch(() => null);

  try {
    const response = await fetch(`${API_URL}/api/v1/auth/staff-invitation/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
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
