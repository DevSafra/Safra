import type { NextRequest } from 'next/server';

import { proxy } from '@/lib/proxy';

/** Creates an advertiser — `AD_MANAGE`. The business that pays, not a partner who sells. */
export async function POST(request: NextRequest) {
  return proxy('/admin/advertisers', { method: 'POST', body: await request.json() });
}
