import type { NextResponse } from 'next/server';

import { proxy } from '@/lib/proxy';

/**
 * Ending a thread from the console — «إنهاء المحادثة».
 *
 * A thin proxy, and no body: the reference is the only thing the caller names, and the API resolves
 * it inside the reader's own scope, so a thread in a city this agent does not hold answers exactly
 * as one that does not exist.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ reference: string }> },
): Promise<NextResponse> {
  const { reference } = await params;

  return proxy(`/admin/conversations/${encodeURIComponent(reference)}/close`, {
    method: 'POST',
  });
}
