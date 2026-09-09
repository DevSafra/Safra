import type { NextRequest } from 'next/server';

import { proxy } from '@/lib/proxy';

/**
 * Puts one undelivered notice back on the queue — `NOTIFICATION_REDRIVE`.
 *
 * The API decides what may be re-driven: `sent` and `delivered` rows are excluded there by a
 * `WHERE` clause, so a delivered notice answers exactly like one that does not exist and nobody
 * can use this to send a second copy of a message somebody already received.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  return proxy(`/admin/comms/notifications/${encodeURIComponent(id)}/redrive`, {
    method: 'POST',
  });
}
