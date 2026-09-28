import { NextResponse } from 'next/server';

import { ERROR, groupTripUpdateSchema } from '@safra/contracts';

import { proxy } from '@/lib/proxy';

/**
 * Editing and removing an announced trip.
 *
 * The slug lands in an upstream path, so its SHAPE is checked here rather than forwarded: a
 * segment taken from the request and pasted into a URL is how `/admin/group-trips/../../partners`
 * gets reached. The pattern is the one the contract mints, and it cannot express a traversal.
 */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function pathFor(slug: string): string | null {
  return SLUG.test(slug) && slug.length <= 80 ? `/admin/group-trips/${slug}` : null;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug } = await params;
  const path = pathFor(slug);

  if (!path) return new NextResponse(null, { status: 404 });

  const parsed = groupTripUpdateSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json(
      { code: parsed.error.issues[0]?.message ?? ERROR.REQUEST_VALIDATION_FAILED },
      { status: 400 },
    );
  }

  return proxy(path, { method: 'PATCH', body: parsed.data });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug } = await params;
  const path = pathFor(slug);

  if (!path) return new NextResponse(null, { status: 404 });

  return proxy(path, { method: 'DELETE' });
}
