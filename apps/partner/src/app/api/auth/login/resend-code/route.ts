import { NextResponse } from 'next/server';

import { ERROR, loginCodeResendSchema } from '@safra/contracts';
import { callAuth, forwardedHeaders } from '@safra/session';

/**
 * «إعادة إرسال الرمز» — another sign-in code for a partner whose mail was slow or lost.
 *
 * The same proxy shape as `login` next door: the API origin stays server-side and
 * `forwardedHeaders` carries the real client address, so the per-IP ceiling and §15's audit trail
 * see the partner rather than this server.
 *
 * ## It answers the same thing whatever happened
 *
 * The API returns `{ ok: true }` for a wrong password, an unknown address, a customer, and a
 * partner who uses an authenticator and is sent no mail at all. This route does not add a reading
 * of its own — no role check like the one `login` performs — because any distinction drawn here
 * would be the account-enumeration oracle the API deliberately refuses to give.
 *
 * The one refusal a caller can see is the rate limit, and that is counted per ACCOUNT behind a
 * verified password, so it says nothing about who exists.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: ERROR.REQUEST_MALFORMED_BODY }, { status: 400 });
  }

  const parsed = loginCodeResendSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ code: ERROR.REQUEST_VALIDATION_FAILED }, { status: 400 });
  }

  const outcome = await callAuth('/auth/login/resend-code', {
    body: parsed.data,
    headers: forwardedHeaders(request),
  });

  /*
    The API's own code is passed through when it refused — the rate limit is the one refusal a
    partner can act on ("wait, then try again"), and the form needs to tell them so.
  */
  return NextResponse.json(
    outcome.ok ? { ok: true } : { code: outcome.code ?? ERROR.REQUEST_UNKNOWN },
    { status: outcome.status },
  );
}
