import { NextResponse } from 'next/server';

import { safraPayoutAccountInputSchema } from '@safra/contracts';

import { proxy } from '@/lib/proxy';

/**
 * Creating a SAFRA payout destination.
 *
 * Validated at the edge so the form can name the field that is wrong, and because the account
 * NUMBER is in this body: a shape refused here never reaches a log line, a trace or a retry.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const parsed = safraPayoutAccountInputSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!parsed.success) {
    return NextResponse.json(
      { code: parsed.error.issues[0]?.message ?? 'validation.failed' },
      { status: 400 },
    );
  }

  return proxy('/admin/safra-payouts/accounts', { method: 'POST', body: parsed.data });
}
