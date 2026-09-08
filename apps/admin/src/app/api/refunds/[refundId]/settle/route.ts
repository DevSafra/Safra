import type { NextResponse } from 'next/server';

import { proxy } from '@/lib/proxy';

/**
 * Finance confirming an offline refund has actually been sent (finding 222).
 *
 * Bashar's decision, 2026-09-08: *«an offline refund must have an equivalent completion step, just
 * like a payment capture»*, and he called it a launch blocker. The mirror of «تأكيد استلام الحوالة»:
 * that one records money arriving on a rail that cannot report for itself, this one records money
 * leaving on the same kind of rail — and posts the reversal of the partner's payable and SAFRA's
 * commission that the webhook would otherwise have posted.
 *
 * ## No body, so nothing to validate here
 *
 * The refund is named in the path and everything else is decided server-side: whether it is still
 * `processing`, whether its rail is one a person may confirm, and what the reversal comes to. There
 * is no shape to check before the round trip.
 *
 * The API's `REFUND_CREATE` guard is the control. This route cannot grant what the session does not
 * carry, and a caller without it gets the API's refusal rather than a screen that pretended.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ refundId: string }> },
): Promise<NextResponse> {
  const { refundId } = await params;

  /*
    Encoded, not interpolated raw. The value reaches a URL, and a path segment carrying a `/` or a
    `?` would address a different route than the one this file names — the API validates it as a
    UUID regardless, so a malformed id is refused there rather than reaching a query.
  */
  return proxy(`/payments/refunds/${encodeURIComponent(refundId)}/settle`, {
    method: 'POST',
  });
}
