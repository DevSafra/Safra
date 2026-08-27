import type { NextResponse } from 'next/server';

import { proxy } from '@/lib/proxy';

/**
 * Editing a campaign's CREATIVE — the three headlines and the target.
 *
 * The window and the price are not editable and this handler cannot make them so: the API's
 * schema is `.strict()` and knows only these four fields. A campaign whose billing period moved
 * underneath its own invoices would be a bill nobody can reconcile.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ reference: string }> },
): Promise<NextResponse> {
  const { reference } = await params;

  return proxy(`/admin/ad-campaigns/${encodeURIComponent(reference)}`, {
    method: 'PATCH',
    body: await request.json(),
  });
}
