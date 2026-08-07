import { NextResponse } from 'next/server';

import { ERROR, reviewReplySchema, reviewReportSchema } from '@safra/contracts';

import { proxy } from '@/lib/proxy';

/**
 * الرد and إبلاغ — the two remedies P-006 allows (§7.3).
 *
 * The action is an ALLOW-LIST of exactly those two. Forwarding the path segment verbatim would let
 * a crafted link reach any route under `/partner/reviews/:reference/…` the session can — and the
 * point of this file is that there is no third thing a partner can do to a review.
 *
 * There is no delete route here and there cannot be one: the table refuses `DELETE` outright.
 */
const ACTIONS = {
  reply: reviewReplySchema,
  report: reviewReportSchema,
} as const;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ reference: string; action: string }> },
): Promise<NextResponse> {
  const { reference, action } = await params;

  if (!Object.hasOwn(ACTIONS, action)) {
    return NextResponse.json({ code: ERROR.REQUEST_NOT_FOUND }, { status: 404 });
  }

  const parsed = ACTIONS[action as keyof typeof ACTIONS].safeParse(
    await request.json().catch(() => null),
  );

  if (!parsed.success) {
    return NextResponse.json(
      { code: parsed.error.issues[0]?.message ?? ERROR.REQUEST_VALIDATION_FAILED },
      { status: 400 },
    );
  }

  return proxy(`/partner/reviews/${encodeURIComponent(reference)}/${action}`, {
    method: 'POST',
    body: parsed.data,
  });
}
