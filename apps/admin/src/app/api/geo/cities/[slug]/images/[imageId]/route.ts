import type { NextResponse } from 'next/server';

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
