import { NextResponse } from 'next/server';

import { proxy } from '@/lib/proxy';

/** Renaming a kind, redrawing its icon, or deactivating it. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
): Promise<NextResponse> {
  const { code } = await params;
  const body: unknown = await request.json().catch(() => null);

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ message: 'A body is required.' }, { status: 400 });
  }

  return proxy(`/admin/landmarks/kinds/${encodeURIComponent(code)}`, {
    method: 'PATCH',
    body,
  });
}

/**
 * Archiving a kind — which the API refuses while any landmark still uses it, and says so in a
 * sentence rather than a constraint violation.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ code: string }> },
): Promise<NextResponse> {
  const { code } = await params;

  return proxy(`/admin/landmarks/kinds/${encodeURIComponent(code)}`, {
    method: 'DELETE',
  });
}
