import { NextResponse } from 'next/server';

import { ERROR, emailVerificationResendSchema } from '@safra/contracts';

import { forwardedHeaders } from '@safra/session';
import { refuseCrossOrigin } from '@/lib/cross-origin';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

/**
 * Sends the email-confirmation link again, from the sign-in form (2026-10-06).
 *
 * A customer whose address is not confirmed is refused at sign-in with `auth.email_unverified`, and
 * the form offers this. By address rather than by session, because they have no session and cannot
 * get one until the link is followed.
 *
 * The API answers 204 whatever the address, exactly like the password reset, so this cannot be used
 * to learn who has an account. The visitor's address is forwarded so the API's per-IP limit is each
 * visitor's own rather than the Next server's single budget; the per-account limit sits beside it.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const refused = refuseCrossOrigin(request);
  if (refused) return refused;

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: ERROR.REQUEST_MALFORMED_BODY }, { status: 400 });
  }

  const parsed = emailVerificationResendSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        code: ERROR.REQUEST_VALIDATION_FAILED,
        errors: parsed.error.issues.map((issue) => ({
          field: issue.path.join('.') || '(root)',
          code: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  try {
    const response = await fetch(`${API_URL}/api/v1/auth/email/verify/resend`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...forwardedHeaders(request),
      },
      body: JSON.stringify(parsed.data),
      cache: 'no-store',
    });

    /* 204 carries no body; passing it through as JSON would turn a success into a parse failure. */
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
