import { NextResponse } from 'next/server';

import { ERROR, partnerDisputeResponseSchema } from '@safra/contracts';

import { proxy } from '@/lib/proxy';

/**
 * The partner's account of the night, sent to the case file (finding 223).
 *
 * Nothing here names the partner. The API takes the business from the verified token, so «answer a
 * dispute against somebody else» is not a request this can express — the same shape as every other
 * write in this folder.
 *
 * Validated against the shared schema before the round trip so a two-word response answers from
 * here rather than costing one. The API validates it again; this is a courtesy, not the boundary.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ reference: string }> },
): Promise<NextResponse> {
  const { reference } = await params;
  const parsed = partnerDisputeResponseSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!parsed.success) {
    return NextResponse.json(
      { code: parsed.error.issues[0]?.message ?? ERROR.REQUEST_VALIDATION_FAILED },
      { status: 400 },
    );
  }

  /*
    Encoded, not interpolated raw: the value reaches a URL, and a segment carrying a `/` would
    address a different route than the one this file names. The API validates the reference against
    the dispute it owns regardless, so a crafted one answers 404 rather than reaching anything.
  */
  return proxy(`/partner/disputes/${encodeURIComponent(reference)}/responses`, {
    method: 'POST',
    body: parsed.data,
  });
}
