import type { NextResponse } from 'next/server';

import { proxy } from '@/lib/proxy';

/**
 * SAFRA's hand-signed copy — the upload that SENDS the contract to the partner.
 *
 * Signing is on paper (electronic signatures are not accepted in Syria), so this carries a scan of
 * the printed, signed document. The API moves the contract to `awaiting_partner_signature` and
 * emails the partner; this route neither knows nor duplicates either of those.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  return proxy(`/admin/partner-contracts/${encodeURIComponent(id)}/signed-copy`, {
    method: 'POST',
    body: await request.json().catch(() => ({})),
  });
}
