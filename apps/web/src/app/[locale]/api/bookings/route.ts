import { NextResponse } from 'next/server';
import { ERROR } from '@safra/contracts';

import { getSession } from '@/lib/session-server';

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
 *
 * ## The session travels with it — optionally (finding 213)
 *
 * `POST /bookings` is `@Public()` because §4 allows a Guest Customer to book with no account, and
 * its own comment says «a signed-in customer is still recognised — JwtAuthGuard decodes a token
 * when one is present — so their booking attaches to their existing profile». That was true of the
 * API and false of the platform: nothing ever sent a token, so EVERY booking arrived anonymous.
 *
 * Three things were wrong because of it, and all three are the same missing header:
 *
 * - The customer's profile was resolved by matching the posted EMAIL, so a booking attached to
 *   whichever profile that address belonged to rather than to the person who was signed in.
 * - `resolveCustomerProfile` could not honour an edit made at checkout, because it never knew
 *   there was an account to edit — the whole point of the finding.
 * - The audit row named `system` with a null actor for a booking a PERSON made (§15).
 *
 * Attached here rather than in the browser: the token lives in an HttpOnly cookie and must never
 * reach client JavaScript. Absent for a guest, which is the ordinary case this route must keep
 * serving — so this reads the session and forwards it if there is one, and never refuses.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const session = await getSession();

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
        ...(session ? { Authorization: `Bearer ${session.accessToken}` } : {}),
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
