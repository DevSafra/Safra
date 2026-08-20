import { NextResponse } from 'next/server';

import { ERROR, partnerInvitationAcceptSchema } from '@safra/contracts';
import { forwardedHeaders } from '@safra/session';

/**
 * Redeeming a partner invitation — the server half of «أنشئ حساب الشريك».
 *
 * ## Why it is not `callAuth`
 *
 * That helper turns a response into a SESSION, and this endpoint deliberately issues none: the API
 * answers 201 with an empty body and the partner signs in normally afterwards, so there is one
 * code path minting partner sessions rather than two. Calling it here would mean parsing cookies
 * that are never set.
 *
 * ## The API origin stays server-side
 *
 * Same reason as every other route in this folder — the browser never learns where the API is —
 * and `forwardedHeaders` carries the real client address so the endpoint's own rate limit and
 * §15's audit trail see the partner rather than this server.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: ERROR.REQUEST_MALFORMED_BODY }, { status: 400 });
  }

  const parsed = partnerInvitationAcceptSchema.safeParse(body);

  if (!parsed.success) {
    /*
      Answered as a VALIDATION failure so the form can say "your password does not meet the rules"
      rather than "this link is broken". The token is the only other field and it came from the
      URL; a person cannot mistype it.
    */
    return NextResponse.json({ code: ERROR.REQUEST_VALIDATION_FAILED }, { status: 400 });
  }

  const apiUrl = process.env['API_URL'] ?? 'http://localhost:4000';

  let response: Response;

  try {
    response = await fetch(`${apiUrl}/api/v1/partner/invitation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...forwardedHeaders(request) },
      body: JSON.stringify(parsed.data),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(
      { code: ERROR.REQUEST_UPSTREAM_UNREACHABLE },
      { status: 502 },
    );
  }

  if (response.ok) return NextResponse.json({ ok: true }, { status: 200 });

  const payload: unknown = await response.json().catch(() => null);
  const code =
    typeof payload === 'object' && payload !== null && 'code' in payload
      ? (payload as { code?: unknown }).code
      : null;

  return NextResponse.json(
    { code: typeof code === 'string' ? code : ERROR.REQUEST_UNKNOWN },
    { status: response.status },
  );
}
