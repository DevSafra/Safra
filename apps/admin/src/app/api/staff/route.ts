import type { NextRequest } from 'next/server';

import { jsonBody, proxy } from '@/lib/proxy';

export async function POST(request: NextRequest) {
  return proxy('/admin/staff', { method: 'POST', body: await jsonBody(request) });
}
