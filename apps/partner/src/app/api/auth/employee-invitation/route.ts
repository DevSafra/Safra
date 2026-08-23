import { NextResponse } from 'next/server';

import { ERROR, employeeInvitationAcceptSchema } from '@safra/contracts';
import { forwardedHeaders } from '@safra/session';

/**
 * Redeeming an employee invitation — the server half of «تفعيل حساب الموظّف».
 *
 * A sibling of `../invitation/route.ts` and shaped the same way for the same three reasons: no
 * session is issued so one code path mints partner-side sessions, the API origin never reaches the
 * browser, and `forwardedHeaders` carries the real client address so the endpoint's 5-per-minute
 * limit and §15's audit trail see the person rather than this server.
 *
 * ## Why it is a separate route and not a parameter on that one
 *
 * The two tokens redeem into different roles — `partner_invitation` makes somebody the OWNER of a
 * business, `partner_employee_invitation` makes them a member of its staff — and the API keeps
 * them as separate purposes precisely so one cannot be spent in the other's slot. A shared route
 * taking the purpose from the request would hand that decision back to the caller, which is the
 * one thing the split exists to prevent.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: ERROR.REQUEST_MALFORMED_BODY }, { status: 400 });
  }

  const parsed = employeeInvitationAcceptSchema.safeParse(body);

  if (!parsed.success) {
    /*
      A VALIDATION code, not an invalid-link one. The token came from the URL and cannot be
      mistyped, so a schema failure here is the password missing `passwordSchema` — and the form
      needs to say "your password does not meet the rules" rather than "this link is broken",
      which sends somebody to ask for a new invitation they do not need.
    */
    return NextResponse.json({ code: ERROR.REQUEST_VALIDATION_FAILED }, { status: 400 });
  }

  const apiUrl = process.env['API_URL'] ?? 'http://localhost:4000';

  let response: Response;

  try {
    response = await fetch(`${apiUrl}/api/v1/partner/employee-invitation`, {
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

  /*
    The upstream STATUS travels with the code, so the form can tell a refused link from a server
    fault. The body is never forwarded — the API's English `message` is for logs, and writing it
    onto an Arabic screen is the failure the copy rules exist to prevent.
  */
  return NextResponse.json(
    { code: typeof code === 'string' ? code : ERROR.REQUEST_UNKNOWN },
    { status: response.status },
  );
}
