import { NextResponse } from 'next/server';

import { getStaffSession } from '@/lib/session-server';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

/**
 * Forwards a creative image to the API, multipart intact.
 *
 * Not `proxy()`: that helper serialises a JSON body, and re-encoding a file through JSON would
 * both corrupt it and triple its size. The stream is passed through unchanged with the token
 * attached from the HttpOnly cookie — the whole reason this handler exists rather than the browser
 * calling the API directly.
 *
 * `duplex: 'half'` is required by the fetch spec whenever a request carries a stream body; without
 * it Node throws before a byte leaves.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ reference: string }> },
): Promise<NextResponse> {
  const { reference } = await params;
  const session = await getStaffSession();

  if (!session) {
    return NextResponse.json({ message: 'Not signed in.' }, { status: 401 });
  }

  try {
    const response = await fetch(
      `${API_URL}/api/v1/admin/ad-campaigns/${encodeURIComponent(reference)}/creative`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${session.accessToken}`,
          /* The multipart boundary travels with it; setting it by hand would break the parse. */
          ...(request.headers.get('content-type')
            ? { 'Content-Type': request.headers.get('content-type') as string }
            : {}),
        },
        body: request.body,
        duplex: 'half',
        cache: 'no-store',
      } as RequestInit & { duplex: 'half' },
    );

    const payload: unknown = await response.json().catch(() => null);

    return NextResponse.json(payload, { status: response.status });
  } catch {
    return NextResponse.json(
      { message: 'Could not reach the server. Please try again.' },
      { status: 502 },
    );
  }
}
