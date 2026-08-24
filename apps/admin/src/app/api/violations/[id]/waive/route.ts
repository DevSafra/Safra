import type { NextRequest } from 'next/server';

import { proxy } from '@/lib/proxy';

/**
 * Waives a fine — `VIOLATION_WAIVE` ALONE, not `VIOLATION_MANAGE`. Forgiving money is a different authority from recording an offence. It carries a reason and no amount: a waiver is always the whole fine, and the API takes the figure from the stored row so the pair cannot drift.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  return proxy(`/admin/violations/${encodeURIComponent(id)}/waive`, {
    method: 'POST',
    body: await request.json(),
  });
}
