import { NextResponse } from 'next/server';

import { getStaffSession } from '@/lib/session-server';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

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
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; party: string }> },
): Promise<NextResponse> {
  const session = await getStaffSession();

  if (!session) {
    return NextResponse.json({ message: 'Not signed in.' }, { status: 401 });
  }

  const { id, party } = await params;

  const response = await fetch(
    `${API_URL}/api/v1/admin/partner-contracts/${encodeURIComponent(id)}/file/${encodeURIComponent(party)}`,
    { headers: { Authorization: `Bearer ${session.accessToken}` }, cache: 'no-store' },
  );

  if (!response.ok) {
    return NextResponse.json(
      { message: 'Could not fetch the contract.' },
      {
        status: response.status,
      },
    );
  }

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
