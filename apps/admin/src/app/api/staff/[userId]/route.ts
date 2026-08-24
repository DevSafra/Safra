import type { NextRequest } from 'next/server';

import { proxy } from '@/lib/proxy';

/**
 * Renames a staff member — `PATCH /admin/staff/:userId`, `{ fullName }`.
 *
 * Its own route rather than a field on the role patch: naming somebody is not changing their
 * authority, and folding the two together would mean sending a role to correct a spelling. The
 * server validates the body and enforces the permission; this only carries it.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;

  return proxy(`/admin/staff/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    body: await request.json(),
  });
}
