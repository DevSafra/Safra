import { NextResponse } from 'next/server';

import { isStaffRole, loginSchema } from '@safra/contracts';
import {
  SESSION_MAX_AGE_SECONDS,
  STAFF_SESSION_COOKIE,
  callAuth,
  encodeSession,
  forwardedHeaders,
  sessionCookieOptions,
} from '@safra/session';

/**
 * Staff sign-in.
 *
 * Same proxy shape as the public app — the API origin stays server-side and the real
 * client IP reaches the per-IP rate limit and §15's audit trail — with one addition
 * that matters: a **non-staff account is refused here**, after a successful
 * authentication.
 *
 * That refusal is not authorization; the API would decline every staff endpoint
 * anyway. It is so a customer who tries their credentials on the admin origin gets a
 * flat "no" instead of a session cookie and an empty console, and so the attempt is
 * distinguishable in the logs from a normal sign-in.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: 'Malformed request body.' }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        message: 'Validation failed.',
        errors: parsed.error.issues.map((issue) => ({
          field: issue.path.join('.') || '(root)',
          message: issue.message,
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
    return NextResponse.json(
      {
        message: outcome.message,
        ...(outcome.fieldErrors ? { errors: outcome.fieldErrors } : {}),
      },
      { status: outcome.status },
    );
  }

  if (!isStaffRole(outcome.session.user.role)) {
    /**
     * No cookie is set, and the message says exactly what happened. There is no
     * enumeration concern: the person just proved they hold these credentials, so
     * telling them the account is not a staff account reveals nothing they could not
     * already establish on the public site.
     */
    return NextResponse.json(
      { message: 'This account does not have access to the command center.' },
      { status: 403 },
    );
  }

  const response = NextResponse.json({
    user: outcome.session.user,
    // Drives the client's redirect: an unenrolled account goes to enrolment, and
    // middleware enforces the same thing on the next request regardless.
    requiresTwoFactorEnrolment: !readTotpEnabled(outcome.session.accessToken),
  });

  response.cookies.set(
    STAFF_SESSION_COOKIE,
    encodeSession(outcome.session),
    sessionCookieOptions(SESSION_MAX_AGE_SECONDS),
  );

  return response;
}

/** Local read so the route does not import the Edge-flavoured decoder for one flag. */
function readTotpEnabled(jwt: string): boolean {
  const payload = jwt.split('.')[1];
  if (!payload) return false;

  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    );

    return (
      typeof decoded === 'object' &&
      decoded !== null &&
      (decoded as Record<string, unknown>)['totpEnabled'] === true
    );
  } catch {
    return false;
  }
}
