import { NextResponse } from 'next/server';

import { seeOther } from '@safra/session';

import { getStaffSession } from '@/lib/session-server';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

/** As for a verification document, and for the same reasons — see that route. */
const UNAVAILABLE = '/partners?file=unavailable';

/**
 * The contract PDF, for a staff member to print and sign.
 *
 * Not `proxy()`: that helper reads JSON, and this is a file. The bytes are streamed through with
 * the API's own headers rather than re-derived — the API decided the filename and the disposition,
 * and a second opinion here is a second thing to keep in step.
 *
 * `party` is passed through unvalidated ON PURPOSE: the API accepts exactly three values and
 * refuses everything else. Validating it here as well would mean two lists, and the one that
 * matters is the one nearest the storage key.
 *
 * ## A failure is a REDIRECT, never a body
 *
 * The three links that reach this are `<a href>` on the partner record, so a refusal used to render
 * `{"message":"Could not fetch the contract."}` as a document — English, uncatalogued, no console
 * around it. It redirects to سجل الشركاء now, where the message reads in Arabic (2026-08-25).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; party: string }> },
): Promise<Response> {
  const session = await getStaffSession();

  /* `/api/*` is outside the middleware's matcher, so an expired session reaches here. */
  if (!session) return seeOther('/login');

  const { id, party } = await params;

  const response = await fetch(
    `${API_URL}/api/v1/admin/partner-contracts/${encodeURIComponent(id)}/file/${encodeURIComponent(party)}`,
    { headers: { Authorization: `Bearer ${session.accessToken}` }, cache: 'no-store' },
  );

  /*
    One destination for every refusal, so a contract id that exists and one that does not are
    indistinguishable — the same property the verification-document route states explicitly.
  */
  if (!response.ok) return seeOther(UNAVAILABLE);

  return new NextResponse(await response.arrayBuffer(), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition':
        response.headers.get('content-disposition') ??
        'attachment; filename="contract.pdf"',
    },
  });
}
