import type { NextRequest } from 'next/server';

import { proxy } from '@/lib/proxy';

/** Creates a coupon — `COUPON_MANAGE`. §9.3's «+ كوبون جديد». */
export async function POST(request: NextRequest) {
  return proxy('/admin/coupons', { method: 'POST', body: await request.json() });
}
