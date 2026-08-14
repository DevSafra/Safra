import { NextResponse } from 'next/server';

import { ERROR, errorParamsOf, registerSchema } from '@safra/contracts';

import { forwardedHeaders } from '@safra/session';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';
/**
 * Creates a customer account (SRS §4), and says the same thing whether or not one already exists.
 *
 * ## What changed on 2026-08-07, and why
 *
 * This used to sign the customer straight in, and to answer `409 auth.email_taken` for an address
 * that was already registered — justified on the grounds that a signup form reveals this by
 * design. It does not have to: one request, no side effects and a definitive answer is the
 * cheapest account-enumeration oracle a system can offer.
 *
 * The endpoint now answers `202 { ok: true }` for every address. The difference moves into the
 * inbox: a new address gets a verification link, a taken one gets "you already have an account,
 * here is how to sign in or reset". Only the owner of the address sees either.
 *
 * That costs the auto-sign-in. An identical response for a taken address could not carry tokens —
 * they would sign the caller in as somebody else — so both paths end at "check your email".
 *
 * ## The argument this replaced
 *
 * That a signup form reveals it anyway by refusing to proceed, so hiding it buys no privacy while
 * making the error useless. The first half is only true if the form MUST refuse — it does not, now
 * that the difference is carried by email — and the second is a UX cost worth paying. Login was
 * always non-committal (ADR 0003); registration now matches it.
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
          /*
            And the VALUES the sentence interpolates.

            This route parses the same schema the API does and refuses before calling it, so for a
            short password the API is never reached — which is why fixing the API alone left the
            registration form still printing «{min}» (Bashar, 2026-08-14). `errorParamsOf` is the
            one derivation both sides share.
          */
          ...(errorParamsOf(issue) ? { params: errorParamsOf(issue) } : {}),
        })),
      },
      { status: 400 },
    );
  }

  /*
    A direct call rather than `callAuth`, because registration no longer returns a session.

    Since 2026-08-07 the endpoint answers the SAME generic body for every address — a taken one
    included — so it cannot issue tokens: doing so for a taken address would sign the caller in as
    somebody else. `callAuth` parses a login response and would report the absence as
    `auth.session_missing`, turning every successful registration into an error.
  */
  let upstream: Response;

  try {
    upstream = await fetch(`${API_URL}/api/v1/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...forwardedHeaders(request),
      },
      body: JSON.stringify(parsed.data),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(
      { code: ERROR.REQUEST_UPSTREAM_UNREACHABLE },
      { status: 502 },
    );
  }

  const payload: unknown = await upstream.json().catch(() => null);

  if (!upstream.ok) {
    return NextResponse.json(
      {
        code: codeOf(payload),
        /*
          Forwarded as an ARRAY, because that is what the form reads (`Array.isArray(errors)`).
          `callAuth` returns a field→code MAP, and passing it through unchanged meant every
          upstream field error was silently dropped: the map failed the array check and the form
          fell back to a status-based message.
        */
        ...(fieldErrorsOf(payload) ? { errors: fieldErrorsOf(payload) } : {}),
      },
      { status: upstream.status },
    );
  }

  /*
    No cookie, and no user. The customer verifies their address and signs in — see the note above.
    The form shows "check your email" for every address, which is the whole point: the answer is
    identical whether or not one already exists.
  */
  return NextResponse.json({ ok: true }, { status: 202 });
}

/** The API's error code, if it sent one of ours. */
function codeOf(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null || !('code' in payload)) {
    return ERROR.REQUEST_UNKNOWN;
  }

  const { code } = payload;

  return typeof code === 'string' ? code : ERROR.REQUEST_UNKNOWN;
}

/** The API's field errors, as the ARRAY the form reads (`Array.isArray(errors)`). */
function fieldErrorsOf(payload: unknown): { field: string; code: string }[] | null {
  if (typeof payload !== 'object' || payload === null || !('errors' in payload)) {
    return null;
  }

  const { errors } = payload;

  return Array.isArray(errors) ? (errors as { field: string; code: string }[]) : null;
}
