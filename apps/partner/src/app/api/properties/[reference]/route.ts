import { NextResponse } from 'next/server';

import { propertyUpdateSchema } from '@safra/contracts';

import { proxy } from '@/lib/proxy';

/**
 * Saving the تعديل form.
 *
 * Validated HERE as well as in the API, and the duplication is deliberate: a body that fails
 * `.strict()` upstream comes back as a 400 the form has to translate, whereas parsing it at the
 * edge lets the browser be told which field is wrong. The API's copy is the one that ENFORCES —
 * this one only improves the message — which is why this handler cannot be the only check and is
 * not written as though it were.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ reference: string }> },
): Promise<NextResponse> {
  const { reference } = await params;
  const body: unknown = await request.json().catch(() => null);
  const parsed = propertyUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { code: parsed.error.issues[0]?.message ?? 'validation.failed' },
      { status: 400 },
    );
  }

  return proxy(`/partner/properties/${encodeURIComponent(reference)}`, {
    method: 'PATCH',
    body: parsed.data,
  });
}
