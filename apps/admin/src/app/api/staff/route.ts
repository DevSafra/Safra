import type { NextRequest } from 'next/server';

import { proxy } from '@/lib/proxy';

export async function POST(request: NextRequest) {
  return proxy('/admin/staff', { method: 'POST', body: await request.json() });
}
