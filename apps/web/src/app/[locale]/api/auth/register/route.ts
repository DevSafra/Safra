import { NextResponse } from 'next/server';

import { ERROR, registerSchema } from '@safra/contracts';

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
    return NextResponse.json({ code: ERROR.REQUEST_MALFORMED_BODY }, { status: 400 });
  }

  const parsed = registerSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        code: ERROR.REQUEST_VALIDATION_FAILED,
        errors: parsed.error.issues.map((issue) => ({
          field: issue.path.join('.') || '(root)',
          // The schema's `message` IS the code — see `@safra/contracts/error-codes`. It is
          // forwarded as `code` because that is the field the form resolves against the
          // reader's locale; sending it as `message` made every field show the generic
          // "something went wrong" while the API knew exactly which field was wrong.
          code: issue.message,
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
        code: outcome.code,
        /*
          Forwarded as an ARRAY, because that is what the form reads (`Array.isArray(errors)`).
          `callAuth` returns a field→code MAP, and passing it through unchanged meant every
          upstream field error was silently dropped: the map failed the array check and the form
          fell back to a status-based message.
        */
        ...(outcome.fieldErrors
          ? {
              errors: Object.entries(outcome.fieldErrors).map(([field, code]) => ({
                field,
                code,
              })),
            }
          : {}),
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
