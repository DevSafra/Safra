import type { NextResponse } from 'next/server';

import { proxy } from '@/lib/proxy';

/**
 * Closing a support request.
 *
 * No body to validate — the reference in the path is the whole request, and the API takes the owner
 * from the session rather than from anything sent. So unlike its `reply` sibling there is no schema
 * step: there is nothing here a caller could put in a body that would be read.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ reference: string }> },
): Promise<NextResponse> {
  const { reference } = await params;

  return proxy(`/support/${encodeURIComponent(reference)}/close`, { method: 'POST' });
}
