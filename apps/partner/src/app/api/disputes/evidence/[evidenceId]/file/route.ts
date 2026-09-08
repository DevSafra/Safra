import { NextResponse } from 'next/server';

import { getPartnerSession } from '@/lib/session-server';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

/**
 * Streams one piece of dispute evidence to the partner's browser.
 *
 * ## Why an `<img src>` can point here and not at the object store
 *
 * The bytes are private — the inside of a property, filed in a complaint — so the `disputes/`
 * prefix is deliberately absent from the bucket's anonymous read policy. An image tag cannot carry
 * an Authorization header, but it does carry this origin's cookie, and this handler exchanges that
 * for the bearer token server-side. That is the whole reason it exists.
 *
 * ## The entitlement is the API's WHERE, not this handler's
 *
 * A partner may open a file they filed themselves, or one an operator has explicitly released to
 * them. Both are clauses in the API's predicate, so an id read out of the page source and asked
 * for directly answers «not found» — identical to an id that was never issued. Nothing about that
 * decision is made here, which is the point: a route handler that judged it would be a second
 * definition of the privacy boundary, free to drift from the first.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ evidenceId: string }> },
): Promise<NextResponse> {
  const { evidenceId } = await params;
  const session = await getPartnerSession();

  if (!session) {
    return NextResponse.json({ message: 'Not signed in.' }, { status: 401 });
  }

  try {
    const response = await fetch(
      `${API_URL}/api/v1/partner/disputes/evidence/${encodeURIComponent(evidenceId)}/file`,
      {
        headers: { Authorization: `Bearer ${session.accessToken}` },
        cache: 'no-store',
      },
    );

    if (!response.ok) {
      return NextResponse.json({ message: 'Not found.' }, { status: response.status });
    }

    return new NextResponse(await response.arrayBuffer(), {
      status: 200,
      headers: {
        'Content-Type': response.headers.get('content-type') ?? 'image/avif',
        'Content-Disposition': 'inline',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch {
    return NextResponse.json({ message: 'Could not reach the server.' }, { status: 502 });
  }
}
