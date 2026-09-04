import { NextResponse } from 'next/server';

import { ERROR, payoutAccountInputSchema } from '@safra/contracts';

import { proxy } from '@/lib/proxy';

/** Correcting one's own details. A material change returns the account to review. */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const parsed = payoutAccountInputSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!parsed.success) {
    return NextResponse.json({ code: ERROR.REQUEST_VALIDATION_FAILED }, { status: 400 });
  }

  return proxy(`/partner/payout-accounts/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: parsed.data,
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  return proxy(`/partner/payout-accounts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
