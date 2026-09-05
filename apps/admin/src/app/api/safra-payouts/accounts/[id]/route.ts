import { NextResponse } from 'next/server';

import { safraPayoutAccountUpdateSchema } from '@safra/contracts';

import { proxy } from '@/lib/proxy';

/** Editing a destination, and removing one nothing has been sent to. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const parsed = safraPayoutAccountUpdateSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!parsed.success) {
    return NextResponse.json(
      { code: parsed.error.issues[0]?.message ?? 'validation.failed' },
      { status: 400 },
    );
  }

  return proxy(`/admin/safra-payouts/accounts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: parsed.data,
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  return proxy(`/admin/safra-payouts/accounts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
