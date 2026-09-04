import { NextResponse } from 'next/server';

import { proxy } from '@/lib/proxy';

/**
 * Staff entering a payout account on a partner's behalf (Bashar, 2026-09-04).
 *
 * The body is forwarded unread. Every field is validated by `payoutAccountInputSchema` in the API,
 * which is the only validation that counts — re-checking here would be a second rule to keep in
 * step, and the one an attacker skips by calling the API directly.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ reference: string }> },
): Promise<NextResponse> {
  const { reference } = await params;
  const body: unknown = await request.json().catch(() => null);

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ message: 'A body is required.' }, { status: 400 });
  }

  return proxy(`/admin/partners/${encodeURIComponent(reference)}/payout-accounts`, {
    method: 'POST',
    body,
  });
}
