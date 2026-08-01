import { NextResponse } from 'next/server';

import { loginSchema } from '@safra/contracts';

import {
  CUSTOMER_SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  callAuth,
  encodeSession,
  forwardedHeaders,
  sessionCookieOptions,
} from '@safra/session';

/**
 * Signs a customer in (SRS §4).
 *
 * Runs server-side for the same reason the booking and payment proxies do: the API
 * origin stays hidden and the real client IP reaches §15's audit trail. It matters
 * more here than anywhere else, because this is the endpoint the API rate-limits per
 * IP — forwarding the browser's address is what makes that limit mean anything
 * rather than throttling the Next server as a single client.
 *
 * Neither token is ever returned in the body. They go straight into an HttpOnly
 * cookie, so client JavaScript cannot read them even on this origin.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: 'Malformed request body.' }, { status: 400 });
  }

  /**
   * Validated here as well as at the API, against the SAME schema.
   *
   * Not redundant: it keeps an obviously malformed attempt from consuming one of the
   * customer's five-per-minute login attempts, and returns the field errors in the
   * shape the form already renders.
   */
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

  const response = NextResponse.json({ user: outcome.session.user });

  response.cookies.set(
    CUSTOMER_SESSION_COOKIE,
    encodeSession(outcome.session),
    sessionCookieOptions(SESSION_MAX_AGE_SECONDS),
  );

  return response;
}
