import { NextResponse } from 'next/server';

import { safraPayoutPaidSchema, safraPayoutReasonSchema } from '@safra/contracts';

import { proxy } from '@/lib/proxy';

/**
 * The transfer transitions — release, paid, hold, cancel.
 *
 * ## Each action's body is validated against ITS schema
 *
 * Not one permissive schema for four. Marking paid needs the bank's reference; holding and
 * cancelling need a reason; releasing needs nothing. A shared schema would have to make all of
 * them optional, which is the same as checking none — and the required bank reference is the only
 * thing that makes a paid transfer findable on a statement afterwards.
 */
const ACTIONS = {
  release: null,
  paid: safraPayoutPaidSchema,
  hold: safraPayoutReasonSchema,
  cancel: safraPayoutReasonSchema,
} as const;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; action: string }> },
): Promise<NextResponse> {
  const { id, action } = await params;

  if (!(action in ACTIONS)) return new NextResponse(null, { status: 404 });

  const schema = ACTIONS[action as keyof typeof ACTIONS];
  let body: unknown;

  if (schema) {
    const parsed = schema.safeParse(await request.json().catch(() => null));

    if (!parsed.success) {
      return NextResponse.json(
        { code: parsed.error.issues[0]?.message ?? 'validation.failed' },
        { status: 400 },
      );
    }

    body = parsed.data;
  }

  return proxy(
    `/admin/safra-payouts/${encodeURIComponent(id)}/${action}`,
    schema ? { method: 'POST', body } : { method: 'POST' },
  );
}
