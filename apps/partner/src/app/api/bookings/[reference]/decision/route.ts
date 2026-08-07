import { NextResponse } from 'next/server';

import { ERROR, partnerBookingDecisionSchema } from '@safra/contracts';

import { proxy } from '@/lib/proxy';

/**
 * The partner's قبول / رفض on a booking request (§6.4).
 *
 * Validated against the shared schema here as well as at the API — which is what enforces the
 * rule that a rejection carries a reason, before a round trip rather than after.
 *
 * This route holds no authority. It cannot say WHICH booking belongs to the caller: the API takes
 * the partner id from the verified token and refuses a reference that is not theirs, so a partner
 * pasting another partner's reference into this URL gets a refusal from the only layer entitled to
 * give one.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ reference: string }> },
): Promise<NextResponse> {
  const { reference } = await params;

  const parsed = partnerBookingDecisionSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!parsed.success) {
    return NextResponse.json(
      { code: parsed.error.issues[0]?.message ?? ERROR.REQUEST_VALIDATION_FAILED },
      { status: 400 },
    );
  }

  return proxy(`/bookings/${encodeURIComponent(reference)}/partner-decision`, {
    method: 'POST',
    body: parsed.data,
  });
}
