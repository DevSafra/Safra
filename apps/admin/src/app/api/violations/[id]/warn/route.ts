import type { NextRequest } from 'next/server';

import { proxy } from '@/lib/proxy';

/**
 * Warns the partner — `VIOLATION_MANAGE`. 'Recorded' means it happened; 'warned' means somebody TOLD them, which is the fact an appeal turns on.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  return proxy(`/admin/violations/${encodeURIComponent(id)}/warn`, {
    method: 'POST',
    body: await request.json(),
  });
}
