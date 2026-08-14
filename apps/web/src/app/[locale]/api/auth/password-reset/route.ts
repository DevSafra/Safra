import { NextResponse } from 'next/server';

import {
  ERROR,
  errorParamsOf,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
} from '@safra/contracts';

import { forwardedHeaders } from '@safra/session';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

/**
 * Password reset, request and confirm on one route (SRS §4).
 *
 * The two are distinguished by whether a `token` is present rather than by separate
 * paths, because they are two steps of one flow and splitting them would duplicate
 * the whole proxy for a difference of one URL segment.
 *
 * Forwarding the client IP matters more here than almost anywhere: the API limits
 * reset requests per address, and without it every customer would share the Next
 * server's single budget of three per minute.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: ERROR.REQUEST_MALFORMED_BODY }, { status: 400 });
  }

  const isConfirm = typeof body === 'object' && body !== null && 'token' in body;

  const parsed = isConfirm
    ? passwordResetConfirmSchema.safeParse(body)
    : passwordResetRequestSchema.safeParse(body);

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

  const path = isConfirm ? '/auth/password-reset/confirm' : '/auth/password-reset';

  try {
    const response = await fetch(`${API_URL}/api/v1${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...forwardedHeaders(request),
      },
      body: JSON.stringify(parsed.data),
      cache: 'no-store',
    });

    /**
     * 204 carries no body. Passing it through as JSON would make the client parse
     * an empty string and treat a success as a failure.
     */
    if (response.status === 204) return new NextResponse(null, { status: 204 });

    const payload: unknown = await response.json().catch(() => null);

    return NextResponse.json(payload, { status: response.status });
  } catch {
    return NextResponse.json(
      { code: ERROR.REQUEST_UPSTREAM_UNREACHABLE },
      { status: 502 },
    );
  }
}
