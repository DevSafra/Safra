import { NextResponse } from 'next/server';

import { ERROR } from '@safra/contracts';

import { getPartnerSession } from '@/lib/session-server';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

/**
 * Uploading one verification document (step 5 of «انضم كشريك», Bashar 2026-08-19).
 *
 * The multipart body is streamed through UNPARSED, for the same reason property images are: the
 * API is the only place that can judge the file, because judging it means reading it — and it
 * checks type and size before storing anything. `Content-Type` is forwarded because the multipart
 * boundary lives in it.
 *
 * The token comes from the HttpOnly cookie and is attached here, so it never reaches client
 * JavaScript. The API derives the partner from it and takes no partner id from the request, which
 * is what makes "upload into somebody else's file" unexpressible rather than merely refused.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const session = await getPartnerSession();

  if (!session) {
    return NextResponse.json({ code: ERROR.AUTH_REQUIRED }, { status: 401 });
  }

  const contentType = request.headers.get('content-type');

  if (!contentType?.startsWith('multipart/form-data')) {
    return NextResponse.json({ code: ERROR.UPLOAD_FILE_MISSING }, { status: 400 });
  }

  try {
    const response = await fetch(`${API_URL}/api/v1/partner/documents`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
        'content-type': contentType,
      },
      body: await request.arrayBuffer(),
      cache: 'no-store',
    });

    const payload: unknown = await response.json().catch(() => null);

    return NextResponse.json(payload, { status: response.status });
  } catch {
    return NextResponse.json(
      { code: ERROR.REQUEST_UPSTREAM_UNREACHABLE },
      { status: 502 },
    );
  }
}
