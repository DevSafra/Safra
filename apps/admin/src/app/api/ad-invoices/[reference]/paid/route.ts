import type { NextResponse } from 'next/server';

import { proxy } from '@/lib/proxy';

/**
 * Records that an advertiser paid an invoice.
 *
 * The reference is the only thing this handler takes from the URL, and it is passed through
 * encoded — the API resolves it to a row, checks the reader's scope against that row's city, and
 * refuses anything that is not still `due`. Nothing here decides who may pay what.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ reference: string }> },
): Promise<NextResponse> {
  const { reference } = await params;
  const body: unknown = await request.json().catch(() => null);

  return proxy(`/admin/ad-invoices/${encodeURIComponent(reference)}/paid`, {
    method: 'POST',
    body: body ?? {},
  });
}
