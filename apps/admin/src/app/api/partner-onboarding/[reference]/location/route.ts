import type { NextResponse } from 'next/server';

import { proxy } from '@/lib/proxy';

/**
 * §8.1's «الموقع على الخريطة», saved from the onboarding screen.
 *
 * The body is FORWARDED rather than rebuilt: the API validates the coordinates with
 * `partnerLocationSchema` and rejects anything else, so a second opinion here would be a second
 * place for the two to disagree. The reference travels in the path, where the API scopes the write
 * to that partner — "move somebody else's pin" is not a request this route can express.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ reference: string }> },
): Promise<NextResponse> {
  const { reference } = await params;

  return proxy(`/admin/partner-onboarding/${encodeURIComponent(reference)}/location`, {
    method: 'POST',
    /* Parsed and re-serialised by `proxy`, which owns the JSON headers. */
    body: (await request.json()) as unknown,
  });
}
