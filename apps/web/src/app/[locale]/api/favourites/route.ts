import { NextResponse } from 'next/server';

import { ERROR } from '@safra/contracts';

import { getSession } from '@/lib/session-server';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

/**
 * Server-side proxy for saving and un-saving a listing (handoff §6, المفضلة).
 *
 * Authenticated, like the reviews proxy beside it: the access token is attached here from the
 * HttpOnly cookie so it never reaches client JavaScript.
 *
 * The body passes through untouched. Validating the slug here would duplicate the Zod schema the API
 * already enforces, and two copies of a rule drift — and every rule that matters (your account, a
 * PUBLISHED listing, one row per pair) is enforced server-side regardless of what arrives.
 */
async function forward(
  request: Request,
  method: 'POST' | 'DELETE',
): Promise<NextResponse> {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ code: ERROR.AUTH_REQUIRED }, { status: 401 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: ERROR.REQUEST_MALFORMED_BODY }, { status: 400 });
  }

  try {
    const response = await fetch(`${API_URL}/api/v1/favourites`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });

    return NextResponse.json(await response.json().catch(() => ({})), {
      status: response.status,
    });
  } catch {
    return NextResponse.json(
      { code: ERROR.REQUEST_UPSTREAM_UNREACHABLE },
      { status: 502 },
    );
  }
}

/**
 * Whether one listing is saved, for the button to ask after it mounts.
 *
 * The property page is cached (`revalidate = 60`), so this state cannot be server-rendered into it —
 * a cached page would hand one customer's shortlist to the next. An anonymous visitor gets `false`
 * rather than a 401: "is this saved" is answerable for them, and the answer is no.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const slug = new URL(request.url).searchParams.get('slug') ?? '';
  const session = await getSession();

  if (!session || !slug) {
    return NextResponse.json({ slug, saved: false });
  }

  try {
    const response = await fetch(
      `${API_URL}/api/v1/favourites/status?slug=${encodeURIComponent(slug)}`,
      {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${session.accessToken}`,
        },
        cache: 'no-store',
      },
    );

    if (!response.ok) return NextResponse.json({ slug, saved: false });

    return NextResponse.json(await response.json().catch(() => ({ slug, saved: false })));
  } catch {
    /* A shortlist state is not worth an error banner on a property page. */
    return NextResponse.json({ slug, saved: false });
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  return forward(request, 'POST');
}

export async function DELETE(request: Request): Promise<NextResponse> {
  return forward(request, 'DELETE');
}
