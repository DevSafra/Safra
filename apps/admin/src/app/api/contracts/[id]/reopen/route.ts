import type { NextResponse } from 'next/server';

import { proxy } from '@/lib/proxy';

/**
 * Hands the signing step back to the partner (§8.1, Bashar 2026-08-21).
 *
 * No body: the contract id is the whole request. Nothing about who may do it is decided here — the
 * API holds `PARTNER_CONTRACT_MANAGE` and the status check, and a second opinion in this route
 * would be one more thing to keep in step.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  return proxy(`/admin/partner-contracts/${encodeURIComponent(id)}/reopen`, {
    method: 'POST',
  });
}
