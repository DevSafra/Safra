import { NextResponse } from 'next/server';

import { ERROR, supportReplySchema } from '@safra/contracts';

import { proxy } from '@/lib/proxy';

/** Replying to a support request. Same rules as opening one — see the sibling route. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ reference: string }> },
): Promise<NextResponse> {
  const parsed = supportReplySchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json(
      { code: parsed.error.issues[0]?.message ?? ERROR.REQUEST_VALIDATION_FAILED },
      { status: 400 },
    );
  }

  const { reference } = await params;

  return proxy(`/support/${encodeURIComponent(reference)}/reply`, {
    method: 'POST',
    body: parsed.data,
  });
}
