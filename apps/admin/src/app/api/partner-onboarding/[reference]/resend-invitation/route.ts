import type { NextResponse } from 'next/server';

import { proxy } from '@/lib/proxy';

/**
 * Send a partner's invitation again (Bashar, 2026-08-23).
 *
 * The remedy for the state that produced this endpoint: a partner onboarded in person, approved,
 * and unable to sign in because the invitation was never redeemed — with nothing on the screen
 * that had just declared the job finished offering a way to fix it.
 *
 * No body. The reference in the path is the whole request, and the API resolves the account and
 * the address from the partner record — so "send an invitation to an address of my choosing" is
 * not a request this route can express.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ reference: string }> },
): Promise<NextResponse> {
  const { reference } = await params;

  return proxy(
    `/admin/partner-onboarding/${encodeURIComponent(reference)}/resend-invitation`,
    { method: 'POST' },
  );
}
