import type { NextRequest } from 'next/server';

import { proxy } from '@/lib/proxy';

/**
 * Credits this booking's customer — `WALLET_ADJUST`. §9.4's «تعويض».
 *
 * Booking-shaped rather than wallet-shaped on purpose: the API resolves the customer from the
 * booking, so no internal profile id reaches the browser and the wallet transaction's note names
 * the stay it was for.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ reference: string }> },
) {
  const { reference } = await params;

  return proxy(`/admin/bookings/${encodeURIComponent(reference)}/compensate`, {
    method: 'POST',
    body: await request.json(),
  });
}
