import type { NextRequest } from 'next/server';

import { proxy } from '@/lib/proxy';

/**
 * Attaches a fine — `VIOLATION_MANAGE`.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  return proxy(`/admin/violations/${encodeURIComponent(id)}/fine`, {
    method: 'POST',
    body: await request.json(),
  });
}
