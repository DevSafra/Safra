import type { NextRequest } from 'next/server';

import { proxy } from '@/lib/proxy';

/**
 * SAFRA confirms on the partner's behalf (§6.3 step 7) — `BOOKING_UPDATE_STATUS`.
 *
 * Not `partner-decision`: that route needs a partner id from the token and answers AS the partner.
 * This is SAFRA exercising the position §6.3 gives it in the middle of the confirmation, which is
 * why the transition table has named `staff` on this edge since it was written.
 *
 * The reason is required and it is the point — a booking confirmed by the platform rather than by
 * the business hosting the stay is an exception, and one nobody can explain later is one nobody
 * should be able to make.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ reference: string }> },
) {
  const { reference } = await params;

  return proxy(`/bookings/${encodeURIComponent(reference)}/staff-confirm`, {
    method: 'POST',
    body: await request.json(),
  });
}
