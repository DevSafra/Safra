import { NextResponse } from 'next/server';

import { seeOther } from '@safra/session';

import { getStaffSession } from '@/lib/session-server';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

/**
 * Where a reader who cannot have the file is sent.
 *
 * سجل الشركاء, not the record the link was on: this route is given a document id and nothing else,
 * and a partner reference taken from the request would be caller input in a redirect target. The
 * registry is one click from where they were — the same trade `TABLE_SECTION_PATHS` already accepts
 * for `partnerViolations`, and for the same reason.
 */
const UNAVAILABLE = '/partners?file=unavailable';

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
 *
 * ## A failure is a REDIRECT, never a body
 *
 * This is an `<a href>` on the partner record, so the browser navigates and renders whatever it
 * gets. Until 2026-08-25 that was `{"message":"Document not available."}` — an English sentence,
 * outside the catalogue, as a bare document (Bashar: no JSON screen, ever). The flat-answer property
 * below is preserved by the redirect: every refusal lands on the same URL with the same message.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ documentId: string }> },
): Promise<Response> {
  const session = await getStaffSession();

  /* `/api/*` is outside the middleware's matcher, so an expired session reaches here. */
  if (!session) return seeOther('/login');

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
    return seeOther(UNAVAILABLE);
  }

  if (!upstream.ok) {
    /**
     * Deliberately flat. A reviewer without `PARTNER_DOCUMENT_REVIEW` and a document
     * that does not exist get the same answer, so this cannot be used to discover
     * which document ids are real. The unreachable-API case above lands here too, which
     * costs the reader nothing and keeps that property total.
     */
    return seeOther(UNAVAILABLE);
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
