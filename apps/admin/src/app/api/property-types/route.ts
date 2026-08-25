import type { NextResponse } from 'next/server';

import { proxy } from '@/lib/proxy';

/** §8.2 — adding an accommodation type. The API validates the body; this only carries it. */
export async function POST(request: Request): Promise<NextResponse> {
  return proxy('/admin/property-types', {
    method: 'POST',
    body: (await request.json()) as unknown,
  });
}
