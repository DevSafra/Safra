import type { NextRequest } from 'next/server';

import { proxy } from '@/lib/proxy';

/**
 * Opens a dispute on this booking — `DISPUTE_MANAGE`. §9.4's «فتح نزاع».
 *
 * The reference comes from the ROUTE, not the body, and the two are reconciled here rather than
 * trusted: the screen knows which booking it is displaying, so a body naming a different one is
 * not a request this can express.
 *
 * Opening one freezes the partner's payout for the booking and moves it to `disputed` — see
 * `DisputeService.openForBooking`.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ reference: string }> },
) {
  const { reference } = await params;
  const body: unknown = await request.json();

  return proxy('/admin/disputes', {
    method: 'POST',
    body: { ...(body as Record<string, unknown>), bookingReference: reference },
  });
}
