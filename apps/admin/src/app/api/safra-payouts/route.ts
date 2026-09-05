import { NextResponse } from 'next/server';

import { safraPayoutOpenSchema } from '@safra/contracts';

import { proxy } from '@/lib/proxy';

/**
 * Opening a transfer for a period.
 *
 * The API refuses an overlapping period and a period with nothing accrued; this parses the SHAPE
 * so a malformed date is answered without a round trip. It does not — and must not — try to
 * duplicate either rule: a second copy of «may these periods overlap» is a second answer.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const parsed = safraPayoutOpenSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json(
      { code: parsed.error.issues[0]?.message ?? 'validation.failed' },
      { status: 400 },
    );
  }

  return proxy('/admin/safra-payouts', { method: 'POST', body: parsed.data });
}
