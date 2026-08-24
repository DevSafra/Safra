import type { NextRequest } from 'next/server';

import { proxy } from '@/lib/proxy';

/**
 * Sets one staff member's scope — `PUT /admin/staff/:userId/scope`.
 *
 * `PUT`, not `PATCH`, because the API takes the WHOLE scope: kind, cities and outside-access
 * together. That is why the form sends the current `outside` back even when it has not changed —
 * a partial submission would reset the half it omitted.
 *
 * Narrowing a scope revokes the member's sessions immediately; the server does that, not this.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;

  return proxy(`/admin/staff/${encodeURIComponent(userId)}/scope`, {
    method: 'PUT',
    body: await request.json(),
  });
}
