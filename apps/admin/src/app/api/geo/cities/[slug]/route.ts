import { NextResponse } from 'next/server';

import { proxy } from '@/lib/proxy';

/** Correcting a city, or closing it. `isActive: false` is how a market closes — nothing deletes. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug } = await params;
  const body: unknown = await request.json().catch(() => null);

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ message: 'A body is required.' }, { status: 400 });
  }

  return proxy(`/admin/geo/cities/${encodeURIComponent(slug)}`, {
    method: 'PATCH',
    body,
  });
}
