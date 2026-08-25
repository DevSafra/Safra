import { NextResponse } from 'next/server';
import { ERROR } from '@safra/contracts';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

/**
 * EC-010 tier 1 — «نسيت رقم الحجز».
 *
 * ## It answers the same thing to everybody, and so must this
 *
 * The API replies 202 whether the address holds forty bookings or none, because «does this person
 * have a booking» is the question the endpoint exists to refuse. This proxy must not undo that: it
 * forwards the status untouched and adds no body of its own. A 404 here, or a different shape for
 * the empty case, would rebuild the oracle one layer up.
 *
 * The client IP is forwarded so the API's throttle sees the real caller rather than this server —
 * without it, one visitor's rate limit would be shared by everybody.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: ERROR.REQUEST_MALFORMED_BODY }, { status: 400 });
  }

  const forwardedFor = request.headers.get('x-forwarded-for');

  try {
    const response = await fetch(`${API_URL}/api/v1/bookings/recover`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(forwardedFor ? { 'x-forwarded-for': forwardedFor } : {}),
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });

    return NextResponse.json(await response.json().catch(() => ({})), {
      status: response.status,
    });
  } catch {
    return NextResponse.json(
      { code: ERROR.REQUEST_UPSTREAM_UNREACHABLE },
      { status: 502 },
    );
  }
}
