import { NextResponse } from 'next/server';

import { proxy } from '@/lib/proxy';

/**
 * Stands Emergency Mode down.
 *
 * DELETE with a body, which is unusual but correct here: the API requires a reason, and
 * deactivating is as consequential as activating — a region silently resuming trade with no
 * recorded justification is exactly the gap the audit log exists to close.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const body: unknown = await request.json().catch(() => null);

  if (typeof body !== 'object' || body === null || !('reason' in body)) {
    return NextResponse.json({ message: 'A reason is required.' }, { status: 400 });
  }

  return proxy(`/admin/emergency/${encodeURIComponent(id)}`, { method: 'DELETE', body });
}
