import type { NextRequest } from 'next/server';

import { proxy } from '@/lib/proxy';

/**
 * Suspends a partner — `PARTNER_SUSPEND`, reason required. Stops NEW trade: listings leave search, no new bookings, payouts frozen. Confirmed bookings continue and the partner can still sign in and read why.
 *
 * The reason floor, the permission and the conflict rules are all the API's. This carries the body
 * and nothing else — a BFF route that validated would be a second opinion about what is allowed.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ reference: string }> },
) {
  const { reference } = await params;

  return proxy(`/admin/partners/${encodeURIComponent(reference)}/suspend`, {
    method: 'POST',
    body: await request.json(),
  });
}
