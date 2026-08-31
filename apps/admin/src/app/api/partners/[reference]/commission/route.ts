import { NextResponse } from 'next/server';

import { proxy } from '@/lib/proxy';

/** A partner's negotiated commission. The API owns the bounds; this carries the bearer. */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ reference: string }> },
): Promise<NextResponse> {
  const { reference } = await params;
  const body: unknown = await request.json().catch(() => null);

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ message: 'A body is required.' }, { status: 400 });
  }

  return proxy(`/admin/partners/${encodeURIComponent(reference)}/commission`, {
    method: 'PUT',
    body,
  });
}
