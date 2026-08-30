import type { NextResponse } from 'next/server';

import { proxy } from '@/lib/proxy';

/**
 * Retiring one photograph from a dispute — «حذف».
 *
 * A thin proxy, and no body: the evidence id is the only thing the caller names, and the API
 * resolves it inside the reader's own cities, so an id from a dispute they cannot open answers
 * exactly as one that does not exist.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ evidenceId: string }> },
): Promise<NextResponse> {
  const { evidenceId } = await params;

  return proxy(`/admin/disputes/evidence/${encodeURIComponent(evidenceId)}`, {
    method: 'DELETE',
  });
}
