import type { NextRequest } from 'next/server';

import { proxy } from '@/lib/proxy';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;

  return proxy(`/admin/staff/${encodeURIComponent(userId)}/role`, {
    method: 'PATCH',
    body: await request.json(),
  });
}
