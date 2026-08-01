import { NextResponse } from 'next/server';

import { registerSchema } from '@safra/contracts';

import {
  CUSTOMER_SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  callAuth,
  encodeSession,
  forwardedHeaders,
  sessionCookieOptions,
} from '@safra/session';
/**
 * Creates a customer account and signs them straight in (SRS §4).
 *
 * The API returns the same payload as login, so registration does not bounce the
 * customer to a sign-in form to type the password they just chose.
 *
 * Note the deliberate asymmetry with login: registration answers 409 on a duplicate
 * email, which reveals that an address is taken. That is not an oversight — a signup
 * form reveals it anyway by refusing to proceed, so hiding it buys no privacy while
 * making the error useless. Login is where enumeration actually matters, and there
 * the API stays non-committal (ADR 0003).
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: 'Malformed request body.' }, { status: 400 });
  }

  const parsed = registerSchema.safeParse(body);

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

  const outcome = await callAuth('/auth/register', {
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

  const response = NextResponse.json({ user: outcome.session.user }, { status: 201 });

  response.cookies.set(
    CUSTOMER_SESSION_COOKIE,
    encodeSession(outcome.session),
    sessionCookieOptions(SESSION_MAX_AGE_SECONDS),
  );

  return response;
}
