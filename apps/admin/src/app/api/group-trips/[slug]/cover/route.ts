import { NextResponse } from 'next/server';
import { internalCallerHeaders } from '@safra/session';

import { getStaffSession } from '@/lib/session-server';
import { proxy } from '@/lib/proxy';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

/**
 * A group trip's cover photograph.
 *
 * ## The slug is validated here, not forwarded
 *
 * It lands in an upstream PATH, and a segment taken from a request and pasted into a URL is how
 * `/admin/group-trips/../../partners` gets reached. The same pattern and the same reasoning as the
 * sibling route next door; it is repeated rather than shared because a helper import that one of
 * the two files forgets is a guard that silently is not there.
 */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function safeSlug(slug: string): string | null {
  return SLUG.test(slug) && slug.length <= 80 ? slug : null;
}

/**
 * Forwards the bytes, multipart intact.
 *
 * Not `proxy()`: that helper serialises a JSON body, and re-encoding a file through JSON would
 * both corrupt it and inflate it. The stream passes through unchanged with the token attached from
 * the HttpOnly cookie — which is the whole reason this handler exists rather than the browser
 * calling the API directly, since a token readable by script is a token an XSS can take.
 * `duplex: 'half'` is required by the fetch spec for any streamed body.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug } = await params;
  const safe = safeSlug(slug);

  if (!safe) return new NextResponse(null, { status: 404 });

  const session = await getStaffSession();

  if (!session) {
    return NextResponse.json({ message: 'Not signed in.' }, { status: 401 });
  }

  try {
    const response = await fetch(`${API_URL}/api/v1/admin/group-trips/${safe}/cover`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
        /* The multipart boundary travels with it; setting it by hand would break the parse. */
        ...(request.headers.get('content-type')
          ? { 'Content-Type': request.headers.get('content-type') as string }
          : {}),
        ...internalCallerHeaders(request.headers),
      },
      body: request.body,
      duplex: 'half',
      cache: 'no-store',
    } as RequestInit & { duplex: 'half' });

    const payload: unknown = await response.json().catch(() => null);

    return NextResponse.json(payload, { status: response.status });
  } catch {
    return NextResponse.json(
      { message: 'Could not reach the server. Please try again.' },
      { status: 502 },
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug } = await params;
  const safe = safeSlug(slug);

  if (!safe) return new NextResponse(null, { status: 404 });

  return proxy(`/admin/group-trips/${safe}/cover`, { method: 'DELETE' });
}
