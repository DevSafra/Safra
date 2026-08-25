import type { NextRequest } from 'next/server';

import { proxy } from '@/lib/proxy';

/**
 * What a refund would return, and then issuing it (§7.4) — `REFUND_READ` / `REFUND_CREATE`.
 *
 * ## Two capabilities, two methods, one file
 *
 * GET quotes and POST issues, and §4 draws the line between them deliberately: a support agent may
 * answer «how much do I get back?» and must escalate to finance to actually send it. The API
 * enforces that; this file only routes.
 *
 * ## The amount is never sent
 *
 * `RefundService` computes it from the cancellation policy the customer agreed to, snapshotted on
 * the booking. Accepting a figure here would let a mistake — or a compromised staff session —
 * choose one.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ reference: string }> },
) {
  const { reference } = await params;

  return proxy(`/payments/${encodeURIComponent(reference)}/refund-quote`, {
    method: 'GET',
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ reference: string }> },
) {
  const { reference } = await params;

  return proxy(`/payments/${encodeURIComponent(reference)}/refund`, {
    method: 'POST',
    body: await request.json(),
  });
}
