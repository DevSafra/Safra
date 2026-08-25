import type { NextRequest } from 'next/server';

import { proxy } from '@/lib/proxy';

/**
 * Staff cancellation of a live booking (§9.4) — `BOOKING_CANCEL`.
 *
 * NOT under `/admin`: the endpoint is `POST /bookings/:reference/cancel`, the same route a
 * customer's own cancellation takes, separated by permission and by the `staff` actor the
 * controller passes. One cancellation path means one set of ledger, timeline and refund
 * consequences, rather than a staff copy that drifts from the customer one.
 *
 * The reason is required by `bookingCancelSchema` and is stored verbatim: it is a person's
 * statement about a booking, and the customer reads it.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ reference: string }> },
) {
  const { reference } = await params;

  return proxy(`/bookings/${encodeURIComponent(reference)}/cancel`, {
    method: 'POST',
    body: await request.json(),
  });
}
