import { NextResponse } from 'next/server';

import { proxy } from '@/lib/proxy';

/** The partner's answer to a coupon. The API owns the «decided once» rule; this carries the token. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
): Promise<NextResponse> {
  const { code } = await params;
  const body: unknown = await request.json().catch(() => null);

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ message: 'A body is required.' }, { status: 400 });
  }

  return proxy(`/partner/coupons/${encodeURIComponent(code)}/decision`, {
    method: 'POST',
    body,
  });
}
