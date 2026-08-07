import { NextResponse } from 'next/server';

import { ERROR, propertyCreateSchema } from '@safra/contracts';

import { proxy } from '@/lib/proxy';

/**
 * Creating a listing (§7.2).
 *
 * Validated against the shared schema here as well as at the API, so the trip-attribute vocabulary
 * and the field limits are enforced before a round trip — and, more usefully, so they live in one
 * place rather than being restated in the form.
 *
 * Note what the schema does NOT accept: `status`. A partner cannot publish their own listing; the
 * service forces `draft` and P-002 puts SAFRA's review between the two. That is a barrier in the
 * service rather than a rule this route repeats.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const parsed = propertyCreateSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json(
      { code: parsed.error.issues[0]?.message ?? ERROR.REQUEST_VALIDATION_FAILED },
      { status: 400 },
    );
  }

  return proxy('/partner/properties', { method: 'POST', body: parsed.data });
}
