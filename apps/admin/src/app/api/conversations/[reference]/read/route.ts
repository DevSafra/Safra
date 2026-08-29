import type { NextResponse } from 'next/server';

import { proxy } from '@/lib/proxy';

/**
 * «An agent has read this thread» — what brings the الرسائل badge down.
 *
 * Posted by the thread screen once it has actually rendered, never from the page's own GET: Next
 * prefetches a link the mouse passes over, and a prefetch is not somebody reading.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ reference: string }> },
): Promise<NextResponse> {
  const { reference } = await params;

  return proxy(`/admin/conversations/${encodeURIComponent(reference)}/read`, {
    method: 'POST',
  });
}
