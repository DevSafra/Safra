import type { NextResponse } from 'next/server';

import { proxy } from '@/lib/proxy';

/**
 * The copy BOTH parties signed — the in-person case (Bashar, 2026-08-23).
 *
 * ## Why this is a second route and not a flag on the first
 *
 * `signed-copy` records SAFRA's signature, sends the contract to the partner and waits for theirs.
 * This records both signatures against one document and puts the contract in force immediately.
 * They are different transitions with different consequences, and the API gives each its own
 * permissioned endpoint — so the console asks for the one it means rather than passing a boolean
 * that decides, halfway down a service, whether a contract becomes binding.
 *
 * It also keeps the audit trail readable: the route that was called is the operator's intent, and
 * a flag would make «رفع نسخة موقّعة» cover two materially different acts.
 *
 * The body is forwarded as it arrives; the API validates it against the same signed-copy schema,
 * which is the only place the file is checked. Restating those rules here would give two answers
 * to one question and only one of them would be kept up to date.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  return proxy(`/admin/partner-contracts/${encodeURIComponent(id)}/joint-signed-copy`, {
    method: 'POST',
    body: await request.json().catch(() => ({})),
  });
}
