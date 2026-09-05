import { NextResponse } from 'next/server';

import { safraPayoutAccountRejectSchema } from '@safra/contracts';

import { proxy } from '@/lib/proxy';

/**
 * Verifying or rejecting a SAFRA destination.
 *
 * ## The action is an ALLOW-LIST, not a path segment passed through
 *
 * `[action]` comes from the URL, and forwarding it verbatim would let a crafted link reach any
 * route under `/admin/safra-payouts/accounts/:id/…` a staff session can — including ones added
 * later that nobody considered here. The same reasoning the payout `[action]` handler records,
 * and it matters more on this path: these two routes decide where SAFRA's own revenue may go.
 */
const ACTIONS = {
  verify: null,
  reject: safraPayoutAccountRejectSchema,
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
    `/admin/safra-payouts/accounts/${encodeURIComponent(id)}/${action}`,
    schema ? { method: 'POST', body } : { method: 'POST' },
  );
}
