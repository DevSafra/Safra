import { NextResponse } from 'next/server';

import { partnerVerifySchema } from '@safra/contracts';

import { proxy } from '@/lib/proxy';

/**
 * Approve or reject a partner (§8.1).
 *
 * Validated against the shared schema here as well as at the API, so the mandatory
 * rejection note is enforced before a round trip — and, more usefully, so the
 * requirement lives in one place rather than being restated in the form.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ reference: string }> },
): Promise<NextResponse> {
  const { reference } = await params;

  const parsed = partnerVerifySchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? 'Invalid decision.' },
      { status: 400 },
    );
  }

  return proxy(`/admin/partners/${encodeURIComponent(reference)}/verify`, {
    method: 'POST',
    body: parsed.data,
  });
}
