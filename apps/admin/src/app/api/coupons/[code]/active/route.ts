import type { NextRequest } from 'next/server';

import { proxy } from '@/lib/proxy';

/** Pauses or resumes a coupon — `COUPON_MANAGE`, without touching its dates. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;

  return proxy(`/admin/coupons/${encodeURIComponent(code)}/active`, {
    method: 'POST',
    body: await request.json(),
  });
}
