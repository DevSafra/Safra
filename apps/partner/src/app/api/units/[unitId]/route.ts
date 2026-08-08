import { NextResponse } from 'next/server';

import { unitUpdateSchema } from '@safra/contracts';

import { proxy } from '@/lib/proxy';

/**
 * Editing one unit.
 *
 * The API scopes the unit to the partner in the verified token and answers 404 for somebody else's
 * — this handler deliberately does not check ownership, because a second opinion here would be a
 * check that can drift from the one that actually decides.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ unitId: string }> },
): Promise<NextResponse> {
  const { unitId } = await params;
  const body: unknown = await request.json().catch(() => null);
  const parsed = unitUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { code: parsed.error.issues[0]?.message ?? 'validation.failed' },
      { status: 400 },
    );
  }

  return proxy(`/partner/units/${encodeURIComponent(unitId)}`, {
    method: 'PATCH',
    body: parsed.data,
  });
}
