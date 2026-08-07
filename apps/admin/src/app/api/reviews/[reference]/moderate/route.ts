import { NextResponse } from 'next/server';

import { ERROR, reviewModerateSchema } from '@safra/contracts';

import { proxy } from '@/lib/proxy';

/**
 * The staff decision on a reported review (§7.3, P-006).
 *
 * `uphold` hides it, `dismiss` leaves it published. There is no third option and no delete — the
 * table refuses one — so the route accepts exactly the two the schema names.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ reference: string }> },
): Promise<NextResponse> {
  const { reference } = await params;

  const parsed = reviewModerateSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json(
      { code: parsed.error.issues[0]?.message ?? ERROR.REQUEST_VALIDATION_FAILED },
      { status: 400 },
    );
  }

  return proxy(`/admin/reviews/${encodeURIComponent(reference)}/moderate`, {
    method: 'POST',
    body: parsed.data,
  });
}
