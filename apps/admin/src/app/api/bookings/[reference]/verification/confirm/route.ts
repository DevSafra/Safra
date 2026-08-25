import type { NextRequest } from 'next/server';

import { proxy } from '@/lib/proxy';

/** Step two — the caller read the code back. One answer for every failure; see the service. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ reference: string }> },
) {
  const { reference } = await params;

  return proxy(`/bookings/${encodeURIComponent(reference)}/verification/confirm`, {
    method: 'POST',
    body: await request.json(),
  });
}
