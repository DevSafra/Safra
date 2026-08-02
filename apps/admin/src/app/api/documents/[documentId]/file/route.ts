import { NextResponse } from 'next/server';

import { getStaffSession } from '@/lib/session-server';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

/**
 * Streams a verification document to the reviewer.
 *
 * Not `proxy()`: that one parses JSON, and these are PDF and JPEG bytes. Written out
 * separately so the defensive headers are explicit rather than inherited —
 * `attachment` so a stored-verbatim PDF is never rendered on this origin, `nosniff`
 * so a browser cannot decide it is HTML, `no-store` so an identity document does not
 * sit in a shared cache or survive in the browser after sign-out.
 *
 * The API re-applies all of these and writes the `partner_document.viewed` audit row;
 * this handler exists so the bytes reach the browser with the staff access token
 * attached server-side, never exposed to client JavaScript.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ documentId: string }> },
): Promise<NextResponse> {
  const session = await getStaffSession();

  if (!session) {
    return NextResponse.json({ message: 'Not signed in.' }, { status: 401 });
  }

  const { documentId } = await params;

  let upstream: Response;

  try {
    upstream = await fetch(
      `${API_URL}/api/v1/admin/partners/documents/${encodeURIComponent(documentId)}/file`,
      {
        headers: { Authorization: `Bearer ${session.accessToken}` },
        cache: 'no-store',
      },
    );
  } catch {
    return NextResponse.json({ message: 'Could not reach the server.' }, { status: 502 });
  }

  if (!upstream.ok) {
    /**
     * Deliberately flat. A reviewer without `PARTNER_DOCUMENT_REVIEW` and a document
     * that does not exist get the same answer, so this cannot be used to discover
     * which document ids are real.
     */
    return NextResponse.json({ message: 'Document not available.' }, { status: 404 });
  }

  return new NextResponse(await upstream.arrayBuffer(), {
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      'Content-Disposition': upstream.headers.get('content-disposition') ?? 'attachment',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  });
}
