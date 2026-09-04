import { NextResponse } from 'next/server';

import { proxy } from '@/lib/proxy';

/**
 * A reviewer setting or correcting a listing's star classification.
 *
 * The body is forwarded unread: `propertyStarRatingSchema` in the API bounds it to 1-5 and the
 * database has a CHECK behind that, so a rule restated here would be a third copy to keep in step
 * and the one an attacker skips by calling the API directly.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ reference: string }> },
): Promise<NextResponse> {
  const { reference } = await params;
  const body: unknown = await request.json().catch(() => null);

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ message: 'A body is required.' }, { status: 400 });
  }

  return proxy(`/admin/properties/${encodeURIComponent(reference)}/star-rating`, {
    method: 'PUT',
    body,
  });
}
