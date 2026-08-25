import { seeOther } from '@safra/session';

import { getPartnerSession } from '@/lib/session-server';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

/**
 * Where a partner who cannot have the file is sent: back to the screen the link is on.
 *
 * A literal path with one flag. العقود والمستندات is where they clicked from, so nothing is lost —
 * and unlike the console's file routes this one has somewhere exact to go, because the portal shows
 * a partner their OWN contracts and there is only one such screen.
 */
const UNAVAILABLE = '/contracts?file=unavailable';

/**
 * Downloading the partnership contract SAFRA sent (Bashar, 2026-08-19, step 4).
 *
 * A GET the browser follows directly, so the bytes never pass through JavaScript. The session
 * cookie is HttpOnly, so the token is attached here — which is also why this cannot be a link
 * straight to the API.
 *
 * ## The response headers are the API's, not rebuilt here
 *
 * `Content-Disposition` and `X-Content-Type-Options` are set by the API, which knows the filename
 * from its own column. Copying them across rather than composing new ones keeps ONE decision about
 * whether a partner's commercial agreement renders inline — and it decided `attachment`.
 *
 * ## A failure is a REDIRECT, never a body
 *
 * «تنزيل العقد» is an `<a href>`, so the browser navigates and renders whatever comes back. It used
 * to answer `{"code":"contract.not_found"}` and a partner met that JSON document (Bashar,
 * 2026-08-25: no JSON screen, ever). The code was right for a machine and unreadable for a person;
 * the screen it redirects to says the same thing in Arabic. Every refusal shares one destination, so
 * a contract id that exists and one that does not are indistinguishable from outside.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ contractId: string }> },
): Promise<Response> {
  const { contractId } = await params;
  const session = await getPartnerSession();

  /* `/api/*` is outside the middleware's matcher, so an expired session reaches here. */
  if (!session) return seeOther('/login');

  try {
    const response = await fetch(
      `${API_URL}/api/v1/partner/contracts/${encodeURIComponent(contractId)}/file`,
      {
        headers: { Authorization: `Bearer ${session.accessToken}` },
        cache: 'no-store',
      },
    );

    if (!response.ok) return seeOther(UNAVAILABLE);

    const headers = new Headers();

    for (const name of [
      'content-type',
      'content-disposition',
      'x-content-type-options',
    ]) {
      const value = response.headers.get(name);

      if (value) headers.set(name, value);
    }

    /* Never cached, anywhere. It is one partner's contract, fetched over a shared CDN path. */
    headers.set('Cache-Control', 'private, no-store');

    return new Response(await response.arrayBuffer(), { status: 200, headers });
  } catch {
    return seeOther(UNAVAILABLE);
  }
}
