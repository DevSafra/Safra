import { NextResponse } from 'next/server';

import { proxy } from '@/lib/proxy';

/**
 * Closes a dispute, which may credit the customer's wallet.
 *
 * A thin proxy. The API owns the validation, the permission check, the wallet transaction and the
 * audit entry; re-validating here would create a second definition of a valid closure and the two
 * would drift.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ reference: string }> },
): Promise<NextResponse> {
  const { reference } = await params;
  const body: unknown = await request.json().catch(() => null);

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ message: 'A request body is required.' }, { status: 400 });
  }

  return proxy(`/admin/disputes/${encodeURIComponent(reference)}/close`, {
    method: 'POST',
    body,
  });
}
