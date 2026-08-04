import { NextResponse } from 'next/server';

import { proxy } from '@/lib/proxy';

/** Pauses or resumes a campaign. Audited by the API, because the advertiser paid for the window. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ reference: string }> },
): Promise<NextResponse> {
  const { reference } = await params;
  const body: unknown = await request.json().catch(() => null);

  if (typeof body !== 'object' || body === null || !('status' in body)) {
    return NextResponse.json({ message: 'A status is required.' }, { status: 400 });
  }

  return proxy(`/admin/ad-campaigns/${encodeURIComponent(reference)}/status`, {
    method: 'PATCH',
    body,
  });
}
