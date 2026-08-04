import { NextResponse } from 'next/server';

import { proxy } from '@/lib/proxy';

/**
 * Posts a staff reply into a three-party thread.
 *
 * The body is NOT redacted here. Contact-detail blocking happens in the API, on the way into the
 * database, so a client that skipped this route cannot bypass it — which is the whole point of
 * putting the rule at the write boundary rather than in the UI.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ reference: string }> },
): Promise<NextResponse> {
  const { reference } = await params;
  const body: unknown = await request.json().catch(() => null);

  if (typeof body !== 'object' || body === null || !('body' in body)) {
    return NextResponse.json({ message: 'A message body is required.' }, { status: 400 });
  }

  return proxy(`/admin/conversations/${encodeURIComponent(reference)}/reply`, {
    method: 'POST',
    body,
  });
}
