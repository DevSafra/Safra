import { NextResponse } from 'next/server';

import { proxy } from '@/lib/proxy';

/**
 * Releasing one of the guest's files to the partner — or withdrawing it.
 *
 * ## Why the flag is forwarded and nothing else
 *
 * `shared` is the whole body. `shared_at` and `shared_by_user_id` are the server's to write — a
 * CHECK keeps the flag and the timestamp in step, and the API takes the actor from `claims.sub`,
 * so «who released this» is a question this endpoint cannot be asked. Rejected here as well as by
 * the API's `.strict()` schema, because a body that reaches the network at all is one more thing
 * to reason about.
 *
 * The evidence id is the only other thing the caller names, and the API resolves it inside the
 * reader's own cities: an id from a dispute they cannot open answers exactly as one that does not
 * exist.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ evidenceId: string }> },
): Promise<NextResponse> {
  const { evidenceId } = await params;
  const body: unknown = await request.json().catch(() => null);

  if (
    typeof body !== 'object' ||
    body === null ||
    typeof (body as { shared?: unknown }).shared !== 'boolean'
  ) {
    return NextResponse.json({ message: 'A shared flag is required.' }, { status: 400 });
  }

  return proxy(`/admin/disputes/evidence/${encodeURIComponent(evidenceId)}/share`, {
    method: 'POST',
    body: { shared: (body as { shared: boolean }).shared },
  });
}
