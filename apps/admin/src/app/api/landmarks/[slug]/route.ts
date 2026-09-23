import { NextResponse } from 'next/server';

import { proxy } from '@/lib/proxy';

/** Editing a landmark — its names, its city, its kind, its position, or its visibility. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug } = await params;
  const body: unknown = await request.json().catch(() => null);

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ message: 'A body is required.' }, { status: 400 });
  }

  return proxy(`/admin/landmarks/${encodeURIComponent(slug)}`, { method: 'PATCH', body });
}

/**
 * Archiving one. The row is kept — see the service — because a distance a guest read last week
 * was measured against it and a support conversation needs it to still exist.
 *
 * No body and no query: the segment IS the whole request, so there is nothing for a caller to
 * shape. The audit entry lives in the service, inside the same transaction as the write.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug } = await params;

  return proxy(`/admin/landmarks/${encodeURIComponent(slug)}`, { method: 'DELETE' });
}
