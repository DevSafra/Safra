import { NextResponse } from 'next/server';

import { ERROR, payoutAccountInputSchema } from '@safra/contracts';

import { proxy } from '@/lib/proxy';

/**
 * A partner entering their own transfer details (Bashar, 2026-09-04).
 *
 * Validated against the SHARED schema, for the reason the employee-roles route gives: one rule in
 * `@safra/contracts`, checked here so a typo answers without a round trip and checked again by the
 * API because this line is not the security boundary — a caller can skip it entirely.
 *
 * Nothing here names a partner. The API reads `partnerId` from the verified token on every route
 * in this file, so "add a bank account to another business" is not expressible.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const parsed = payoutAccountInputSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!parsed.success) {
    return NextResponse.json({ code: ERROR.REQUEST_VALIDATION_FAILED }, { status: 400 });
  }

  return proxy('/partner/payout-accounts', { method: 'POST', body: parsed.data });
}
