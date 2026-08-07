import { NextResponse } from 'next/server';

import { partnerTwoFactorResetSchema } from '@safra/contracts';

import { proxy } from '@/lib/proxy';

/**
 * Clear a partner's second factor so they can enrol a new authenticator.
 *
 * Validated against the shared schema here as well as at the API, so the mandatory reason is
 * enforced before a round trip — and, more usefully, so the requirement lives in one place rather
 * than being restated in the form.
 *
 * This route holds no authority of its own: `proxy` forwards the staff session and the API decides
 * whether the caller holds `partner.two_factor_reset` and whether the target is a partner at all.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ reference: string }> },
): Promise<NextResponse> {
  const { reference } = await params;

  const parsed = partnerTwoFactorResetSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? 'Invalid request.' },
      { status: 400 },
    );
  }

  return proxy(`/admin/partners/${encodeURIComponent(reference)}/two-factor/reset`, {
    method: 'POST',
    body: parsed.data,
  });
}
