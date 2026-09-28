import { NextResponse } from 'next/server';

import { ERROR, groupTripCreateSchema } from '@safra/contracts';

import { proxy } from '@/lib/proxy';

/**
 * Announcing a trip — جروبات (Bashar, 2026-09-27).
 *
 * Parsed here as well as at the API so the form can name the field that is wrong rather than show
 * a bare 400. The API validates on its own authority; this is the edge, not the gate.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const parsed = groupTripCreateSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json(
      { code: parsed.error.issues[0]?.message ?? ERROR.REQUEST_VALIDATION_FAILED },
      { status: 400 },
    );
  }

  return proxy('/admin/group-trips', { method: 'POST', body: parsed.data });
}
