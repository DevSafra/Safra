import { NextResponse } from 'next/server';

import { proxy } from '@/lib/proxy';

/** Correcting a currencies row, or deactivating it. Nothing deletes — see `GeoWriteService`. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
): Promise<NextResponse> {
  const { code } = await params;
  const body: unknown = await request.json().catch(() => null);

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ message: 'A body is required.' }, { status: 400 });
  }

  return proxy(`/admin/geo/currencies/${encodeURIComponent(code)}`, {
    method: 'PATCH',
    body,
  });
}

/**
 * Removing the row entirely — which the API allows only when nothing points at it.
 *
 * No body and no query: the segment IS the whole request, so there is nothing here for a caller to
 * shape. The reference check, the refusal that names how many records are holding it, and the
 * audit entry all live in the service; this hands over the staff bearer and nothing else.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ code: string }> },
): Promise<NextResponse> {
  const { code } = await params;

  return proxy(`/admin/geo/currencies/${encodeURIComponent(code)}`, { method: 'DELETE' });
}
