import { NextResponse } from 'next/server';

import { ERROR, propertyImageAltSchema } from '@safra/contracts';

import { proxy } from '@/lib/proxy';

/**
 * One image: make it the cover, describe it, or archive it.
 *
 * `POST` is the cover because setting one is not idempotent in the way PUT promises — it clears
 * whichever image held it. `DELETE` archives; nothing here removes anything, and the API would
 * refuse if it tried.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ reference: string; imageId: string }> },
): Promise<NextResponse> {
  const { reference, imageId } = await params;

  return proxy(
    `/partner/properties/${encodeURIComponent(reference)}/images/${encodeURIComponent(imageId)}/cover`,
    { method: 'POST' },
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ reference: string; imageId: string }> },
): Promise<NextResponse> {
  const { reference, imageId } = await params;

  const parsed = propertyImageAltSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json(
      { code: parsed.error.issues[0]?.message ?? ERROR.REQUEST_VALIDATION_FAILED },
      { status: 400 },
    );
  }

  return proxy(
    `/partner/properties/${encodeURIComponent(reference)}/images/${encodeURIComponent(imageId)}/alt`,
    { method: 'PATCH', body: parsed.data },
  );
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ reference: string; imageId: string }> },
): Promise<NextResponse> {
  const { reference, imageId } = await params;

  return proxy(
    `/partner/properties/${encodeURIComponent(reference)}/images/${encodeURIComponent(imageId)}`,
    { method: 'DELETE' },
  );
}
