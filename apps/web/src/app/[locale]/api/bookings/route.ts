import { NextResponse } from 'next/server';
import { ERROR } from '@safra/contracts';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

/**
 * Server-side proxy for booking creation.
 *
 * The browser never talks to the API directly. That matters for two reasons: the API
 * origin and any future credentials stay server-side, and the real client IP can be
 * forwarded — the API records it on the booking for §15's audit trail, and it would
 * otherwise see only the Next server's address.
 *
 * The body is passed through untouched. Validating here would duplicate the Zod
 * schema the API already enforces, and two copies of a validation rule drift.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: ERROR.REQUEST_MALFORMED_BODY }, { status: 400 });
  }

  const forwardedFor = request.headers.get('x-forwarded-for');
  const userAgent = request.headers.get('user-agent');

  try {
    const response = await fetch(`${API_URL}/api/v1/bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(forwardedFor ? { 'x-forwarded-for': forwardedFor } : {}),
        ...(userAgent ? { 'user-agent': userAgent } : {}),
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });

    const payload: unknown = await response.json().catch(() => null);

    // The API's status and shape pass straight through, so the form can distinguish
    // a 409 (dates taken) from a 400 (validation) without a translation layer.
    return NextResponse.json(payload, { status: response.status });
  } catch {
    return NextResponse.json(
      { code: ERROR.REQUEST_UPSTREAM_UNREACHABLE },
      { status: 502 },
    );
  }
}
