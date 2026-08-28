import { NextResponse } from 'next/server';

import { getStaffSession } from '@/lib/session-server';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

/**
 * Streams one piece of dispute evidence to the browser.
 *
 * ## Why an `<img src>` can point here and not at the object store
 *
 * The bytes are private — a photograph of the inside of somebody's home, filed in a complaint — so
 * the `disputes/` prefix is deliberately absent from the bucket's anonymous read policy. An image
 * tag cannot carry an Authorization header, but it does carry this origin's cookie, and this
 * handler exchanges that for the bearer token server-side. That is the whole reason it exists.
 *
 * The API's own headers are copied rather than re-decided here: `inline`, `nosniff` and
 * `private, no-store` are its answers to «may this be rendered, sniffed or cached», and a second
 * opinion in this file would be a second thing to keep in step.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ evidenceId: string }> },
): Promise<NextResponse> {
  const { evidenceId } = await params;
  const session = await getStaffSession();

  if (!session) {
    return NextResponse.json({ message: 'Not signed in.' }, { status: 401 });
  }

  try {
    const response = await fetch(
      `${API_URL}/api/v1/admin/disputes/evidence/${encodeURIComponent(evidenceId)}/file`,
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
