import type { NextResponse } from 'next/server';

import { proxy } from '@/lib/proxy';

/** Approving an account — the only thing that makes a partner's payouts releasable. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  return proxy(`/admin/payout-accounts/${encodeURIComponent(id)}/verify`, {
    method: 'POST',
  });
}
