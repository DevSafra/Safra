import { NextResponse } from 'next/server';

import { unitCreateSchema } from '@safra/contracts';

import { proxy } from '@/lib/proxy';

/**
 * Adding a unit to an existing listing — the other half of the missing step (Bashar, 2026-09-04).
 *
 * A unit could only be created INLINE, as `initialUnits` on `POST /partner/properties`, so a
 * listing that arrived without one could never get one: الوحدات said «لا وحدات بعد.» and offered
 * nothing. **991 properties were in that state, 468 of them published** — live listings with no
 * price and no bookable unit, and no route by which their owner could fix it.
 *
 * Validated here as well as in the API, for the reason the PATCH handler beside it gives: parsing
 * at the edge lets the form say WHICH field is wrong, while the API's copy remains the one that
 * enforces. `.strict()` is what makes that worth doing — a smuggled field is rejected before a
 * round trip rather than after.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ reference: string }> },
): Promise<NextResponse> {
  const { reference } = await params;
  const body: unknown = await request.json().catch(() => null);
  const parsed = unitCreateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { code: parsed.error.issues[0]?.message ?? 'validation.failed' },
      { status: 400 },
    );
  }

  return proxy(`/partner/properties/${encodeURIComponent(reference)}/units`, {
    method: 'POST',
    body: parsed.data,
  });
}
