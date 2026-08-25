import type { NextResponse } from 'next/server';

import { proxy } from '@/lib/proxy';

/** §8.2 — retiring a type, or bringing it back. Never a delete; see the controller. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
): Promise<NextResponse> {
  const { code } = await params;

  return proxy(`/admin/property-types/${encodeURIComponent(code)}`, {
    method: 'PATCH',
    body: (await request.json()) as unknown,
  });
}
