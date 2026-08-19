import { NextResponse } from 'next/server';

import { ERROR } from '@safra/contracts';

import { getPartnerSession } from '@/lib/session-server';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

/**
 * Downloading the partnership contract SAFRA sent (Bashar, 2026-08-19, step 4).
 *
 * A GET the browser follows directly, so the bytes never pass through JavaScript. The session
 * cookie is HttpOnly, so the token is attached here — which is also why this cannot be a link
 * straight to the API.
 *
 * ## The response headers are the API's, not rebuilt here
 *
 * `Content-Disposition` and `X-Content-Type-Options` are set by the API, which knows the filename
 * from its own column. Copying them across rather than composing new ones keeps ONE decision about
 * whether a partner's commercial agreement renders inline — and it decided `attachment`.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ contractId: string }> },
): Promise<Response> {
  const { contractId } = await params;
  const session = await getPartnerSession();

  if (!session) {
    return NextResponse.json({ code: ERROR.AUTH_REQUIRED }, { status: 401 });
  }

  try {
    const response = await fetch(
      `${API_URL}/api/v1/partner/contracts/${encodeURIComponent(contractId)}/file`,
      {
        headers: { Authorization: `Bearer ${session.accessToken}` },
        cache: 'no-store',
      },
    );

    if (!response.ok) {
      return NextResponse.json(
        { code: ERROR.CONTRACT_NOT_FOUND },
        { status: response.status },
      );
    }

    const headers = new Headers();

    for (const name of [
      'content-type',
      'content-disposition',
      'x-content-type-options',
    ]) {
      const value = response.headers.get(name);

      if (value) headers.set(name, value);
    }

    /* Never cached, anywhere. It is one partner's contract, fetched over a shared CDN path. */
    headers.set('Cache-Control', 'private, no-store');

    return new Response(await response.arrayBuffer(), { status: 200, headers });
  } catch {
    return NextResponse.json(
      { code: ERROR.REQUEST_UPSTREAM_UNREACHABLE },
      { status: 502 },
    );
  }
}
