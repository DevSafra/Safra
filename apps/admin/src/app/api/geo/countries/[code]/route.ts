import { NextResponse } from 'next/server';

import { proxy } from '@/lib/proxy';

/** Correcting a countries row, or deactivating it. Nothing deletes — see `GeoWriteService`. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
): Promise<NextResponse> {
  const { code } = await params;
  const body: unknown = await request.json().catch(() => null);

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ message: 'A body is required.' }, { status: 400 });
  }

  return proxy(`/admin/geo/countries/${encodeURIComponent(code)}`, {
    method: 'PATCH',
    body,
  });
}
