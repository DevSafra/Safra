import { NextResponse } from 'next/server';

import { proxy } from '@/lib/proxy';

/** Retiring a city photograph. A soft delete (P-003) — the row stays, the picture stops showing. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ slug: string; imageId: string }> },
): Promise<NextResponse> {
  const { slug, imageId } = await params;

  return proxy(
    `/admin/cities/${encodeURIComponent(slug)}/images/${encodeURIComponent(imageId)}`,
    { method: 'DELETE' },
  );
}

/**
 * What a photograph says — its alt text, its credit, its place in the order, and whether §5.4's
 * hero band draws it. Never its bytes: those are the worker's, and the schema refuses them.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string; imageId: string }> },
): Promise<NextResponse> {
  const { slug, imageId } = await params;
  const body: unknown = await request.json().catch(() => null);

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ message: 'A body is required.' }, { status: 400 });
  }

  return proxy(
    `/admin/cities/${encodeURIComponent(slug)}/images/${encodeURIComponent(imageId)}`,
    { method: 'PATCH', body },
  );
}
