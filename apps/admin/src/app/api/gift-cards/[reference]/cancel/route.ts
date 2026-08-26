import type { NextRequest } from 'next/server';

import { proxy } from '@/lib/proxy';

/** Voids a live card — `GIFT_CARD_MANAGE`. §9.3's «إلغاء». */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ reference: string }> },
) {
  const { reference } = await params;

  return proxy(`/admin/gift-cards/${encodeURIComponent(reference)}/cancel`, {
    method: 'POST',
    body: await request.json(),
  });
}
