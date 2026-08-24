import type { NextRequest } from 'next/server';

import { proxy } from '@/lib/proxy';

/**
 * Lifts a suspension — `PARTNER_SUSPEND`, reason required. Lifting an enforcement action is a decision with a record, so it asks for a reason exactly as suspending does.
 *
 * The reason floor, the permission and the conflict rules are all the API's. This carries the body
 * and nothing else — a BFF route that validated would be a second opinion about what is allowed.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ reference: string }> },
) {
  const { reference } = await params;

  return proxy(`/admin/partners/${encodeURIComponent(reference)}/unsuspend`, {
    method: 'POST',
    body: await request.json(),
  });
}
