import type { NextResponse } from 'next/server';

import { proxy } from '@/lib/proxy';

/**
 * Taking a dispute for review — «قيد المراجعة».
 *
 * A thin proxy, and no body: the endpoint takes no user id and writes `claims.sub` itself, so
 * «which staff member is this assigned to» is a question the API cannot be asked. The reference is
 * the only thing the caller names, and the API resolves it inside the reader's own scope.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ reference: string }> },
): Promise<NextResponse> {
  const { reference } = await params;

  return proxy(`/admin/disputes/${encodeURIComponent(reference)}/acknowledge`, {
    method: 'POST',
  });
}
