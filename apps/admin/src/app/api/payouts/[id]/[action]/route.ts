import { NextResponse } from 'next/server';

import {
  ERROR,
  payoutPaidSchema,
  payoutReasonSchema,
  payoutReleaseSchema,
} from '@safra/contracts';

import { proxy } from '@/lib/proxy';

/**
 * The staff payout transitions (§9.3).
 *
 * ## The action is an ALLOW-LIST, not a path segment passed through
 *
 * `[action]` comes from the URL, and forwarding it verbatim would let a crafted link reach any
 * route under `/admin/payouts/:id/…` that the staff session can — including ones added later that
 * nobody thought about in this context. `ACTIONS` names the six, and anything else is a 404 here
 * rather than a request the API has to refuse.
 *
 * ## Each action's body is validated against ITS schema
 *
 * Not one permissive schema for all six. Releasing needs a date, marking paid needs the bank's
 * reference, holding and cancelling need a reason — and the whole point of requiring them is lost
 * if this route would forward a body missing the field. The API validates again on its own
 * authority; this is so the requirement is enforced before a round trip rather than after.
 */
const ACTIONS = {
  close: null,
  release: payoutReleaseSchema,
  paid: payoutPaidSchema,
  hold: payoutReasonSchema,
  'lift-hold': null,
  cancel: payoutReasonSchema,
} as const;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; action: string }> },
): Promise<NextResponse> {
  const { id, action } = await params;

  if (!Object.hasOwn(ACTIONS, action)) {
    return NextResponse.json({ code: ERROR.REQUEST_VALIDATION_FAILED }, { status: 404 });
  }

  const schema = ACTIONS[action as keyof typeof ACTIONS];
  const body: unknown = await request.json().catch(() => null);

  if (schema) {
    const parsed = schema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { code: parsed.error.issues[0]?.message ?? ERROR.REQUEST_VALIDATION_FAILED },
        { status: 400 },
      );
    }

    return proxy(`/admin/payouts/${encodeURIComponent(id)}/${action}`, {
      method: 'POST',
      body: parsed.data,
    });
  }

  return proxy(`/admin/payouts/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
}
