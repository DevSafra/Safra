import { NextResponse } from 'next/server';

import { ERROR, emailVerificationConfirmSchema } from '@safra/contracts';

import { forwardedHeaders } from '@safra/session';
import { refuseCrossOrigin } from '@/lib/cross-origin';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

/**
 * Confirms an email address, when the PERSON presses the button on the emailed link's page.
 *
 * ## Why this is a POST and not the page load
 *
 * The page used to confirm while it rendered, so the GET that opened the link spent the token. A
 * link-scanning proxy — Outlook Safe Links, a corporate gateway, a phone's preview — fetches every
 * link in an incoming mail before the person sees it, and so confirmed the address on their behalf
 * and left them a page saying the link no longer worked. Scanners follow links; they do not press
 * buttons. So the GET now only renders, and this is where the single-use token is spent.
 *
 * The visitor's address is forwarded so the API's per-IP limit is each visitor's own rather than
 * the Next server's single budget.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const refused = refuseCrossOrigin(request);
  if (refused) return refused;

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: ERROR.REQUEST_MALFORMED_BODY }, { status: 400 });
  }

  const parsed = emailVerificationConfirmSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ code: ERROR.REQUEST_VALIDATION_FAILED }, { status: 400 });
  }

  try {
    const response = await fetch(`${API_URL}/api/v1/auth/email/verify/confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...forwardedHeaders(request),
      },
      body: JSON.stringify(parsed.data),
      cache: 'no-store',
    });

    const payload: unknown = await response.json().catch(() => null);

    return NextResponse.json(payload, { status: response.status });
  } catch {
    return NextResponse.json(
      { code: ERROR.REQUEST_UPSTREAM_UNREACHABLE },
      { status: 502 },
    );
  }
}
