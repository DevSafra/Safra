import { NextResponse } from 'next/server';

import { proxy } from '@/lib/proxy';

/** Refusing an account, with the reason the partner will read. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const body: unknown = await request.json().catch(() => null);

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ message: 'A body is required.' }, { status: 400 });
  }

  return proxy(`/admin/payout-accounts/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
    body,
  });
}
