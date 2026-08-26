import type { NextRequest } from 'next/server';

import { proxy } from '@/lib/proxy';

/** Creates a campaign — `AD_MANAGE`. Issues its invoices in the same transaction. */
export async function POST(request: NextRequest) {
  return proxy('/admin/ad-campaigns', { method: 'POST', body: await request.json() });
}
