import { NextResponse } from 'next/server';

import { propertyReviewSchema } from '@safra/contracts';

import { proxy } from '@/lib/proxy';

/** Approve (publish) or reject a listing (§8.1, P-002). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ reference: string }> },
): Promise<NextResponse> {
  const { reference } = await params;

  const parsed = propertyReviewSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? 'Invalid decision.' },
      { status: 400 },
    );
  }

  return proxy(`/admin/properties/${encodeURIComponent(reference)}/review`, {
    method: 'POST',
    body: parsed.data,
  });
}
