import { NextResponse, type NextRequest } from 'next/server';

import { ERROR } from '@safra/contracts';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

/**
 * Prices a coupon code against a stay, before the customer commits.
 *
 * Through our own route handler rather than the API directly, like the booking POST beside it:
 * that keeps the API origin out of the browser and lets the server attach the real client IP, which
 * is what the API's throttle counts against. A coupon code is short and shareable, so this endpoint
 * is somewhere a person could hunt for live campaign codes — the throttle is the answer, and it
 * only works if the address reaching it is the customer's.
 *
 * Nothing is written and nothing is reserved: the redemption happens when the booking is created,
 * under the coupon's row lock.
 */
export async function POST(request: NextRequest) {
  /*
    Read first, apart from the upstream call (audit 2026-10-04): a malformed body is the caller's
    fault, a coded 400, not the 502 «could not reach the server» the catch below means.
  */
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ code: ERROR.REQUEST_MALFORMED_BODY }, { status: 400 });
  }

  try {
    const response = await fetch(`${API_URL}/api/v1/bookings/coupon-preview`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        /* Only when present: an empty header would look like a real one to the throttle. */
        ...(request.headers.get('x-forwarded-for')
          ? { 'x-forwarded-for': request.headers.get('x-forwarded-for') as string }
          : {}),
      },
      body: JSON.stringify(payload),
    });

    const body: unknown = await response.json().catch(() => null);

    return NextResponse.json(body, { status: response.status });
  } catch {
    /* The message the customer sees comes from the catalogue, never from here. */
    return NextResponse.json({ message: 'coupon.invalid' }, { status: 502 });
  }
}
