import { NextResponse } from 'next/server';

import { ERROR, loginSchema } from '@safra/contracts';
import {
  PARTNER_SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  callAuth,
  encodeSession,
  forwardedHeaders,
  sessionCookieOptions,
} from '@safra/session';

/**
 * Partner sign-in.
 *
 * The same proxy shape as the other two apps — the API origin stays server-side, and
 * `forwardedHeaders` carries the real client IP so the per-IP rate limit and §15's audit trail see
 * the person rather than this server — with one addition: a **non-partner account is refused
 * here**, after a successful authentication.
 *
 * That refusal is not authorization. The API declines every partner endpoint to a non-partner
 * anyway, and scopes each one to the `partnerId` in the verified token. It is so a customer or a
 * staff member who tries their credentials on this origin gets a flat "no" rather than a session
 * cookie and an empty dashboard, and so the attempt is distinguishable in the logs.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: ERROR.REQUEST_MALFORMED_BODY }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        code: ERROR.REQUEST_VALIDATION_FAILED,
        errors: parsed.error.issues.map((issue) => ({
          field: issue.path.join('.') || '(root)',
          // The schema's message IS the code — see `@safra/contracts/error-codes`.
          code: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  const outcome = await callAuth('/auth/login', {
    body: parsed.data,
    headers: forwardedHeaders(request),
  });

  if (!outcome.ok || !outcome.session) {
    return NextResponse.json({ code: outcome.code }, { status: outcome.status });
  }

  if (outcome.session.user.role !== 'partner') {
    /*
      No cookie is set. There is no enumeration concern in being specific: the person has just
      proved they hold these credentials, so telling them the account is not a partner account
      reveals nothing they could not already establish elsewhere.

      It answers with its OWN code as of 2026-08-23. All three sign-in routes shared
      `AUTH_NOT_STAFF`, whose message named the staff console — so somebody who had been onboarded
      as a partner but had not yet opened their invitation link was told, on the partner portal,
      that their account belonged in «مركز القيادة». The message now names the invitation, which
      is the actual remedy: until that link is opened the account is still a customer and cannot
      sign in here.
    */
    return NextResponse.json({ code: ERROR.AUTH_NOT_PARTNER }, { status: 403 });
  }

  const response = NextResponse.json({ user: outcome.session.user });

  response.cookies.set(
    PARTNER_SESSION_COOKIE,
    encodeSession(outcome.session),
    sessionCookieOptions(SESSION_MAX_AGE_SECONDS),
  );

  return response;
}
