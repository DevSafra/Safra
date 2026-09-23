import { NextResponse } from 'next/server';

import { PROPERTY_SLUG_MAX, PROPERTY_SLUG_PATTERN } from '@safra/contracts';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

/**
 * Proxies the neighbours endpoint so the full-screen map can ask for it from the browser.
 *
 * ## Why a proxy and not a direct call
 *
 * `API_URL` is a SERVER variable. It is deliberately not `NEXT_PUBLIC_`, so the API's origin
 * is not published to every visitor and the page's `connect-src` does not have to name it.
 * The browser therefore talks to this app, and this app talks to the API — which also means
 * one origin to allow rather than two.
 *
 * ## Why it is not part of the property payload
 *
 * Most readers never open the full-screen map. Folding a dozen neighbours into the
 * server-rendered page would make every visitor pay for a feature a minority use, on a page
 * whose weight has already been argued over once — see the IntersectionObserver that keeps
 * MapLibre itself out of the initial bundle.
 *
 * ## What this route is allowed to do
 *
 * Exactly one thing: read the public neighbours of one published listing. The slug is
 * validated against the same pattern `revalidate-property` uses BEFORE it reaches a URL, so
 * what gets interpolated is lowercase Latin, digits and single hyphens — no traversal, no
 * query smuggling, no way to point this at another endpoint. There is no request body, no
 * header is forwarded, and no cookie travels: a caller cannot borrow the reader's session to
 * reach something they could not reach themselves.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug } = await context.params;

  /*
    Refused as an EMPTY LIST rather than a 400. The caller is a map decoration; a status it
    has no handler for would land in the browser console of a page that is working fine.
  */
  if (slug.length > PROPERTY_SLUG_MAX || !PROPERTY_SLUG_PATTERN.test(slug)) {
    return NextResponse.json({ items: [] }, { status: 200 });
  }

  try {
    const response = await fetch(
      `${API_URL}/api/v1/properties/${encodeURIComponent(slug)}/nearby`,
      {
        /*
          The neighbours of a listing change when a partner publishes or moves one, which is
          not a per-request fact. Five minutes is well inside the property page's own
          revalidation window and keeps a popular listing from re-asking on every open.
        */
        next: { revalidate: 300 },
      },
    );

    if (!response.ok) return NextResponse.json({ items: [] }, { status: 200 });

    const body: unknown = await response.json();
    return NextResponse.json(body, {
      status: 200,
      /*
        Cacheable by the CDN as well, on the same reasoning. `public` is correct because the
        payload is the same for everyone — it carries no signed-in state and no session.
      */
      headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300' },
    });
  } catch {
    return NextResponse.json({ items: [] }, { status: 200 });
  }
}
