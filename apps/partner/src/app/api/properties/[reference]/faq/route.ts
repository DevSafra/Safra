import { NextResponse } from 'next/server';

import { ERROR, propertyFaqAnswersSchema } from '@safra/contracts';

import { proxy } from '@/lib/proxy';

/**
 * Saving this listing's answers to SAFRA's questions (Bashar, 2026-09-28).
 *
 * Parsed here as well as at the API so the form can name the field that is wrong rather than show
 * a bare 400 — the same division every write in this app makes. The API validates on its own
 * authority and resolves the property against the caller's own partner; nothing about ownership is
 * decided here, and the `reference` below is forwarded rather than trusted.
 *
 * `PUT`, not `PATCH`: the body is the complete set of answers the form is showing, so the request
 * is «these are the answers» rather than «change this one». That also makes it idempotent, which a
 * form somebody double-submits wants to be.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ reference: string }> },
): Promise<NextResponse> {
  const { reference } = await params;
  const parsed = propertyFaqAnswersSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!parsed.success) {
    return NextResponse.json(
      { code: parsed.error.issues[0]?.message ?? ERROR.REQUEST_VALIDATION_FAILED },
      { status: 400 },
    );
  }

  return proxy(`/partner/properties/${encodeURIComponent(reference)}/faq`, {
    method: 'PUT',
    body: parsed.data,
  });
}
