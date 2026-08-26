import type { NextRequest } from 'next/server';

import { proxy } from '@/lib/proxy';

/**
 * Issues a gift card — `GIFT_CARD_MANAGE`. §9.3's «+ إنشاء بطاقة هدية».
 *
 * The response carries the CODE, once. It is not stored anywhere and cannot be looked up again, so
 * nothing here may log the body — `proxy` passes it through and the form shows it to the person who
 * pressed the button.
 */
export async function POST(request: NextRequest) {
  return proxy('/admin/gift-cards', {
    method: 'POST',
    body: await request.json(),
  });
}
